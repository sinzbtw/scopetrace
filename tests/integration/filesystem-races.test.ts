import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, open, rename, rm, writeFile, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { configSchema, loadConfig } from '../../src/config/index.js';
import { scanProject } from '../../src/scanner/index.js';

vi.mock('node:fs/promises', async importOriginal => {
 const actual = await importOriginal<typeof import('node:fs/promises')>();
 return { ...actual, open: vi.fn(actual.open) };
});
const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
const parent = path.resolve('work/tests'), roots: string[] = [];
const json = JSON.stringify({ provider: 'github-oauth', declaredScopes: [] });
async function fixture(name = 'scopetrace.config.json', content = json) {
 await mkdir(parent, { recursive: true });
 const root = await mkdtemp(path.join(parent, 'file-race-'));roots.push(root);
 const file = path.join(root, name);await writeFile(file, content);
 return { root, file };
}
function interceptOpen(hook: (handle: FileHandle) => Promise<void> | void) {
 vi.mocked(open).mockImplementationOnce(async (...args) => {
  const handle = await actual.open(...args);
  await hook(handle);
  return handle;
 });
}
beforeEach(() => { vi.mocked(open).mockReset().mockImplementation(actual.open); });
afterEach(async () => {
 vi.restoreAllMocks();
 for (const root of roots.splice(0)) {
  expect(path.resolve(root).startsWith(parent + path.sep)).toBe(true);
  await rm(root, { recursive: true, force: true });
 }
});

describe('configuration reads under concurrent changes', () => {
 it('accepts exactly 64 KiB and rejects a one-byte excess', async () => {
  const { root, file } = await fixture();
  await writeFile(file, json.padEnd(65536));
  expect((await loadConfig(root)).provider).toBe('github-oauth');
  await writeFile(file, json.padEnd(65537));
  await expect(loadConfig(root)).rejects.toThrow('64 KiB');
 });
 it('bounds actual reads when a configuration grows after its size was checked', async () => {
  const { root, file } = await fixture();
  let handle: FileHandle | undefined, grown = false;
  interceptOpen(fd => {
   handle = fd;
   const stat = fd.stat.bind(fd);
   vi.spyOn(fd, 'read');
   vi.spyOn(fd, 'stat').mockImplementationOnce(async () => {
    const before = await stat();
    await writeFile(file, json.padEnd(131072));grown = true;
    return before;
   });
  });
  await expect(loadConfig(root)).rejects.toThrow('64 KiB');
  expect(grown).toBe(true);
  expect(handle).toBeDefined();
  expect(vi.mocked(handle!.read).mock.calls[0]?.[0]).toHaveLength(65537);
  await expect(handle!.stat()).rejects.toMatchObject({ code: 'EBADF' });
 });
 it('rejects a replacement path and closes the original descriptor without reading it', async () => {
  const { root, file } = await fixture();
  let handle: FileHandle | undefined;
  interceptOpen(async fd => {
   handle = fd;vi.spyOn(fd, 'read');
   await rename(file, path.join(root, 'original.json'));
   await writeFile(file, json);
  });
  await expect(loadConfig(root)).rejects.toThrow('64 KiB');
  expect(handle).toBeDefined();expect(handle!.read).not.toHaveBeenCalled();
  await expect(handle!.stat()).rejects.toMatchObject({ code: 'EBADF' });
 });
 it('handles short reads until EOF instead of parsing an incomplete buffer', async () => {
  const { root } = await fixture();
  interceptOpen(fd => {
   const read = fd.read.bind(fd);
   // A regular-file read may return fewer bytes than requested.
   vi.spyOn(fd, 'read').mockImplementation(((buffer: Buffer, offset: number, length: number, position: number) =>
    read(buffer, offset, Math.min(length, 7), position)) as typeof fd.read);
  });
  expect((await loadConfig(root)).provider).toBe('github-oauth');
 });
 it('rejects truncation after the initial descriptor check', async () => {
  const { root, file } = await fixture();
  interceptOpen(fd => {
   const stat = fd.stat.bind(fd);
   vi.spyOn(fd, 'stat').mockImplementationOnce(async () => {
    const before = await stat();await writeFile(file, '{}');return before;
   });
  });
  await expect(loadConfig(root)).rejects.toThrow('64 KiB');
 });
});

describe('scanner descriptor validation', () => {
 it('rejects source content changed during a read rather than reporting stale operations', async () => {
  const { root, file } = await fixture('app.ts', "fetch('https://api.github.com/user/emails');");
  interceptOpen(fd => {
   const read = fd.read.bind(fd);
   vi.spyOn(fd, 'read').mockImplementation((async (buffer: Buffer, offset: number, length: number, position: number) => {
    const result = await read(buffer, offset, length, position);
    await writeFile(file, 'SYNTHETIC_CHANGED_SOURCE');
    return result;
   }) as typeof fd.read);
  });
  const report = await scanProject(root, configSchema.parse({ provider: 'github-oauth', declaredScopes: [] }));
  expect(report.complete).toBe(false);expect(report.filesScanned).toBe(0);expect(report.operations).toEqual([]);
  expect(report.notices.some(n => n.code === 'file-changed')).toBe(true);
  expect(JSON.stringify(report)).not.toContain('SYNTHETIC_CHANGED_SOURCE');
 });
 it('skips a replaced source path before reading and closes the descriptor', async () => {
  const { root, file } = await fixture('app.ts', "fetch('https://api.github.com/user/emails');");
  let handle: FileHandle | undefined;
  interceptOpen(async fd => {
   handle = fd;vi.spyOn(fd, 'read');
   await rename(file, path.join(root, 'original.txt'));
   await writeFile(file, "fetch('https://api.github.com/user/emails');");
  });
  const report = await scanProject(root, configSchema.parse({ provider: 'github-oauth', declaredScopes: [] }));
  expect(report.complete).toBe(false);expect(report.filesScanned).toBe(0);expect(report.operations).toEqual([]);
  expect(report.notices.some(n => n.code === 'file-changed')).toBe(true);
  expect(handle).toBeDefined();expect(handle!.read).not.toHaveBeenCalled();
  await expect(handle!.stat()).rejects.toMatchObject({ code: 'EBADF' });
 });
});
