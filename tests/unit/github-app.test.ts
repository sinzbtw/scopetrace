import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { appConfigSchema, configSchema } from '../../src/config/index.js';
import { evaluate, shouldFail } from '../../src/engine/index.js';
import { appCatalog, levelCovers } from '../../src/providers/github-app/index.js';
import { normalizeEndpoint } from '../../src/providers/github/index.js';
import { parseSource } from '../../src/scanner/ast.js';
import { render } from '../../src/reporters/index.js';
import type { AppConfig } from '../../src/config/index.js';
import type { PermissionDomain, PermissionLevel } from '../../src/types.js';
const pre="import {Octokit as GH} from '@octokit/rest'; const api = new GH();\n";
type Permissions = Partial<Record<PermissionDomain, Record<string, PermissionLevel>>>;
const cfg=(permissions:Permissions={}, extra:Record<string,unknown>={}):AppConfig=>appConfigSchema.parse({
 provider:'github-app',tokenType:'installation',declaredPermissions:permissions,repositoryVisibility:'private',...extra
});
const scan=(code:string)=>({...parseSource(code,'src/app.ts','github-app'),filesScanned:1,complete:true});
const report=(code:string,permissions:Permissions={},extra:Record<string,unknown>={})=>evaluate(scan(pre+code),cfg(permissions,extra));
describe('GitHub App configuration and levels',()=>{
 it('keeps OAuth scopes and App permissions mutually exclusive',()=>{
  expect(configSchema.safeParse({provider:'github-app',declaredScopes:[]}).success).toBe(false);
  expect(configSchema.safeParse({provider:'github-oauth',declaredScopes:[],declaredPermissions:{}}).success).toBe(false);
  expect(configSchema.safeParse({provider:'github-app',tokenType:'user',declaredPermissions:{},declaredScopes:[]}).success).toBe(false);
  expect(configSchema.safeParse({provider:'github-app',declaredPermissions:{}}).success).toBe(false);
  expect(configSchema.safeParse({provider:'fine-grained-pat',declaredPermissions:{}}).success).toBe(false);
 });
 it.each(['admin','none','READ',true,3,null])('rejects an invalid permission level %s',level=>{
  expect(appConfigSchema.safeParse({provider:'github-app',tokenType:'installation',declaredPermissions:{repository:{contents:level}}}).success).toBe(false);
 });
 it('rejects unrecognized permissions and cross-domain names',()=>{
  expect(()=>cfg({repository:{emails:'read'}})).toThrow();
  expect(()=>cfg({account:{contents:'write'}})).toThrow();
  expect(()=>cfg({organization:{mystery:'read'}})).toThrow();
 });
 it('fills missing domains and retains explicit token type and limits',()=>{
  expect(cfg()).toMatchObject({provider:'github-app',tokenType:'installation',declaredPermissions:{repository:{},organization:{},account:{}},limits:{maxFiles:2000}});
 });
 it('uses a write >= read ordering without inferring other permission coverage',()=>{
  expect(levelCovers('write','read')).toBe(true);expect(levelCovers('write','write')).toBe(true);
  expect(levelCovers('read','write')).toBe(false);expect(levelCovers(undefined,'read')).toBe(false);
  expect(report('api.rest.issues.create({});',{repository:{contents:'write'}}).findings.some(f=>f.category==='insufficient')).toBe(true);
 });
 it('rejects prototype-name permissions without throwing internal type errors',()=>{
  for(const key of ['constructor','toString','__proto__']){
   const input=JSON.parse('{"repository":{"'+key+'":"read"}}');
   expect(appConfigSchema.safeParse({provider:'github-app',tokenType:'installation',declaredPermissions:input}).success).toBe(false);
  }
 });
});
describe('App AST rules and normalized operations',()=>{
 it('recognizes every catalog Octokit mapping without changing OAuth mappings',()=>{
  for(const rule of appCatalog.rules) for(const method of rule.octokit){
   expect(scan(pre+'api.rest.'+method+'({});').operations[0]).toMatchObject({provider:'github-app',method:rule.method,endpoint:rule.endpoint});
  }
  expect(parseSource(pre+'api.rest.issues.create({});','src/app.ts').operations[0]?.reason).toBeDefined();
 });
 it('normalizes fetch URLs and imported aliases without retaining URL values',()=>{
  expect(scan("fetch('https://api.github.com/repos/PRIVATE_OWNER/PRIVATE_REPO/issues/25?token=SENTINEL');").operations[0]).toMatchObject({provider:'github-app',method:'GET',endpoint:'/repos/{owner}/{repo}/issues/{issue_number}'});
  expect(JSON.stringify(scan("fetch('https://api.github.com/orgs/PRIVATE_ORG/memberships/PRIVATE_USER');"))).not.toContain('PRIVATE_');
  expect(normalizeEndpoint('/repos/o/r/issues/2',false,'github-app')).toBe('/repos/{owner}/{repo}/issues/{issue_number}');
  expect(normalizeEndpoint('/repos/o/r/issues/2')).toBe('/<unsupported>');
 });
 it('retains unknown routes, GraphQL and custom transports',()=>{
  const r=report("api.graphql('SENTINEL');api.request(route);api.rest.repos.unsupportedMethod({path:dynamic});");
  expect(r.findings.filter(f=>f.category==='unknown')).toHaveLength(3);
  expect(JSON.stringify(r)).not.toContain('SENTINEL');
 });
 it('rejects model mismatches instead of reinterpreting OAuth operations as Apps',()=>{
  const oauthScan={...parseSource("fetch('https://api.github.com/user/emails');",'app.ts'),filesScanned:1,complete:true};
  expect(()=>evaluate(oauthScan,cfg())).toThrow('does not match');
 });
});
describe('required, excessive and sufficient App permissions',()=>{
 it('reports missing permissions and read-to-write deficiencies with machine evidence',()=>{
  const missing=report('api.rest.issues.create({});').findings.find(f=>f.category==='insufficient');
  expect(missing).toMatchObject({permission:{domain:'repository',name:'issues'},declaredLevel:'none',requiredLevel:'write',severity:'high',confidence:'high',ruleId:'gha.issues.create',operation:{location:{line:2,column:1}}});
  const r=report('api.rest.issues.create({});',{repository:{issues:'read'}});
  expect(r.findings.find(f=>f.category==='insufficient')).toMatchObject({declaredLevel:'read',requiredLevel:'write'});
  expect(shouldFail(r,'high')).toBe(true);
 });
 it('observes a sufficient write grant and does not recommend narrowing after a write',()=>{
  const r=report('api.rest.issues.get({});api.rest.issues.create({});',{repository:{issues:'write'}});
  expect(r.findings.every(f=>f.category==='observed')).toBe(true);
 });
 it('suggests write-to-read only with low confidence for read-only observations',()=>{
  const r=report('api.rest.issues.get({});',{repository:{issues:'write'}});
  expect(r.findings.find(f=>f.category==='possibly_excessive')).toMatchObject({permission:{domain:'repository',name:'issues'},declaredLevel:'write',requiredLevel:'read',suggestedLevel:'read',confidence:'low'});
  expect(shouldFail(r,'low')).toBe(false);
 });
 it('marks unused declared rights as possibly excessive, never proven vulnerabilities',()=>{
  const r=report('',{repository:{contents:'write'},organization:{members:'read'}});
  expect(r.findings).toHaveLength(2);expect(r.findings.every(f=>f.category==='possibly_excessive'&&f.confidence==='low'&&f.severity==='low')).toBe(true);
 });
 it('handles public, private and unknown repository visibility separately',()=>{
  const code='api.rest.repos.getContent({});';
  expect(report(code).findings[0]).toMatchObject({category:'insufficient',requiredLevel:'read',severity:'medium',confidence:'medium'});
  expect(report(code,{}, {repositoryVisibility:'public'}).findings[0]?.category).toBe('not_applicable');
  expect(report(code,{}, {repositoryVisibility:'unknown'}).findings[0]?.category).toBe('unknown');
  expect(report(code,{repository:{contents:'read'}}).findings[0]?.category).toBe('observed');
 });
 it('does not flag potentially implicit Metadata read as absent or removable',()=>{
  expect(report('api.rest.repos.get({});').findings[0]?.category).toBe('unknown');
  expect(report('',{repository:{metadata:'read'}}).findings[0]?.category).toBe('not_applicable');
  expect(report('api.rest.repos.get({});',{repository:{metadata:'read'}}).findings[0]?.category).toBe('observed');
  expect(report('api.rest.repos.get({});',{repository:{metadata:'write'}}).findings.some(f=>f.suggestedLevel==='read')).toBe(true);
 });
 it('distinguishes required Contents write from unrelated Pull requests write for merges',()=>{
  expect(shouldFail(report('api.rest.pulls.merge({});',{repository:{pull_requests:'write',contents:'read'}}),'high')).toBe(true);
  expect(report('api.rest.pulls.merge({});',{repository:{contents:'write'}}).findings[0]?.category).toBe('observed');
  expect(report('api.rest.repos.delete({});',{repository:{administration:'read'}}).findings[0]?.category).toBe('insufficient');
 });

 it('analyzes mandatory file-write rights without inventing workflow-path requirements',()=>{
  const code='api.rest.repos.createOrUpdateFileContents({path:dynamic});';
  expect(report(code,{repository:{contents:'read'}}).findings.find(f=>f.category==='insufficient')).toMatchObject({permission:{domain:'repository',name:'contents'},requiredLevel:'write',declaredLevel:'read'});
  const partial=report(code,{repository:{contents:'write'}});
  expect(partial.findings.some(f=>f.category==='unknown')).toBe(true);
  expect(partial.findings.some(f=>f.category==='insufficient')).toBe(false);
  expect(partial.findings.some(f=>f.category==='possibly_excessive')).toBe(false);
  expect(report(code,{repository:{contents:'write',workflows:'write'}}).findings[0]?.category).toBe('observed');
  expect(report('api.rest.repos.deleteFile({});',{repository:{contents:'read'}}).findings[0]?.category).toBe('insufficient');
  expect(()=>cfg({repository:{workflows:'read'}})).toThrow();
 });
 it('accepts OR alternatives without requiring all grants',()=>{
  const read=report('api.rest.pulls.get({});',{repository:{contents:'read'}});
  expect(read.findings[0]?.category).toBe('observed');
  const update=report('api.rest.issues.update({});',{repository:{pull_requests:'write'}});
  expect(update.findings[0]?.category).toBe('observed');
  expect(report('api.rest.issues.update({});').findings[0]?.permissionAlternatives).toHaveLength(2);
 });
 it('distinguishes domains and analyzes organization membership reads/writes',()=>{
  expect(report('api.rest.orgs.getMembershipForUser({});',{organization:{members:'read'}}).findings[0]?.category).toBe('observed');
  expect(report('api.rest.orgs.setMembershipForUser({});',{organization:{members:'read'}}).findings[0]).toMatchObject({category:'insufficient',requiredLevel:'write'});
  expect(report('api.rest.orgs.removeMembershipForUser({});',{organization:{members:'write'}}).findings[0]?.category).toBe('observed');
  expect(report('api.rest.orgs.listMembers({});').findings[0]?.category).toBe('unknown');
 });
 it('accepts user token account permissions and rejects incompatible installation tokens',()=>{
  expect(report('api.rest.users.listEmailsForAuthenticatedUser();',{account:{emails:'read'}},{tokenType:'user'}).findings[0]?.category).toBe('observed');
  expect(report('api.rest.users.addEmailForAuthenticatedUser({});',{account:{emails:'read'}},{tokenType:'user'}).findings[0]).toMatchObject({category:'insufficient',requiredLevel:'write'});
  const r=report('api.rest.users.listEmailsForAuthenticatedUser();',{account:{emails:'write'}});
  expect(r.findings.find(f=>f.category==='insufficient')?.message).toContain('adding permissions');
  expect(shouldFail(r,'high')).toBe(true);
 });
 it('supports no-permission public reads with either token kind',()=>{
  for(const tokenType of ['user','installation']){
   expect(report('api.rest.users.getByUsername({});api.rest.gists.get({});',{}, {tokenType}).findings.every(f=>f.category==='not_applicable')).toBe(true);
  }
 });
 it('preserves incomplete-scan notices and stable IDs across operation order',()=>{
  const s=scan(pre+'api.rest.issues.create({});api.rest.pulls.merge({});');
  const a=evaluate(s,cfg()),b=evaluate({...s,operations:[...s.operations].reverse()},cfg());
  expect(a.findings.map(f=>f.id)).toEqual(b.findings.map(f=>f.id));
  const incomplete=evaluate({...s,complete:false,notices:[{code:'limit',message:'File limit reached.'}]},cfg());
  expect(incomplete.analysis.complete).toBe(false);expect(incomplete.findings.some(f=>f.category==='unknown')).toBe(true);
 });
 it('does not interpret partial AND requirements as sufficient or safe to narrow',()=>{
  const rule=appCatalog.rules.find(r=>r.id==='gha.issues.create')!;
  const saved=rule.alternatives;
  try{
   rule.alternatives=[[{domain:'repository',name:'issues',level:'read'},{domain:'repository',name:'contents',level:'write'}]];
   const r=report('api.rest.issues.create({});',{repository:{contents:'write'}});
   expect(r.findings.some(f=>f.category==='insufficient')).toBe(true);
   expect(r.findings.some(f=>f.suggestedLevel==='read')).toBe(false);
  }finally{rule.alternatives=saved;}
 });
});
describe('App data contracts and reporting',()=>{
 it('has unique sourced rules and recognized permission requirements',()=>{
  expect(new Set(appCatalog.rules.map(r=>r.id)).size).toBe(appCatalog.rules.length);
  expect(new Set(appCatalog.rules.map(r=>r.method+' '+r.endpoint)).size).toBe(appCatalog.rules.length);
  for(const rule of appCatalog.rules){
   expect(rule.docs.every(d=>new URL(d).hostname==='docs.github.com')).toBe(true);
   expect(rule.verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
   expect(rule.tokenTypes.length).toBeGreaterThan(0);
   for(const p of rule.alternatives.flat())expect(appCatalog.permissions[p.domain][p.name]).toContain(p.level);
  }
 });
 it('validates App reports against their own schema and omits OAuth fields',()=>{
  const validate=new Ajv2020({strict:true}).compile(JSON.parse(readFileSync(new URL('../../schemas/github-app-report.schema.json',import.meta.url),'utf8')));
  for(const r of [
   report('api.rest.issues.create({});',{repository:{contents:'write',issues:'read'}}),
   report('api.rest.issues.get({});',{repository:{issues:'write'}}),
   report('api.graphql("query{}");'),report('api.rest.repos.get({});'),
   report('api.rest.users.listEmailsForAuthenticatedUser();',{}, {tokenType:'user'})
  ]){
   expect(validate(r),JSON.stringify(validate.errors)).toBe(true);
   expect(r).not.toHaveProperty('declaredScopes');expect(r).not.toHaveProperty('normalizedScopes');
  }
  expect(validate({...report(''),provider:'github-oauth'})).toBe(false);
 });
 it('exports model, permission names, levels and evidence in all reporters without secrets',()=>{
  const r=report("api.request('POST /repos/{owner}/{repo}/issues',{headers:{Authorization:'SENTINEL'}});",{repository:{issues:'read'}});
  const text=render(r,'text'), md=render(r,'markdown'),json=render(r,'json');
  expect(text).toContain('GitHub Apps (installation)');expect(text).toContain('repository.issues=read');
  expect(text).toContain('"level":"write"');expect(md).toContain('Provider: github-app');expect(md).toContain('repository.issues=write');
  for(const output of [text,md,json])expect(output).not.toContain('SENTINEL');
  expect(JSON.parse(json)).toEqual(r);
 });
});
