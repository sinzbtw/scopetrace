import { constants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import path from 'node:path';
import picomatch from 'picomatch';
import type { Config } from '../config/index.js';
import { within } from '../config/index.js';
import type { ScanResult } from '../types.js';
import { parseSource } from './ast.js';

const blocked = new Set(['node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'coverage', '.next', '.env', '.ssh', '.aws', '.codex']);
const secretName = /(?:^\.env(?:\.|$)|\.(?:pem|key|p12|pfx|crt|cer)$|^id_(?:rsa|ed25519|ecdsa)(?:\.|$))/i;
export async function scanProject(root: string, config: Config): Promise<ScanResult> {
 const base = await realpath(root);
 const result: ScanResult = { operations: [], notices: [], filesScanned: 0, complete: true };
 const include = picomatch(config.include, { dot: false });
 const exclude = picomatch(config.exclude, { dot: true });
 let entries = 0, totalBytes = 0, stopped = false;
 const notice = (code: string, message: string) => { result.complete = false; result.notices.push({ code, message }); };
 async function walk(dir: string, depth: number): Promise<void> {
  if (stopped) return;
  if (depth > config.limits.maxDepth) { notice('depth-limit', 'A directory exceeded the maximum traversal depth.'); return; }
  const collected: { name: string; symbolic: boolean; directory: boolean; file: boolean }[] = [];
  try {
   const handle = await opendir(dir);
   for await (const entry of handle) {
    if (++entries > config.limits.maxEntries) { notice('entry-limit', 'Traversal entry limit reached.'); stopped = true; break; }
    collected.push({ name: entry.name, symbolic: entry.isSymbolicLink(), directory: entry.isDirectory(), file: entry.isFile() });
   }
  } catch { notice('directory-unreadable', 'A directory could not be read.'); return; }
  collected.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const entry of collected) {
   if (stopped) break;
   const full = path.join(dir, entry.name);
   const relative = path.relative(base, full).split(path.sep).join('/');
   if (blocked.has(entry.name) || secretName.test(entry.name) || exclude(relative) || exclude(relative + '/')) continue;
   if (entry.symbolic) { notice('symlink-skipped', 'A symbolic link or junction was skipped.'); continue; }
   try {
    const stat = await lstat(full);
    if (stat.isSymbolicLink() || !within(base, await realpath(full))) { notice('boundary-skipped', 'A path failed the project boundary check.'); continue; }
    if (entry.directory && stat.isDirectory()) { await walk(full, depth + 1); continue; }
    if (!entry.file || !stat.isFile() || !/\.(?:js|jsx|ts|tsx)$/i.test(entry.name) || !include(relative)) continue;
    if (result.filesScanned >= config.limits.maxFiles) { notice('file-limit', 'Source file limit reached.'); stopped = true; break; }
    if (stat.size > config.limits.maxFileBytes) { notice('file-size-limit', 'A source file exceeded the byte limit.'); continue; }
    if (totalBytes + stat.size > config.limits.maxTotalBytes) { notice('total-size-limit', 'Total source byte limit reached.'); stopped = true; break; }
    const fd = await open(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
     const opened = await fd.stat();
     if (!opened.isFile() || opened.size > config.limits.maxFileBytes || opened.ino !== stat.ino || !within(base, await realpath(full))) {
      notice('file-changed', 'A source file changed during the boundary check.'); continue;
     }
     const buffer = Buffer.alloc(config.limits.maxFileBytes + 1);
     const { bytesRead } = await fd.read(buffer, 0, buffer.length, 0);
     if (bytesRead > config.limits.maxFileBytes) { notice('file-size-limit', 'A source file exceeded the byte limit.'); continue; }
     if (totalBytes + bytesRead > config.limits.maxTotalBytes) { notice('total-size-limit', 'Total source byte limit reached.'); stopped = true; break; }
     if (bytesRead < opened.size) { notice('short-read', 'A source file could not be read completely.'); continue; }
     totalBytes += bytesRead;
     result.filesScanned++;
     try {
      const parsed = parseSource(buffer.subarray(0, bytesRead).toString('utf8'), relative);
      result.operations.push(...parsed.operations);
      result.notices.push(...parsed.notices);
      if (parsed.notices.length) result.complete = false;
     } catch { notice('parser-limit', 'A source file could not be safely parsed.'); }
    } finally { await fd.close(); }
   } catch { notice('file-unreadable', 'A filesystem entry could not be safely read.'); }
  }
 }
 await walk(base, 0);
 if (result.filesScanned === 0) notice('no-files', 'No matching source files were analyzed; check include patterns.');
 result.operations.sort((a, b) => a.location.file < b.location.file ? -1 : a.location.file > b.location.file ? 1 : a.location.line - b.location.line || a.location.column - b.location.column);
 return result;
}
