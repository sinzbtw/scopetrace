import { Ajv2020 } from 'ajv/dist/2020.js';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { validateMetadata, npmResult, registryPackage, registryDecision } from './release.mjs';
const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
validateMetadata(pkg, JSON.parse(fs.readFileSync('package-lock.json', 'utf8')), JSON.parse(fs.readFileSync('.github/npm-publish.json', 'utf8')));
if (!process.env.npm_execpath) throw new Error('Run via npm run package:check.');
const npm = args => execFileSync(process.execPath, [process.env.npm_execpath, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 4 * 1024 * 1024 });
const out = path.resolve('work/npm');fs.mkdirSync(out, { recursive: true });
const packed = npmResult(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', out]), pkg.name);
if (packed.version !== pkg.version) throw new Error('Packed version mismatch.');
const required = ['rules/google-scope-relations.json', 'schemas/comparison-report.schema.json', 'docs/comparison.md', 'docs/comparison.ru.md', 'package.json', 'dist/index.js', 'dist/index.d.ts', 'dist/cli/main.js', 'rules/github-oauth.json', 'rules/github-app.json', 'rules/google-oauth.json', 'schemas/report.schema.json', 'schemas/github-app-report.schema.json', 'schemas/google-oauth-report.schema.json', 'README.md', 'README.ru.md', 'LICENSE', 'SECURITY.md', 'CODE_OF_CONDUCT.md', 'docs/publishing.md', 'docs/publishing.ru.md'];
for (const name of required) if (!packed.files.some(f => f.path === name)) throw new Error('Package missing: ' + name);
for (const file of packed.files) {
 if (/^(?:src|tests|scripts|node_modules|work|coverage|\.git)\//.test(file.path) || /(?:^|\/)(?:\.npmrc|\.env(?:\..*)?|.*\.(?:pem|key)|package-lock\.json)$/.test(file.path)) throw new Error('Forbidden packaged path: ' + file.path);
 if (file.path.startsWith('.github/') && !['.github/workflows/ci.yml', '.github/workflows/code-scanning.yml', '.github/scopetrace.config.json'].includes(file.path)) throw new Error('Unexpected internal workflow/config in archive.');
}
if (packed.unpackedSize > 2 * 1024 * 1024) throw new Error('Unexpected package size increase.');
const archive = path.join(out, packed.filename);
const bytes = fs.readFileSync(archive);
const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
if (integrity !== packed.integrity) throw new Error('npm pack integrity mismatch.');
const prefix = fs.mkdtempSync(path.join(out, 'install-'));
// Install the exact archive, with consumer lifecycle scripts disabled.
npm(['install', '--prefix', prefix, archive, '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false']);
const installed = path.join(prefix, 'node_modules', ...pkg.name.split('/'));
const require = createRequire(path.join(prefix, 'consumer.cjs'));
const api = await import(pathToFileURL(require.resolve(pkg.name)).href);
const cli = path.join(installed, 'dist/cli/main.js');
if (!fs.readFileSync(cli, 'utf8').startsWith('#!/usr/bin/env node')) throw new Error('Missing CLI shebang.');
if (!fs.existsSync(path.join(prefix, 'node_modules/.bin', process.platform === 'win32' ? 'scopetrace.cmd' : 'scopetrace'))) throw new Error('npm did not create the CLI shim.');
const version = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8' });
if (version.status !== 0 || version.stdout.trim() !== pkg.version || version.stderr) throw new Error('Packed CLI version mismatch.');
for (const [fixture, provider, schema] of [['basic', 'github-oauth', '1.0.0'], ['github-app', 'github-app', '2.0.0'], ['google-oauth', 'google-oauth', '3.0.0']]) {
 const cwd = path.join(root, 'tests/fixtures', fixture);
 const run = format => spawnSync(process.execPath, [cli, 'scan', '--format', format, '--fail-on', 'high'], { cwd, encoding: 'utf8' });
 const json = run('json'), sarif = run('sarif');
 if (json.status !== 1 || sarif.status !== 1 || json.stderr || sarif.stderr) throw new Error('Packed CLI/gate failed: ' + provider);
 const report = JSON.parse(json.stdout), document = JSON.parse(sarif.stdout);
 if (report.provider !== provider || report.toolVersion !== pkg.version || report.schemaVersion !== schema) throw new Error('Provider/schema regression.');
 if (JSON.stringify(api.toSarif(report)) !== JSON.stringify(document) || JSON.parse(api.render(report, 'sarif')).version !== '2.1.0') throw new Error('Packed public API regression.');
 const restored = [...document.runs[0].results.map(r => r.properties.scopetrace), ...document.runs[0].properties.scopetrace.nonAlertFindings].sort((a, b) => a.id.localeCompare(b.id));
 if (JSON.stringify(restored) !== JSON.stringify(report.findings)) throw new Error('Finding confidence/evidence lost.');
 console.log('Installed ' + provider + ': JSON, SARIF, public API, metadata and exit gate passed.');
}
const comparisonSchema = new Ajv2020({ strict: true }).compile(JSON.parse(fs.readFileSync(path.join(installed, 'schemas/comparison-report.schema.json'), 'utf8')));
const oldConfig = api.configSchema.parse({ provider: 'github-oauth', declaredScopes: ['user:email'] });
const newConfig = api.configSchema.parse({ provider: 'github-oauth', declaredScopes: ['user'] });
const pureComparison = api.comparePermissions(oldConfig, newConfig);
if (!comparisonSchema(pureComparison) || pureComparison.summary.expanded !== 1 || !api.shouldFailComparison(pureComparison, 'high')) throw new Error('Packed comparison API/schema failed.');
const fixture = path.join(prefix, 'compare-fixture');fs.mkdirSync(fixture);
const git = args => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=' + path.join(fixture, '.hooks-disabled'), '-C', fixture, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
git(['init', '--initial-branch=main']);git(['config', 'user.name', 'ScopeTrace package check']);git(['config', 'user.email', 'fixture@example.invalid']);
fs.writeFileSync(path.join(fixture, 'scopetrace.config.json'), JSON.stringify(oldConfig));git(['add', 'scopetrace.config.json']);git(['commit', '-m', 'Before']);const baseCommit = git(['rev-parse', 'HEAD']);
fs.writeFileSync(path.join(fixture, 'scopetrace.config.json'), JSON.stringify(newConfig));git(['add', 'scopetrace.config.json']);git(['commit', '-m', 'After']);
const compared = spawnSync(process.execPath, [cli, 'compare', '--base', baseCommit, '--format', 'json', '--fail-on', 'high'], { cwd: fixture, encoding: 'utf8' });
if (compared.status !== 1 || compared.stderr) throw new Error('Packed Git comparison CLI/gate failed.');
const comparison = JSON.parse(compared.stdout);
if (!comparisonSchema(comparison) || comparison.summary.expanded !== 1 || comparison.toolVersion !== pkg.version) throw new Error('Packed Git comparison report failed.');
if (JSON.stringify(await api.compareGit(fixture, { base: baseCommit })) !== JSON.stringify(comparison)) throw new Error('Packed Git API differs from CLI.');
if (!api.renderComparison(comparison, 'markdown').includes('ACCESS INCREASE')) throw new Error('Packed comparison Markdown failed.');
console.log('Installed comparison: committed Git snapshots, escalation gate, independent schema, public API and Markdown passed.');
for (const file of [...fs.readdirSync(installed).filter(f => f.endsWith('.md')), ...fs.readdirSync(path.join(installed, 'docs')).filter(f => f.endsWith('.md')).map(f => 'docs/' + f)]) {
 for (const match of fs.readFileSync(path.join(installed, file), 'utf8').matchAll(/\]\(([^)]+)\)/g)) {
  const href = match[1];if (/^https?:/.test(href) || href.startsWith('#')) continue;
  if (!fs.existsSync(path.resolve(installed, path.dirname(file), href.split('#')[0]))) throw new Error('Broken packaged Markdown link: ' + file + ' -> ' + href);
 }
}
const consumer = path.join(prefix, 'consumer.mts');
fs.writeFileSync(consumer, 'import { toSarif, comparePermissions, compareGit, renderComparison, configSchema, type ComparisonReport, type Report } from ' + JSON.stringify(pkg.name) + ';\ndeclare const report: Report;\nconst document = toSarif(report);\nconsole.log(document.version);\nconst diff: ComparisonReport = comparePermissions(configSchema.parse({provider: "github-oauth", declaredScopes: []}), null);\nrenderComparison(diff, "json");\nvoid compareGit;\n');
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'ES2023', '--module', 'NodeNext', consumer], { stdio: 'pipe' });
const manifest = { packageName: pkg.name, version: pkg.version, filename: packed.filename, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sha256: createHash('sha256').update(bytes).digest('hex'), integrity };
// npm 12 rejects even dry-run for an existing version. Only skip that network
// dry-run after an exact integrity match; every install/API check above still ran.
const decision = registryDecision(await registryPackage(pkg.name), manifest);
if (decision === 'publish') {
 const dryRun = npmResult(npm(['publish', archive, '--dry-run', '--ignore-scripts', '--access', 'public', '--registry=https://registry.npmjs.org/', '--json']), pkg.name);
 if (dryRun.name !== pkg.name || dryRun.version !== pkg.version) throw new Error('npm publish dry run mismatch.');
} else console.log('Existing npm version matches the tested archive exactly; duplicate publish dry-run safely skipped.');
fs.writeFileSync(path.join(out, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'CHECKSUMS.sha256'), manifest.sha256 + '  ' + packed.filename + '\n');
console.log('Package allowlist, install, CLI shim, exported types, documentation links and npm publish dry run passed.');
console.log('Verified archive: work/npm/' + packed.filename);
