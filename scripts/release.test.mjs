import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import YAML from 'yaml';
import { validateMetadata, compareVersions, releasePlan, registryDecision, verifyArtifact, npmResult, publicationState } from './release.mjs';
const base = () => ({ pkg: JSON.parse(fs.readFileSync('package.json', 'utf8')), lock: JSON.parse(fs.readFileSync('package-lock.json', 'utf8')), config: JSON.parse(fs.readFileSync('.github/npm-publish.json', 'utf8')) });
const ctx = overrides => ({ eventName: 'release', event: { action: 'published', release: { tag_name: 'v0.4.1', draft: false, prerelease: false } }, ref: 'refs/tags/v0.4.1', repository: 'sinzbtw/scopetrace', version: '0.4.1', enabled: 'true', ...overrides });
test('scoped manifest, lock, public registry and trusted repository agree', () => {
 const { pkg, lock, config } = base();assert.equal(validateMetadata(pkg, lock, config).name, config.packageName);
});
for (const [label, mutate] of [
 ['occupied unscoped name', p => { p.name = 'scopetrace'; }],
 ['wrong scope', p => { p.name = '@someone/scopetrace'; }],
 ['private package', p => { p.private = true; }],
 ['registry redirection', p => { p.publishConfig.registry = 'https://example.invalid/'; }],
 ['implicit access', p => { delete p.publishConfig.access; }],
 ['repository mismatch', p => { p.repository.url = 'https://github.com/other/scopetrace.git'; }],
 ['CLI target override', p => { p.bin.scopetrace = 'src/cli/main.ts'; }],
 ['prerelease on latest', p => { p.version = '0.4.1-beta.1'; }]
]) test('metadata rejects ' + label, () => { const { pkg, lock, config } = base();mutate(pkg);assert.throws(() => validateMetadata(pkg, lock, config)); });
test('lockfile identity mismatch is rejected', () => { const { pkg, lock, config } = base();lock.packages[''].version = '9.0.0';assert.throws(() => validateMetadata(pkg, lock, config), /lockfile/); });
test('stable published release opts into OIDC publishing', () => { assert.deepEqual(releasePlan(ctx()), { tag: 'v0.4.1', publishing: true }); });
test('manual dry run on main does not require npm authorization', () => {
 assert.deepEqual(releasePlan(ctx({ eventName: 'workflow_dispatch', event: { inputs: { publish: 'false', tag: '' } }, ref: 'refs/heads/main', enabled: 'false' })), { tag: '', publishing: false });
 assert.equal(releasePlan(ctx({ eventName: 'workflow_dispatch', event: { inputs: { publish: true, tag: 'v0.4.1' } }, ref: 'refs/tags/v0.4.1' })).publishing, true);
});
for (const [label, overrides] of [
 ['fork', { repository: 'other/scopetrace' }],
 ['pull request event', { eventName: 'pull_request' }],
 ['disabled publication', { enabled: 'false' }],
 ['version mismatch', { version: '0.4.2' }],
 ['prerelease', { event: { action: 'published', release: { tag_name: 'v0.4.1', prerelease: true } } }],
 ['draft', { event: { action: 'published', release: { tag_name: 'v0.4.1', draft: true } } }],
 ['wrong event action', { event: { action: 'edited', release: { tag_name: 'v0.4.1' } } }],
 ['injected ref', { event: { action: 'published', release: { tag_name: 'v0.4.1;evil' } } }],
 ['manual publish on main with mismatched provenance ref', { eventName: 'workflow_dispatch', event: { inputs: { publish: true, tag: 'v0.4.1' } }, ref: 'refs/heads/main' }],
 ['manual publish without tag', { eventName: 'workflow_dispatch', event: { inputs: { publish: true } } }],
 ['dry run on an arbitrary branch', { eventName: 'workflow_dispatch', event: { inputs: {} }, ref: 'refs/heads/evil' }]
]) test('release plan rejects ' + label, () => { assert.throws(() => releasePlan(ctx(overrides))); });
test('numeric stable version comparison prevents latest rollback', () => {
 assert.equal(compareVersions('0.4.10', '0.4.9'), 1);assert.equal(compareVersions('1.0.0', '0.999.999'), 1);
 assert.equal(compareVersions('0.4.1', '0.4.1'), 0);assert.equal(compareVersions('0.4.1', '0.5.0'), -1);
 assert.throws(() => compareVersions('v0.4.1', '0.4.1'));
 const manifest = { version: '0.4.1', integrity: 'sha512-expected' };
 assert.equal(registryDecision(null, manifest), 'publish');
 assert.equal(registryDecision({ 'dist-tags': { latest: '0.4.0' }, versions: {} }, manifest), 'publish');
 assert.throws(() => registryDecision({ 'dist-tags': { latest: '0.5.0' }, versions: {} }, manifest), /backwards/);
 assert.equal(registryDecision({ versions: { '0.4.1': { dist: { integrity: manifest.integrity } } } }, manifest), 'already-published');
 assert.throws(() => registryDecision({ versions: { '0.4.1': { dist: { integrity: 'sha512-other' } } } }, manifest), /different contents/);
});
test('downloaded archive must match identity, source commit, SHA-256 and SHA-512', () => {
 const parent = path.resolve('work/tests');fs.mkdirSync(parent, { recursive: true });
 const dir = fs.mkdtempSync(path.join(parent, 'release-'));
 try {
  const pkg = base().pkg, bytes = Buffer.from('synthetic tarball bytes'), sourceCommit = 'a'.repeat(40);
  const manifest = { packageName: pkg.name, version: pkg.version, sourceCommit, filename: 'nesinz-scopetrace-0.4.1.tgz', sha256: createHash('sha256').update(bytes).digest('hex'), integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') };
  fs.writeFileSync(path.join(dir, manifest.filename), bytes);
  assert.equal(verifyArtifact(dir, manifest, pkg, sourceCommit), path.join(dir, manifest.filename));
  for (const patch of [{ sourceCommit: 'b'.repeat(40) }, { packageName: 'scopetrace' }, { version: '0.5.0' }, { filename: '../other.tgz' }, { sha256: '0'.repeat(64) }, { integrity: 'sha512-wrong' }]) assert.throws(() => verifyArtifact(dir, { ...manifest, ...patch }, pkg, sourceCommit));
  fs.appendFileSync(path.join(dir, manifest.filename), 'tampered');assert.throws(() => verifyArtifact(dir, manifest, pkg, sourceCommit), /SHA-256/);
 } finally {
  assert.ok(path.resolve(dir).startsWith(parent + path.sep));fs.rmSync(dir, { recursive: true, force: true });
 }
});
test('workflow isolates OIDC to a final immutable-artifact publication job', () => {
 const text = fs.readFileSync('.github/workflows/npm-publish.yml', 'utf8'), workflow = YAML.parse(text);
 assert.deepEqual(Object.keys(workflow.on).sort(), ['release', 'workflow_dispatch']);assert.equal(workflow.on.workflow_dispatch.inputs.publish.default, false);
 assert.deepEqual(workflow.permissions, { contents: 'read' });assert.equal(workflow.concurrency['cancel-in-progress'], false);
 assert.equal(workflow.jobs.publish.environment, 'npm');assert.equal(workflow.jobs.publish.permissions['id-token'], 'write');
 for (const name of ['plan', 'validate', 'package']) assert.equal(workflow.jobs[name].permissions?.['id-token'], undefined);
 assert.ok(workflow.jobs.package.needs.includes('validate'));assert.ok(workflow.jobs.publish.needs.includes('package'));
 const publishSteps = workflow.jobs.publish.steps;
 assert.ok(publishSteps.some(s => s.run === 'node scripts/release.mjs plan'));
 assert.ok(publishSteps.some(s => s.run === 'node scripts/release.mjs verify'));
 const publish = publishSteps.find(s => s.run?.startsWith('npm publish '));
 assert.match(publish.run, /--ignore-scripts/);assert.match(publish.run, /--provenance/);assert.match(publish.run, /--registry=https:\/\/registry\.npmjs\.org\//);
 assert.equal(publish.if, "steps.artifact.outputs.decision == 'publish'");
 assert.ok(!publishSteps.some(s => /npm ci|npm run (?:build|check|test)/.test(s.run ?? '')));
 assert.doesNotMatch(text, /secrets\.|NODE_AUTH_TOKEN|NPM_TOKEN|pull_request_target|workflow_call/);
 for (const job of Object.values(workflow.jobs)) {
  for (const value of Object.values(job.env ?? {})) assert.doesNotMatch(String(value), /runner\./, 'runner context is unavailable in job-level env');
 }
 for (const job of Object.values(workflow.jobs)) for (const step of job.steps) {
  if (step.uses) assert.match(step.uses, /@[0-9a-f]{40}$/);
  if (step.uses?.startsWith('actions/checkout@')) assert.equal(step.with['persist-credentials'], false);
  if (step.uses?.startsWith('actions/setup-node@')) { assert.equal(step.with['package-manager-cache'], false);assert.equal(step.with['registry-url'], undefined); }
 }
});

test('npm 10/11 and npm 12 JSON shapes identify exactly one expected package', () => {
 const entry = { name: '@nesinz/scopetrace', version: '0.4.1' };
 for (const result of [[entry], entry, { [entry.name]: entry }]) assert.deepEqual(npmResult(JSON.stringify(result), entry.name), entry);
 for (const result of [[], [entry, entry], { error: { code: 'E404' } }, { other: { name: 'scopetrace', version: '0.4.1' } }]) assert.throws(() => npmResult(JSON.stringify(result), entry.name));
});

test('locked dependencies cannot redirect installs outside npm or drop integrity', () => {
 for (const replacement of [{ resolved: 'https://example.invalid/dependency.tgz', integrity: 'sha512-x' }, { resolved: 'https://registry.npmjs.org/some.tgz' }]) {
  const { pkg, lock, config } = base();lock.packages['node_modules/hostile'] = replacement;
  assert.throws(() => validateMetadata(pkg, lock, config), /Locked dependencies/);
 }
});

test('async registry processing stays pending, but visible integrity mismatch fails immediately', () => {
 const manifest = { version: '0.4.2', integrity: 'sha512-expected' };
 assert.equal(publicationState(null, manifest), 'pending');
 assert.equal(publicationState({ versions: {}, 'dist-tags': { latest: '0.4.1' } }, manifest), 'pending');
 assert.equal(publicationState({ versions: { '0.4.2': { dist: { integrity: manifest.integrity } } }, 'dist-tags': { latest: '0.4.1' } }, manifest), 'pending');
 assert.equal(publicationState({ versions: { '0.4.2': { dist: { integrity: manifest.integrity } } }, 'dist-tags': { latest: '0.4.2' } }, manifest), 'published');
 assert.throws(() => publicationState({ versions: { '0.4.2': { dist: { integrity: 'sha512-wrong' } } } }, manifest), /integrity/);
});
