import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export const REGISTRY = 'https://registry.npmjs.org/';
const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const assert = (ok, message) => { if (!ok) throw new Error(message); };
export function validateMetadata(pkg, lock, config) {
 assert(/^@[a-z0-9][a-z0-9-]*\/scopetrace$/.test(pkg.name) && pkg.name === config.packageName, 'Expected the configured scoped package; never publish the occupied unscoped name.');
 assert(stable.test(pkg.version), 'Only stable x.y.z versions are supported for latest.');
 assert(pkg.private !== true && pkg.publishConfig?.access === 'public' && pkg.publishConfig?.registry === REGISTRY && config.registry === REGISTRY, 'Public npm registry/access must be explicit.');
 assert(config.repository === 'sinzbtw/scopetrace' && pkg.repository?.url === 'https://github.com/' + config.repository + '.git', 'Repository must match the trusted publisher.');
 assert(lock.name === pkg.name && lock.version === pkg.version && lock.packages?.['']?.name === pkg.name && lock.packages?.['']?.version === pkg.version, 'Manifest and lockfile identity differ.');
 assert(config.environment === 'npm' && config.workflow === 'npm-publish.yml', 'Trusted publisher workflow/environment must match.');
 for (const [name, dependency] of Object.entries(lock.packages ?? {})) {
  if (!name) continue;
  assert(dependency.resolved?.startsWith(REGISTRY) && /^sha(?:256|384|512)-/.test(dependency.integrity ?? ''), 'Locked dependencies must have registry URLs and strong integrity hashes.');
 }
 assert(pkg.bin?.scopetrace === 'dist/cli/main.js' && pkg.exports?.['.'] === './dist/index.js' && pkg.types === 'dist/index.d.ts', 'Unexpected CLI or API entry point.');
 assert(!pkg.dependencies?.[pkg.name], 'Package cannot depend on itself.');
 return pkg;
}
export function npmResult(text, expectedName) {
 const parsed = JSON.parse(text);
 const entries = Array.isArray(parsed) ? parsed : parsed.name ? [parsed] : Object.values(parsed);
 assert(entries.length === 1 && entries[0]?.name === expectedName && typeof entries[0]?.version === 'string', 'Unexpected npm JSON package identity.');
 return entries[0];
}
export function compareVersions(a, b) {
 assert(stable.test(a) && stable.test(b), 'Stable semantic versions required.');
 const x = a.split('.').map(BigInt), y = b.split('.').map(BigInt);
 for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
 return 0;
}
export function releasePlan({ eventName, event, ref, repository, version, enabled }) {
 assert(repository === 'sinzbtw/scopetrace', 'Publishing from forks or other repositories is forbidden.');
 assert(['release', 'workflow_dispatch'].includes(eventName), 'Only a published release or manual dispatch may use this workflow.');
 const publishing = eventName === 'release' || event.inputs?.publish === true || event.inputs?.publish === 'true';
 const tag = eventName === 'release' ? event.release?.tag_name : (event.inputs?.tag || '');
 if (eventName === 'release') assert(event.action === 'published' && !event.release?.draft && !event.release?.prerelease, 'Only a published stable GitHub release can publish latest.');
 if (tag) assert(tag === 'v' + version && /^v\d+\.\d+\.\d+$/.test(tag), 'Release tag must exactly match package version.');
 if (publishing) {
  assert(tag === 'v' + version, 'Publishing requires an explicit matching release tag.');
  assert(ref === 'refs/tags/' + tag, 'Real publication must run on the release tag so provenance identifies the built commit.');
  assert(enabled === 'true', 'NPM_PUBLISH_ENABLED is not true. Complete npm ownership/trusted-publisher setup first.');
 } else assert(ref === 'refs/heads/main' || tag === 'v' + version, 'Dry runs must use main or the matching release tag.');
 return { tag, publishing };
}
export function registryDecision(packument, manifest) {
 if (packument === null) return 'publish';
 const existing = packument.versions?.[manifest.version];
 if (existing) {
  assert(existing.dist?.integrity === manifest.integrity, 'This immutable npm version already exists with different contents. Bump the version.');
  return 'already-published';
 }
 const latest = packument['dist-tags']?.latest;
 if (latest && stable.test(latest)) assert(compareVersions(manifest.version, latest) > 0, 'Refusing to move the latest tag backwards.');
 return 'publish';
}
export function publicationState(document, manifest) {
 const entry = document?.versions?.[manifest.version];
 if (!entry) return 'pending';
 assert(entry.dist?.integrity === manifest.integrity, 'Published registry integrity does not match the tested archive.');
 return document['dist-tags']?.latest === manifest.version ? 'published' : 'pending';
}
export function verifyArtifact(directory, manifest, pkg, sha) {
 assert(manifest.packageName === pkg.name && manifest.version === pkg.version && manifest.sourceCommit === sha, 'Artifact identity does not match the verified source.');
 assert(/^[a-z0-9-]+-\d+\.\d+\.\d+\.tgz$/.test(manifest.filename) && path.basename(manifest.filename) === manifest.filename, 'Invalid artifact filename.');
 const file = path.join(directory, manifest.filename);
 const stat = fs.lstatSync(file);
 assert(stat.isFile() && !stat.isSymbolicLink(), 'Artifact must be a regular file.');
 const bytes = fs.readFileSync(file);
 assert(createHash('sha256').update(bytes).digest('hex') === manifest.sha256, 'Artifact SHA-256 mismatch.');
 assert('sha512-' + createHash('sha512').update(bytes).digest('base64') === manifest.integrity, 'Artifact integrity mismatch.');
 return file;
}
function git(...args) { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function output(key, value) {
 if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, key + '=' + value + '\n');
 console.log(key + '=' + value);
}
function metadata() {
 const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
 const config = JSON.parse(fs.readFileSync('.github/npm-publish.json', 'utf8'));
 validateMetadata(pkg, JSON.parse(fs.readFileSync('package-lock.json', 'utf8')), config);
 return { pkg, config };
}
export async function registryPackage(name) {
 const response = await fetch(REGISTRY + encodeURIComponent(name) + '?scopetrace_check=' + Date.now(), { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(30000) });
 if (response.status === 404) return null;
 assert(response.ok, 'npm registry lookup failed; refusing to treat this as an absent package.');
 const document = await response.json();
 assert(document.name === name && typeof document.versions === 'object', 'Invalid npm registry response.');
 return document;
}
async function publishedRelease(tag, config, sha) {
 const headers = { Accept: 'application/vnd.github+json' };
 if (process.env.GH_TOKEN) headers.Authorization = 'Bearer ' + process.env.GH_TOKEN;
 const response = await fetch('https://api.github.com/repos/' + config.repository + '/releases/tags/' + tag, { headers, signal: AbortSignal.timeout(30000) });
 assert(response.ok, 'A published GitHub release is required for real npm publishing.');
 const release = await response.json();
 assert(release.tag_name === tag && !release.draft && !release.prerelease, 'Expected a stable published release.');
 assert(git('rev-parse', tag + '^{commit}') === sha, 'Release tag no longer matches the verified source.');
}
export async function main(command) {
 const { pkg, config } = metadata();
 const sha = git('rev-parse', 'HEAD');
 if (command === 'plan') {
  assert(git('status', '--porcelain') === '', 'Release source must be clean.');
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const plan = releasePlan({ eventName: process.env.GITHUB_EVENT_NAME, event, ref: process.env.GITHUB_REF,
   repository: process.env.GITHUB_REPOSITORY, version: pkg.version, enabled: process.env.NPM_PUBLISH_ENABLED });
  git('merge-base', '--is-ancestor', sha, 'origin/main');
  if (plan.tag) assert(git('rev-parse', plan.tag + '^{commit}') === sha, 'Checked-out source does not match the release tag.');
  if (plan.publishing) {
   assert(process.env.GITHUB_SHA === sha, 'OIDC/provenance source SHA must match the built release commit.');
   await publishedRelease(plan.tag, config, sha);
  }
  output('sha', sha);output('version', pkg.version);output('publish', String(plan.publishing));output('tag', plan.tag);
 } else if (command === 'verify') {
  const dir = path.resolve('work/npm');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'release-manifest.json'), 'utf8'));
  verifyArtifact(dir, manifest, pkg, sha);
  const decision = registryDecision(await registryPackage(pkg.name), manifest);
  output('decision', decision);output('filename', manifest.filename);
 } else if (command === 'published') {
  const manifest = JSON.parse(fs.readFileSync('work/npm/release-manifest.json', 'utf8'));
  let state = 'pending';
  for (let attempt = 0; attempt < 61; attempt++) {
   state = publicationState(await registryPackage(pkg.name), manifest);
   if (state === 'published') break;
   if (attempt % 6 === 0) console.log('npm is still processing the version/latest metadata; waiting for registry confirmation.');
   if (attempt < 60) await new Promise(resolve => setTimeout(resolve, 5000));
  }
  assert(state === 'published', 'npm has not exposed the expected version/latest within five minutes. Check processing status and safely retry the original release; do not republish different contents.');
  console.log('Registry version, latest tag and archive integrity verified.');
 } else throw new Error('Unknown release verification command.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 main(process.argv[2]).catch(error => { console.error('Release verification: ' + error.message);process.exitCode = 1; });
}
