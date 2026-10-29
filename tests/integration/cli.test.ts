import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import { runCli } from '../../src/cli/run.js';
const roots:string[]=[];
async function fixture() {
 const parent=path.resolve('work/tests');await mkdir(parent,{recursive:true});
 const dir=await mkdtemp(path.join(parent,'cli-'));roots.push(dir);return dir;
}
async function run(args:string[],dir:string) {
 let stdout='',stderr=''; const code=await runCli(args,dir,{stdout:s=>{stdout+=s;},stderr:s=>{stderr+=s;}});
 return {code,stdout,stderr};
}
afterEach(async()=>{for(const dir of roots.splice(0))await rm(dir,{recursive:true,force:true});});
describe('CLI integration',()=>{
 it('provides help, version and documented rules',async()=>{
  const dir=await fixture();
  expect((await run([],dir)).stdout).toContain('Usage:');
  expect((await run(['--help'],dir)).code).toBe(0);
  expect((await run(['--version'],dir)).stdout.trim()).toBe('0.1.0');
  const rules=await run(['rules'],dir);expect(rules.code).toBe(0);expect(rules.stdout).toContain('gh.email.list');expect(rules.stdout).toContain('https://docs.github.com/');
 });
 it('initializes exclusively and rejects command/options errors',async()=>{
  const dir=await fixture();expect((await run(['init'],dir)).code).toBe(0);
  const before=await readFile(path.join(dir,'scopetrace.config.json'),'utf8');
  expect((await run(['init'],dir)).code).toBe(2);expect(await readFile(path.join(dir,'scopetrace.config.json'),'utf8')).toBe(before);
  for(const args of [['unknown'],['scan','extra'],['init','--format','json'],['scan','--format','csv'],['scan','--fail-on','fatal'],['scan','--unknown=SENTINEL']]){
   const result=await run(args,dir);expect(result.code).toBe(2);expect(result.stdout).toBe('');expect(result.stderr).not.toContain('SENTINEL');
  }
 });
 it('scans the committed fixture with accurate exit codes and clean JSON',async()=>{
  const dir=path.resolve('tests/fixtures/basic');
  const result=await run(['scan','--format','json','--fail-on','high'],dir);
  expect(result.code).toBe(1);expect(result.stderr).toBe('');
  const report=JSON.parse(result.stdout);
  expect(report.schemaVersion).toBe('1.0.0');expect(report.operations).toHaveLength(3);
  expect(report.findings.some((f:{category:string})=>f.category==='insufficient')).toBe(true);
  expect((await run(['scan'],dir)).code).toBe(0);
 });
 it('supports a custom config and exclusive JSON/Markdown export',async()=>{
  const dir=await fixture();
  await writeFile(path.join(dir,'custom.json'),JSON.stringify({provider:'github-oauth',declaredScopes:[],include:['*.ts']}));
  await writeFile(path.join(dir,'app.ts'),"fetch('https://api.github.com/user/emails');");
  const args=['scan','--config','custom.json','--format','json','--output','report.json'];
  expect(await run(args,dir)).toEqual({code:0,stdout:'',stderr:''});
  expect(JSON.parse(await readFile(path.join(dir,'report.json'),'utf8')).operations).toHaveLength(1);
  expect((await run(args,dir)).code).toBe(2);
  expect((await run(['scan','--config','custom.json','--format','markdown','--output','report.md'],dir)).code).toBe(0);
  expect(await readFile(path.join(dir,'report.md'),'utf8')).toContain('# ScopeTrace report');
 });
 it('reports missing or malformed configuration without leaking snippets',async()=>{
  const dir=await fixture();
  expect((await run(['scan'],dir)).code).toBe(2);
  await writeFile(path.join(dir,'scopetrace.config.json'),'{"SENTINEL":');
  const result=await run(['scan'],dir);expect(result.code).toBe(2);expect(result.stderr).not.toContain('SENTINEL');
 });
 it('rejects output through a directory junction',async()=>{
  const dir=await fixture(),external=await fixture();
  await writeFile(path.join(dir,'scopetrace.config.json'),JSON.stringify({provider:'github-oauth',declaredScopes:[]}));
  await symlink(external,path.join(dir,'link'),'junction');
  const result=await run(['scan','--output','link/out.json'],dir);expect(result.code).toBe(2);expect(result.stderr).toContain('symbolic link');
 });
});
