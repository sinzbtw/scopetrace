import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { configSchema, loadConfig, within } from '../../src/config/index.js';
import { scanProject } from '../../src/scanner/index.js';
const bases: string[]=[];
async function project(files: Record<string,string> = {}) {
 const parent=path.resolve('work/tests');await mkdir(parent,{recursive:true});
 const dir=await mkdtemp(path.join(parent,'scan-'));bases.push(dir);
 for(const [name,content] of Object.entries(files)){const full=path.join(dir,name);await mkdir(path.dirname(full),{recursive:true});await writeFile(full,content);}
 return dir;
}
const cfg = (extra: Record<string,unknown> = {}) => configSchema.parse({provider:'github-oauth',declaredScopes:[],...extra});
const call="fetch('https://api.github.com/user/emails');";
afterEach(async()=>{for(const dir of bases.splice(0))await rm(dir,{recursive:true,force:true});});
describe('strict config and boundary validation',()=>{
 it('loads JSON defaults and normalized cross-platform containment',async()=>{
  const dir=await project({'scopetrace.config.json':JSON.stringify({provider:'github-oauth',declaredScopes:[]})});
  expect((await loadConfig(dir)).limits.maxFiles).toBe(2000);
  expect(within(dir,path.join(dir,'src'))).toBe(true);
  expect(within(dir,path.resolve(dir,'..','outside'))).toBe(false);
 });
 it.each([
  {provider:'github-app',declaredScopes:[]},{provider:'github-oauth',declaredScopes:[],extra:true},
  {provider:'github-oauth',declaredScopes:['user:email'],limits:{maxFiles:0}},
  {provider:'github-oauth',declaredScopes:[],include:['../secret.ts']},
  {provider:'github-oauth',declaredScopes:[],include:['C:/secret.ts']},
  {provider:'github-oauth',declaredScopes:[],include:['src\\**\\*.ts']},
  {provider:'github-oauth',declaredScopes:['SENTINEL SPACE']},
  {provider:'github-oauth',declaredScopes:[],include:[]}
 ])('rejects invalid config %j',async input=>{
  const dir=await project({'scopetrace.config.json':JSON.stringify(input)});
  await expect(loadConfig(dir)).rejects.toThrow('Invalid config');
 });
 it('rejects executable, outside-root, oversized and malformed configs without source snippets',async()=>{
  const dir=await project({'bad.json':"SENTINEL {", 'big.json':' '.repeat(65537), 'config.js':"throw new Error('EXECUTED')"});
  await expect(loadConfig(dir,'../outside.json')).rejects.toThrow('inside');
  await expect(loadConfig(dir,'config.js')).rejects.toThrow('JSON');
  await expect(loadConfig(dir,'big.json')).rejects.toThrow('64 KiB');
  await expect(loadConfig(dir,'bad.json')).rejects.toThrow('not valid JSON');
 });
 it('rejects symlinked configuration through a directory junction',async()=>{
  const external=await project({'config.json':'{}'});
  const dir=await project();
  await symlink(external,path.join(dir,'linked'),'junction');
  await expect(loadConfig(dir,'linked/config.json')).rejects.toThrow('inside');
 });
});
describe('safe, bounded deterministic traversal',()=>{
 it('scans supported extensions, ignores secrets, dependencies and exclusions, never executes source',async()=>{
  const dir=await project({'src/b.js':call,'src/a.tsx':call,'src/c.jsx':call,'src/d.ts':call,'src/a.test.ts':call,
   '.env':call,'.env.ts':call,'id_rsa.ts':call,'src/key.pem':call,'node_modules/evil.ts':call,
   '.git/config.ts':call,'dist/out.ts':call,'src/other.txt':call,'execute.ts':"throw new Error('EXECUTED'); "+call});
  const before=await readFile(path.join(dir,'src/b.js'),'utf8');
  const result=await scanProject(dir,cfg());
  expect(result.filesScanned).toBe(5);expect(result.operations).toHaveLength(5);
  expect(result.operations.map(o=>o.location.file)).toEqual(['execute.ts','src/a.tsx','src/b.js','src/c.jsx','src/d.ts']);
  expect(await readFile(path.join(dir,'src/b.js'),'utf8')).toBe(before);
 });
 it('enforces per-file and total-byte limits',async()=>{
  const dir=await project({'a.ts':call,'b.ts':call,'large.ts':' '.repeat(200)});
  const small=await scanProject(dir,cfg({limits:{maxFileBytes:100}}));
  expect(small.filesScanned).toBe(2);expect(small.notices.some(n=>n.code==='file-size-limit')).toBe(true);
  const total=await scanProject(dir,cfg({limits:{maxTotalBytes:call.length}}));
  expect(total.filesScanned).toBe(1);expect(total.notices.some(n=>n.code==='total-size-limit')).toBe(true);
 });
 it('enforces file, entry and depth limits',async()=>{
  const dir=await project({'a.ts':call,'b.ts':call,'nested/deep/c.ts':call});
  const files=await scanProject(dir,cfg({limits:{maxFiles:1}}));
  expect(files.filesScanned).toBe(1);expect(files.notices.some(n=>n.code==='file-limit')).toBe(true);
  const entries=await scanProject(dir,cfg({limits:{maxEntries:1}}));
  expect(entries.complete).toBe(false);expect(entries.notices.some(n=>n.code==='entry-limit')).toBe(true);
  const depth=await scanProject(dir,cfg({limits:{maxDepth:1}}));
  expect(depth.notices.some(n=>n.code==='depth-limit')).toBe(true);
 });
 it('never follows symlinks or junctions outside root',async()=>{
  const external=await project({'outside.ts':call});
  const dir=await project({'a.ts':call});
  await symlink(external,path.join(dir,'outside'),'junction');
  const result=await scanProject(dir,cfg());
  expect(result.filesScanned).toBe(1);expect(result.notices.some(n=>n.code==='symlink-skipped')).toBe(true);
  expect(result.complete).toBe(false);
 });
 it('reports empty selection and invalid syntax as incomplete',async()=>{
  const dir=await project({'bad.ts':'function( SENTINEL'});
  expect((await scanProject(dir,cfg())).notices[0]?.code).toBe('syntax-error');
  const empty=await scanProject(dir,cfg({include:['none/**/*.ts']}));
  expect(empty.notices[0]?.code).toBe('no-files');
 });
 it('contains parser stack failures from deeply nested hostile syntax',async()=>{
  const dir=await project({'nested.ts':'('.repeat(25000)+'value'+')'.repeat(25000)});
  const result=await scanProject(dir,cfg());
  expect(result.complete).toBe(false);expect(result.notices.some(n=>n.code==='parser-limit')).toBe(true);
 });
 it('has deterministic output independent of directory creation order',async()=>{
  const a=await project({'z.ts':call,'a.ts':call}), b=await project({'a.ts':call,'z.ts':call});
  expect(await scanProject(a,cfg())).toEqual(await scanProject(b,cfg()));
 });
 it('applies explicit folder exclusions before recursion',async()=>{
  const dir=await project({'skip/a.ts':call,'keep/b.ts':call});
  expect((await scanProject(dir,cfg({exclude:['skip/**']}))).filesScanned).toBe(1);
 });
});
