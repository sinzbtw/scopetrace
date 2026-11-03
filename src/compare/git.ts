import { access, lstat, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { configSchema, within, type Config } from '../config/index.js';
import { comparePermissions } from './engine.js';
import type { CompareGitOptions, ComparisonReport } from './types.js';
const execute = promisify(execFile);
function validRef(ref: string): boolean {
 return ref.length > 0 && ref.length <= 256 && !ref.startsWith('-') && !/[\s\x00-\x1f\x7f:]/u.test(ref);
}
function relativeConfig(file: string): string {
 const normalized = file.replace(/\\/g, '/');
 if (!normalized || normalized.length > 1024 || normalized.startsWith('/') || normalized.includes(':') || /[\x00-\x1f\x7f]/.test(normalized) || normalized.split('/').includes('..') || !normalized.toLowerCase().endsWith('.json')) {
  throw new Error('Compare config must be a relative JSON path inside the project, without parent traversal.');
 }
 const parts = normalized.split('/').filter(p => p && p !== '.');
 if (!parts.length) throw new Error('Compare config must identify a JSON file.');
 return parts.join('/');
}
async function trustedGit(cwd: string): Promise<string> {
 let boundary = cwd;
 for (let dir = cwd; ; dir = path.dirname(dir)) {
  try { await lstat(path.join(dir, '.git'));boundary = dir;break; } catch { /* Search ancestors without opening project data. */ }
  if (path.dirname(dir) === dir) break;
 }
 for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
  if (!path.isAbsolute(dir)) continue;
  try {
   const file = await realpath(path.join(dir, process.platform === 'win32' ? 'git.exe' : 'git'));
   if (within(boundary, file) || !(await lstat(file)).isFile()) continue;
   await access(file, constants.X_OK);
   return file;
  } catch { /* Ignore missing PATH entries; never fall back to the current directory. */ }
 }
 throw new Error('A trusted Git executable on an absolute PATH entry outside the project is required.');
}
export async function compareGit(cwd: string, options: CompareGitOptions): Promise<ComparisonReport> {
 if (!validRef(options.base) || (options.head !== undefined && !validRef(options.head))) throw new Error('Invalid Git ref. Use a local branch, tag or commit.');
 if (options.pullRequest !== undefined && (!Number.isSafeInteger(options.pullRequest) || options.pullRequest < 1 || options.pullRequest > 2147483647 || options.head !== undefined)) {
  throw new Error('PR must be a positive integer and cannot be combined with head.');
 }
 const config = relativeConfig(options.config ?? 'scopetrace.config.json');
 const current = await realpath(cwd);
 const binary = await trustedGit(current);
 const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
 Object.assign(env, { GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' });
 // Every command is read-only plumbing with lazy fetching, replace refs, paging
 // and fsmonitor disabled. No checkout, archive extraction, filters or hooks.
 const run = async (args: string[], directory: string, maxBuffer = 4096): Promise<string> => {
  try {
   const result = await execute(binary, ['--no-lazy-fetch', '--no-replace-objects', '--literal-pathspecs', '--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.quotePath=false', ...args],
    { cwd: directory, env, encoding: 'utf8', maxBuffer, timeout: 10000, windowsHide: true });
   return result.stdout;
  } catch { throw new Error('Git comparison failed. Use Git with --no-lazy-fetch support and fetch the required commits/history explicitly; repository contents and Git errors are not echoed.'); }
 };
 const root = (await run(['rev-parse', '--show-toplevel'], current)).replace(/\r?\n$/, '');
 if (!path.isAbsolute(root) || !within(root, current) || within(root, binary)) throw new Error('Compare requires a Git worktree and a trusted Git executable outside it.');
 const prefix = path.relative(root, current).split(path.sep).join('/');
 const configPath = relativeConfig((prefix ? prefix + '/' : '') + config);
 const resolve = async (ref: string) => {
  const sha = (await run(['rev-parse', '--verify', '--end-of-options', ref + '^{commit}'], root)).trim();
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha)) throw new Error('Git ref did not resolve to a supported commit identity.');
  return sha;
 };
 const requestedBaseCommit = await resolve(options.base);
 const headCommit = await resolve(options.pullRequest === undefined ? (options.head ?? 'HEAD') : 'refs/pull/' + options.pullRequest + '/head');
 const mergeBase = options.mergeBase === true || options.pullRequest !== undefined;
 let baseCommit = requestedBaseCommit;
 if (mergeBase) {
  const bases = (await run(['merge-base', '--all', requestedBaseCommit, headCommit], root)).trim().split(/\r?\n/);
  if (bases.length !== 1 || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(bases[0]!)) throw new Error('Comparison requires one unambiguous merge base; review the commit graph explicitly.');
  baseCommit = bases[0]!;
 }
 const read = async (commit: string): Promise<Config | null> => {
  const entry = await run(['ls-tree', '--full-tree', '-z', commit, '--', configPath], root, 8192);
  if (!entry) return null;
  const match = /^(100644|100755) blob ([0-9a-f]{40}|[0-9a-f]{64})\t([^\0]+)\0$/.exec(entry);
  if (!match || match[3] !== configPath) throw new Error('Comparison configuration must be a regular committed file, not a link, submodule or tree.');
  const size = (await run(['cat-file', '-s', match[2]!], root)).trim();
  if (!/^\d+$/.test(size) || Number(size) > 65536) throw new Error('Comparison configuration exceeds the 64 KiB limit.');
  const data = await run(['cat-file', 'blob', match[2]!], root, 65537);
  let input: unknown;
  try { input = JSON.parse(data); } catch { throw new Error('Comparison configuration is not valid JSON. Source values are omitted.'); }
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) throw new Error('Comparison configuration is invalid for a supported authorization provider. Source values are omitted.');
  return parsed.data;
 };
 const base = await read(baseCommit), head = await read(headCommit);
 const report = comparePermissions(base, head);
 report.source = { mode: mergeBase ? 'merge-base' : 'direct', requestedBaseCommit, baseCommit, headCommit, configPath,
  ...(options.pullRequest !== undefined ? { pullRequest: options.pullRequest } : {}) };
 return report;
}
