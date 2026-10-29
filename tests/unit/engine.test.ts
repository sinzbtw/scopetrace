import { describe, expect, it } from 'vitest';
import { configSchema } from '../../src/config/index.js';
import { evaluate, findingId, shouldFail } from '../../src/engine/index.js';
import { catalog, covers, normalizeScopes } from '../../src/providers/github/index.js';
import { parseSource } from '../../src/scanner/ast.js';
import { render } from '../../src/reporters/index.js';
import type { ScanResult } from '../../src/types.js';
const cfg = (scopes: string[] = [], visibility: 'unknown'|'public'|'private' = 'unknown') => configSchema.parse({provider:'github-oauth', declaredScopes:scopes, repositoryVisibility:visibility});
const scan = (code: string): ScanResult => ({...parseSource(code,'src/app.ts'),filesScanned:1,complete:true});
const pre = "import {Octokit} from 'octokit';const api=new Octokit();";
describe('OAuth scope model and engine', () => {
 it('normalizes nested scopes and does not conflate sibling grants', () => {
  expect(covers('user','user:email')).toBe(true);
  expect(covers('repo','read:repo_hook')).toBe(true);
  expect(covers('admin:org','read:org')).toBe(true);
  expect(covers('repo','delete_repo')).toBe(false);
  expect(covers('repo','workflow')).toBe(false);
  expect(covers('public_repo','repo')).toBe(false);
  expect(covers('write:org','repo')).toBe(false);
  expect(normalizeScopes(['user:email','user','gist','user'])).toEqual(['gist','user']);
 });
 it('handles implication cycles defensively', () => {
  catalog.implies['cycle:a']=['cycle:b'];catalog.implies['cycle:b']=['cycle:a'];
  try { expect(covers('cycle:a','never')).toBe(false); } finally { delete catalog.implies['cycle:a'];delete catalog.implies['cycle:b']; }
 });
 it('distinguishes observed, insufficient and possible excess', () => {
  const s = scan(pre+'api.rest.users.listEmailsForAuthenticatedUser();');
  expect(evaluate(s,cfg(['user:email'])).findings[0]?.category).toBe('observed');
  expect(evaluate(s,cfg()).findings.some(f => f.category === 'insufficient')).toBe(true);
  expect(evaluate(s,cfg(['user','workflow'])).findings.filter(f => f.category==='possibly_excessive')).toHaveLength(2);
 });
 it('gates high severity only on sufficient confidence and insufficiency', () => {
  const report = evaluate(scan(pre+'api.rest.repos.delete({});'),cfg(['repo']));
  expect(shouldFail(report,'high')).toBe(true);
  expect(shouldFail(report,'info')).toBe(true);
  const email = evaluate(scan("fetch('https://api.github.com/user/emails');"),cfg());
  expect(shouldFail(email,'high')).toBe(false);
  expect(shouldFail(email,'medium')).toBe(true);
  expect(shouldFail(evaluate(scan(''),cfg(['repo'])),'low')).toBe(false);
  report.findings.filter(f=>f.category==='insufficient').forEach(f=>{f.confidence='low';});
  expect(shouldFail(report,'info')).toBe(false);
 });
 it('never assumes a repository is public or private', () => {
  const s = scan("fetch('https://api.github.com/repos/o/r');");
  expect(evaluate(s,cfg()).findings[0]?.category).toBe('unknown');
  expect(evaluate(s,cfg([],'public')).findings[0]?.category).toBe('not_applicable');
  expect(evaluate(s,cfg([],'private')).findings[0]).toMatchObject({category:'insufficient',confidence:'medium'});
  expect(evaluate(s,cfg(['repo'],'private')).findings[0]?.category).toBe('observed');
 });
 it('public reads do not justify a declared broad grant', () => {
  const report = evaluate(scan(pre+'api.rest.users.getByUsername({username:"x"});'),cfg(['repo']));
  expect(report.findings.some(f=>f.category==='not_applicable')).toBe(true);
  expect(report.findings.some(f=>f.category==='possibly_excessive')).toBe(true);
 });
 it('reports unsupported operations, offline_access and unknown scope names honestly', () => {
  const report = evaluate(scan(pre+"api.graphql('SENTINEL');api.rest.repos.listForAuthenticatedUser();"),cfg(['offline_access','ghp_sentinel']));
  expect(report.findings.filter(f=>f.category==='unknown')).toHaveLength(4);
  expect(JSON.stringify(report)).not.toContain('sentinel');
  expect(report.declaredScopes).toContain('<unrecognized>');
 });
 it('keeps stable ids independent of scan order', () => {
  const s = scan(pre+'api.rest.users.follow({});api.rest.gists.create({});');
  expect(evaluate(s,cfg()).findings.map(f=>f.id)).toEqual(evaluate({...s,operations:[...s.operations].reverse()},cfg()).findings.map(f=>f.id));
  expect(findingId('a')).not.toBe(findingId('b'));
 });
 it('turns traversal notices into unknown findings', () => {
  const s: ScanResult={operations:[],notices:[{code:'limit',message:'Limit reached.'}],filesScanned:0,complete:false};
  expect(evaluate(s,cfg()).findings[0]).toMatchObject({category:'unknown',message:'Limit reached.'});
  expect(evaluate(s,cfg()).analysis.complete).toBe(false);
 });
 it('attaches source evidence and documented alternatives', () => {
  const report=evaluate(scan(pre+'api.rest.gists.create({});'),cfg(['gist']));
  expect(report.findings[0]).toMatchObject({category:'observed',ruleId:'gh.gist.create',alternatives:[['gist']],operation:{location:{file:'src/app.ts'}}});
  expect(report.findings[0]?.docs.every(d=>d.startsWith('https://docs.github.com/'))).toBe(true);
 });
});
describe('reporters', () => {
 it('produces machine-readable stable JSON without decoration', () => {
  const report=evaluate(scan("fetch('https://api.github.com/user/emails');"),cfg());
  expect(JSON.parse(render(report,'json'))).toEqual(report);
  expect(render(report,'json').startsWith('{')).toBe(true);
 });
 it('includes rule, location, confidence and docs in terminal output', () => {
  const text=render(evaluate(scan("fetch('https://api.github.com/user/emails');"),cfg()),'text');
  expect(text).toContain('\n  Rule: gh.email.list');expect(text).toContain('src/app.ts:1:1');expect(text).toContain('medium/high');expect(text).toContain('https://docs.github.com/');
 });
 it('escapes malicious Markdown filenames and strips terminal control sequences', () => {
  const s=scan("fetch('https://api.github.com/user/emails');");s.operations[0]!.location.file='<img src=x>|[evil]\x1b.ts';
  const report=evaluate(s,cfg());
  expect(render(report,'markdown')).toContain('&lt;img src=x&gt;\\|\\[evil\\]?');
  expect(render(report,'text')).not.toContain('\x1b');
  expect(render(report,'markdown')).toContain('## Limits');
 });
 it('does not render source text or Authorization values in any format', () => {
  const report=evaluate(scan(pre+"api.request('GET /user/emails',{headers:{Authorization:'SENTINEL'}});"),cfg());
  for(const format of ['text','json','markdown'] as const) {
   expect(render(report,format)).not.toContain('SENTINEL');
   expect(render(report,format)).not.toContain('Authorization');
  }
 });
});
