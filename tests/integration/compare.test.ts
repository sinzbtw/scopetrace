import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile, unlink, access } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { compareGit } from '../../src/compare/git.js';
import { runCli } from '../../src/cli/run.js';
const parent = path.resolve('work/tests');
const roots: string[] = [];
function git(dir: string, ...args: string[]) {
 return execFileSync('git', ['-c', 'core.fsmonitor=false', '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=' + path.join(dir, '.hooks-disabled'), '-C', dir, ...args], { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
async function repo() {
 await mkdir(parent, { recursive: true });const dir = await mkdtemp(path.join(parent, 'compare-'));roots.push(dir);
 git(dir, 'init', '--initial-branch=main');git(dir, 'config', 'user.name', 'ScopeTrace fixture');git(dir, 'config', 'user.email', 'fixture@example.invalid');
 return dir;
}
async function commit(dir: string, scopes: string[], file = 'scopetrace.config.json') {
 await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
 await writeFile(path.join(dir, file), JSON.stringify({ provider: 'github-oauth', declaredScopes: scopes }));
 git(dir, 'add', '--', file);git(dir, 'commit', '--allow-empty', '-m', 'Synthetic declaration');return git(dir, 'rev-parse', 'HEAD');
}
async function run(dir: string, args: string[]) {
 let stdout = '', stderr = '';const code = await runCli(args, dir, { stdout: s => { stdout += s; }, stderr: s => { stderr += s; } });
 return { code, stdout, stderr };
}
afterEach(async () => { for (const dir of roots.splice(0)) { expect(path.resolve(dir).startsWith(parent + path.sep)).toBe(true);await rm(dir, { recursive: true, force: true }); } });
describe('committed Git permission comparison', { timeout: 20000 }, () => {
 it('compares real branches and ignores dirty working copies without executing project code', async () => {
  const dir = await repo(), base = await commit(dir, ['user:email']);git(dir, 'branch', 'baseline');
  const head = await commit(dir, ['user']);
  await writeFile(path.join(dir, 'scopetrace.config.json'), 'INVALID_UNCOMMITTED_SENTINEL');
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ scripts: { preinstall: 'throw unexpected' } }));
  const r = await compareGit(dir, { base: 'baseline' });
  expect(r.source).toMatchObject({ mode: 'direct', baseCommit: base, headCommit: head, configPath: 'scopetrace.config.json' });
  expect(r.summary).toMatchObject({ expanded: 1, escalations: 1 });
  expect(await readFile(path.join(dir, 'scopetrace.config.json'), 'utf8')).toBe('INVALID_UNCOMMITTED_SENTINEL');
  expect(JSON.stringify(r)).not.toContain('SENTINEL');expect(JSON.stringify(r)).not.toContain(dir.replace(/\\/g, '\\\\'));
 });
 it('uses a unique merge base for PRs and does not attribute base-branch-only changes to the PR', async () => {
  const dir = await repo(), ancestor = await commit(dir, ['user:email']);git(dir, 'branch', 'feature');
  const base = await commit(dir, ['gist']);git(dir, 'switch', 'feature');const head = await commit(dir, ['user']);
  const direct = await compareGit(dir, { base: 'main', head: 'feature' });
  expect(direct.summary).toMatchObject({ added: 1, removed: 1 });
  const pr = await compareGit(dir, { base: 'main', head: 'feature', mergeBase: true });
  expect(pr.source).toMatchObject({ requestedBaseCommit: base, baseCommit: ancestor, headCommit: head, mode: 'merge-base' });
  expect(pr.summary).toMatchObject({ expanded: 1, removed: 0 });
  git(dir, 'update-ref', 'refs/pull/123/head', head);
  const shortcut = await compareGit(dir, { base: 'main', pullRequest: 123 });
  expect(shortcut.source).toMatchObject({ pullRequest: 123, baseCommit: ancestor, headCommit: head, mode: 'merge-base' });
 });
 it('supports subdirectory roots and committed Unicode config names', async () => {
  const dir = await repo(), file = 'app/config/права [x].json';const base = await commit(dir, ['user:email'], file);await commit(dir, ['user'], file);
  const r = await compareGit(path.join(dir, 'app'), { base, config: './config/права [x].json' });
  expect(r.source?.configPath).toBe(file);expect(r.summary.expanded).toBe(1);
  const windows = await compareGit(path.join(dir, 'app'), { base, config: 'config\\права [x].json' });expect(windows).toEqual(r);
 });
 it('retains creation/deletion notices and refuses to invent a config when neither side contains one', async () => {
  const dir = await repo();await writeFile(path.join(dir, 'README'), 'fixture');git(dir, 'add', 'README');git(dir, 'commit', '-m', 'No config');const empty = git(dir, 'rev-parse', 'HEAD');
  const added = await commit(dir, ['gist']);
  expect((await compareGit(dir, { base: empty })).summary).toMatchObject({ added: 1, unknown: 1 });
  git(dir, 'rm', 'scopetrace.config.json');git(dir, 'commit', '-m', 'Remove declaration');
  expect((await compareGit(dir, { base: added })).summary).toMatchObject({ removed: 1, unknown: 1 });
  await expect(compareGit(dir, { base: empty })).rejects.toThrow('Neither');
 });
 it('ignores Git replacement refs', async () => {
  const dir = await repo(), base = await commit(dir, ['user:email']), head = await commit(dir, ['user']);
  git(dir, 'replace', base, head);
  expect((await compareGit(dir, { base, head })).summary.expanded).toBe(1);
 });
 it('does not run fsmonitor, smudge filters, hooks or a repository-local Git executable', async () => {
  const dir = await repo(), base = await commit(dir, ['user:email']);await commit(dir, ['user']);
  const marker = path.join(dir, 'execution-marker');
  const script = path.join(dir, '.git', 'forbidden.mjs');
  await writeFile(script, 'import fs from "node:fs";fs.writeFileSync(' + JSON.stringify(marker) + ',"unexpected");process.exit(1);');
  const command = '"' + process.execPath.replace(/\\/g, '/') + '" "' + script.replace(/\\/g, '/') + '"';
  git(dir, 'config', 'core.fsmonitor', command);git(dir, 'config', 'filter.evil.smudge', command);
  await writeFile(path.join(dir, '.gitattributes'), '*.json filter=evil');
  await writeFile(path.join(dir, process.platform === 'win32' ? 'git.exe' : 'git'), 'not a trusted executable');
  const oldPath = process.env.PATH;process.env.PATH = dir + path.delimiter + oldPath;
  try { expect((await compareGit(dir, { base })).summary.expanded).toBe(1); } finally { process.env.PATH = oldPath; }
  await expect(access(marker)).rejects.toThrow();
 });
 it('fails locally for missing objects in a partial clone instead of lazily invoking a transport', async () => {
  const dir = await repo(), base = await commit(dir, ['user:email']);await commit(dir, ['user']);
  const blob = git(dir, 'rev-parse', 'HEAD:scopetrace.config.json');
  const object = path.join(dir, '.git', 'objects', blob.slice(0, 2), blob.slice(2));await unlink(object);
  const marker = path.join(dir, 'network-marker'), script = path.join(dir, '.git', 'ssh-block.mjs');
  await writeFile(script, 'import fs from "node:fs";fs.writeFileSync(' + JSON.stringify(marker) + ',"transport invoked");process.exit(1);');
  git(dir, 'config', 'remote.origin.url', 'ssh://example.invalid/repository');git(dir, 'config', 'remote.origin.promisor', 'true');git(dir, 'config', 'extensions.partialClone', 'origin');
  git(dir, 'config', 'core.sshCommand', '"' + process.execPath.replace(/\\/g, '/') + '" "' + script.replace(/\\/g, '/') + '"');
  await expect(compareGit(dir, { base })).rejects.toThrow('Git comparison failed');
  await expect(access(marker)).rejects.toThrow();
 });
 it('rejects missing refs, options, invalid PRs and escaping/non-JSON config paths with sanitized errors', async () => {
  const dir = await repo(), base = await commit(dir, ['gist']);
  for (const opts of [{ base: '--output=untrusted_sentinel' }, { base: 'does-not-exist-sentinel' }, { base, head: '-evil' }, { base, config: '../secret.json' }, { base, config: '/secret.json' }, { base, config: 'C:\\secret.json' }, { base, config: '.env' }, { base, pullRequest: 0 }, { base, pullRequest: 1.5 }, { base, pullRequest: 2147483648 }, { base, pullRequest: 1, head: 'HEAD' }]) {
   const r = await compareGit(dir, opts).catch(error => error as Error);expect(r).toBeInstanceOf(Error);expect(String(r)).not.toContain('sentinel');
  }
 });
 it('bounds and validates committed JSON without revealing malformed source values', async () => {
  const dir = await repo(), base = await commit(dir, ['gist']);
  for (const text of ['{"untrusted_sentinel":', JSON.stringify({ provider: 'unsupported_sentinel', declaredScopes: [] }), ' '.repeat(65537)]) {
   await writeFile(path.join(dir, 'scopetrace.config.json'), text);git(dir, 'add', 'scopetrace.config.json');git(dir, 'commit', '-m', 'Malformed declaration');
   const r = await run(dir, ['compare', '--base', base, '--format', 'json']);expect(r.code).toBe(2);expect(r.stdout).toBe('');expect(r.stderr).not.toContain('sentinel');
  }
 });
 it('rejects a Git symlink blob even when its contents look like valid JSON', async () => {
  const dir = await repo(), base = await commit(dir, ['gist']);const blob = git(dir, 'rev-parse', 'HEAD:scopetrace.config.json');
  git(dir, 'update-index', '--cacheinfo', '120000,' + blob + ',scopetrace.config.json');git(dir, 'commit', '-m', 'Synthetic symlink mode');
  await expect(compareGit(dir, { base })).rejects.toThrow('regular committed file');
 });
 it('rejects absent merge history instead of guessing a baseline', async () => {
  const dir = await repo(), base = await commit(dir, ['gist']);git(dir, 'checkout', '--orphan', 'unrelated');git(dir, 'rm', '-f', 'scopetrace.config.json');await commit(dir, ['user']);
  await expect(compareGit(dir, { base, mergeBase: true })).rejects.toThrow('Git comparison failed');
 });
 it('rejects multiple equally good merge bases', async () => {
  const dir = await repo(), ancestor = await commit(dir, ['gist']), left = await commit(dir, ['user:email']);
  git(dir, 'checkout', '--detach', ancestor);const right = await commit(dir, ['user:follow']);
  const leftTree = git(dir, 'rev-parse', left + '^{tree}'), rightTree = git(dir, 'rev-parse', right + '^{tree}');
  const a = git(dir, 'commit-tree', leftTree, '-p', left, '-p', right, '-m', 'Crisscross A');
  const b = git(dir, 'commit-tree', rightTree, '-p', right, '-p', left, '-m', 'Crisscross B');
  await expect(compareGit(dir, { base: a, head: b, mergeBase: true })).rejects.toThrow('unambiguous merge base');
 });
 it('requires a trusted Git on PATH and never falls back to the current directory', async () => {
  const dir = await repo();await commit(dir, ['gist']);const before = process.env.PATH;process.env.PATH = '';
  try { await expect(compareGit(dir, { base: 'HEAD' })).rejects.toThrow('trusted Git'); } finally { process.env.PATH = before; }
 });
 it('writes the comparison report before an escalation gate fails and refuses overwrite', async () => {
  const dir = await repo(), base = await commit(dir, ['user:email']);await commit(dir, ['user']);
  const args = ['compare', '--base', base, '--format', 'json', '--output', 'diff.json', '--fail-on', 'high'];
  expect(await run(dir, args)).toEqual({ code: 1, stdout: '', stderr: '' });
  const content = await readFile(path.join(dir, 'diff.json'), 'utf8');expect(JSON.parse(content).summary.expanded).toBe(1);
  expect((await run(dir, args)).code).toBe(2);expect(await readFile(path.join(dir, 'diff.json'), 'utf8')).toBe(content);
  expect((await run(dir, ['compare', '--base', base, '--format', 'markdown'])).stdout).toContain('ACCESS INCREASE');
  expect((await run(dir, ['compare', '--base', base])).stdout).toContain('WARNING: ACCESS INCREASE');
  for (const bad of [['compare'], ['compare', '--base', base, '--format', 'sarif'], ['compare', '--base', base, '--provider', 'github-app'], ['compare', '--base', base, '--pr', '0'], ['scan', '--base', base], ['rules', '--fail-on-unknown']]) expect((await run(dir, bad)).code).toBe(2);
 });
 it('can require review of unknown comparison results independently from scan thresholds', async () => {
  const dir = await repo(), base = await commit(dir, []);await commit(dir, ['unrecognized_sentinel']);
  const report = await run(dir, ['compare', '--base', base, '--format', 'json', '--fail-on-unknown']);
  expect(report.code).toBe(1);expect(report.stdout).not.toContain('unrecognized_sentinel');expect(JSON.parse(report.stdout).analysis.complete).toBe(false);
  expect((await run(dir, ['compare', '--base', base])).code).toBe(0);
 });
});
