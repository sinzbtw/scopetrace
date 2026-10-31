import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { googleConfigSchema, configSchema } from '../../src/config/index.js';
import { evaluate, shouldFail } from '../../src/engine/index.js';
import { googleCondition } from '../../src/engine/google.js';
import { googleCatalog } from '../../src/providers/google/index.js';
import { parseSource } from '../../src/scanner/ast.js';
import { render } from '../../src/reporters/index.js';
import type { GoogleOperationFacts, Operation } from '../../src/types.js';
const p='https://www.googleapis.com/auth/',full='https://mail.google.com/';
const cfg=(scopes:string[]=[],googleContext:Record<string,string>={})=>googleConfigSchema.parse({provider:'google-oauth',declaredScopes:scopes,googleContext});
const scan=(code:string)=>({...parseSource(code,'src/app.ts','google-oauth'),filesScanned:1,complete:true});
const call=(service:string,method:string,params='{}')=>"import {google} from 'googleapis';const api=google."+service+"('"+(service==='gmail'?'v1':'v3')+"');api."+method+"("+params+");";
const report=(code:string,scopes:string[]=[],context:Record<string,string>={})=>evaluate(scan(code),cfg(scopes,context));
const operation=(endpoint:string,facts:GoogleOperationFacts={}):Operation=>({provider:'google-oauth',method:'GET',endpoint,source:'google-sdk',location:{file:'a.ts',line:1,column:1},confidence:'high',google:facts});
describe('strict independent Google configuration',()=>{
 it('requires URI scopes, rejects executable/mixed models and invalid contexts',()=>{
  for(const input of [
   {provider:'google-oauth',declaredScopes:['repo']},
   {provider:'google-oauth',declaredScopes:[],declaredPermissions:{}},
   {provider:'google-oauth',declaredScopes:[],tokenType:'user'},
   {provider:'google-oauth',declaredScopes:[],repositoryVisibility:'public'},
   {provider:'google-oauth',declaredScopes:[],googleContext:{driveAccess:'all'}},
   {provider:'google-oauth',declaredScopes:[],googleContext:{calendarResources:'private'}},
   {provider:'google-oauth',declaredScopes:[],extra:true}
  ])expect(configSchema.safeParse(input).success).toBe(false);
  expect(cfg().googleContext).toEqual({driveAccess:'unknown',calendarResources:'unknown',calendarData:'unknown'});
 });
 it('does not infer scope hierarchy or canonicalize arbitrary URI spelling',()=>{
  const r=report('',[p+'drive.file',p+'drive.readonly',p+'drive.file']);
  expect(r.normalizedScopes).toEqual([p+'drive.file',p+'drive.readonly']);
  expect(r.declaredScopes).toHaveLength(2);
 });
});
describe('Google authorization conditions',()=>{
 it('applies Gmail metadata constraints without retaining queries',()=>{
  expect(googleCondition('gmail-metadata',operation('/gmail/v1/users/{userId}/messages',{gmailQuery:'absent'}),cfg())).toBe(true);
  expect(googleCondition('gmail-metadata',operation('/gmail/v1/users/{userId}/messages',{gmailQuery:'present'}),cfg())).toBe(false);
  expect(googleCondition('gmail-metadata',operation('/gmail/v1/users/{userId}/messages'),cfg())).toBe('unknown');
  for(const format of ['metadata','minimal'] as const)expect(googleCondition('gmail-metadata',operation('/get',{gmailFormat:format}),cfg())).toBe(true);
  for(const format of ['full','raw'] as const)expect(googleCondition('gmail-metadata',operation('/get',{gmailFormat:format}),cfg())).toBe(false);
  expect(googleCondition('gmail-metadata',operation('/get'),cfg())).toBe('unknown');
 });
 it('distinguishes metadata-only Drive access from content',()=>{
  for(const [condition,key,yes,no] of [['drive-metadata','driveResponse','metadata','media'],['drive-metadata-write','driveWrite','metadata','content']] as const){
   expect(googleCondition(condition,operation('/files',{[key]:yes}),cfg())).toBe(true);
   expect(googleCondition(condition,operation('/files',{[key]:no}),cfg())).toBe(false);
   expect(googleCondition(condition,operation('/files'),cfg())).toBe('unknown');
  }
 });
 it('requires explicit assertions for conditional resource/data scopes',()=>{
  const op=operation('/resource');
  for(const [condition,context] of [
   ['drive-file',{driveAccess:'app-authorized'}],['drive-appdata',{driveAccess:'app-data'}],
   ['calendar-owned',{calendarResources:'owned'}],['calendar-app-created',{calendarResources:'app-created'}],
   ['calendar-public',{calendarResources:'public'}],['calendar-availability',{calendarData:'availability'}]
  ] as const){
   expect(googleCondition(condition,op,cfg())).toBe('unknown');
   expect(googleCondition(condition,op,cfg([],context))).toBe(true);
  }
  expect(googleCondition('always',op,cfg())).toBe(true);
  expect(googleCondition('unmodeled-context',op,cfg())).toBe('unknown');
 });
});
describe('Gmail scope evaluation',()=>{
 it('requires send-capable rights and gates real deficiencies',()=>{
  const code=call('gmail','users.messages.send');
  const missing=report(code,[p+'gmail.readonly']);
  expect(missing.findings.find(f=>f.category==='insufficient')).toMatchObject({severity:'high',confidence:'high',ruleId:'google.gmail.users.messages.send'});
  expect(shouldFail(missing,'high')).toBe(true);
  expect(report(code,[p+'gmail.send']).findings.some(f=>f.category==='observed')).toBe(true);
 });
 it('keeps gmail.modify distinct from permanent-delete-only full access',()=>{
  const r=report(call('gmail','users.messages.delete'),[p+'gmail.modify']);
  expect(r.findings.some(f=>f.category==='insufficient')).toBe(true);
  const covered=report(call('gmail','users.messages.delete'),[full]);
  expect(covered.findings.some(f=>f.category==='observed')).toBe(true);
  expect(covered.findings.some(f=>f.suggestedScopes)).toBe(false);
 });
 it('rejects gmail.metadata for body reads and search but accepts metadata formats',()=>{
  const get=(params:string)=>report(call('gmail','users.messages.get',params),[p+'gmail.metadata']);
  expect(get("{format:'full'}").findings.some(f=>f.category==='insufficient')).toBe(true);
  expect(get('{}').findings.some(f=>f.category==='insufficient')).toBe(true);
  expect(get("{format:'metadata'}").findings.some(f=>f.category==='observed')).toBe(true);
  expect(get('{format:dynamic}').findings.some(f=>f.category==='unknown')).toBe(true);
  expect(report(call('gmail','users.messages.list',"{q:'SENTINEL'}"),[p+'gmail.metadata']).findings.some(f=>f.category==='insufficient')).toBe(true);
 });
 it('preserves uncertainty for optional dynamic query/media values',()=>{
  for(const q of ['dynamic','flag && search','optional ?? other']){
   const query=report(call('gmail','users.messages.list','{q:'+q+'}'),[p+'gmail.metadata']);
   expect(query.findings.some(f=>f.category==='unknown')).toBe(true);expect(query.findings.some(f=>f.category==='insufficient')).toBe(false);
  }
  const media=report(call('drive','files.update','{media:dynamic}'),[p+'drive.metadata']);
  expect(media.findings.some(f=>f.category==='unknown')).toBe(true);expect(media.findings.some(f=>f.category==='insufficient')).toBe(false);
 });
 it('does not infer add-on context from an SDK method name',()=>{
  const r=report(call('gmail','users.messages.send'),[p+'gmail.addons.current.action.compose']);
  expect(r.findings.some(f=>f.category==='unknown')).toBe(true);
  expect(shouldFail(r,'high')).toBe(false);
 });
 it('suggests a narrower sending scope only as a low-confidence alternative',()=>{
  const r=report(call('gmail','users.messages.send'),[full]);
  const f=r.findings.find(f=>f.category==='possibly_excessive');
  expect(f).toMatchObject({confidence:'low',severity:'low',sensitivity:'restricted'});
  expect(f?.suggestedScopes).toContain(p+'gmail.send');
  expect(shouldFail(r,'low')).toBe(false);
 });
});
describe('Drive and Calendar scope evaluation',()=>{
 it('never treats drive.file as unrestricted access without resource evidence',()=>{
  const code=call('drive','files.get');
  const unknown=report(code,[p+'drive.file']);
  expect(unknown.findings.some(f=>f.category==='unknown')).toBe(true);
  expect(unknown.findings.some(f=>f.category==='insufficient')).toBe(false);
  const covered=report(code,[p+'drive.file'],{driveAccess:'app-authorized'});
  expect(covered.findings.find(f=>f.category==='observed')?.confidence).toBe('medium');
  expect(report(call('drive','files.create'),[p+'drive.file']).findings.some(f=>f.category==='observed')).toBe(true);
 });
 it('does not use metadata-only rights to download or upload file content',()=>{
  const download=report(call('drive','files.get',"{alt:'media'}"),[p+'drive.metadata.readonly']);
  expect(download.findings.some(f=>f.category==='insufficient')).toBe(true);
  const upload=report(call('drive','files.update',"{media:{body:content}}"),[p+'drive.metadata']);
  expect(upload.findings.some(f=>f.category==='insufficient')).toBe(true);
  expect(report(call('drive','files.update',"{requestBody:{name:'synthetic'}}"),[p+'drive.metadata']).findings.some(f=>f.category==='observed')).toBe(true);
  expect(report(call('drive','files.get',"{alt:unknown}"),[p+'drive.metadata']).findings.some(f=>f.category==='unknown')).toBe(true);
 });
 it('keeps app-data aliases, app-data resources and unmodeled Drive contexts uncertain',()=>{
  expect(report(call('drive','files.get'),[p+'drive.appdata']).findings.some(f=>f.category==='unknown')).toBe(true);
  expect(report(call('drive','files.get'),[p+'drive.appdata'],{driveAccess:'app-data'}).findings.some(f=>f.category==='observed')).toBe(true);
  expect(report(call('drive','files.get'),[p+'drive.appfolder']).findings.some(f=>f.category==='insufficient')).toBe(false);
  expect(report(call('drive','files.get'),[p+'drive.photos.readonly']).findings.some(f=>f.category==='unknown')).toBe(true);
 });
 it('does not treat broad Drive scopes as app-data-folder authorization',()=>{
  const code=call('drive','files.get');
  const broad=report(code,[p+'drive'],{driveAccess:'app-data'});
  expect(broad.findings.some(f=>f.category==='observed')).toBe(false);
  expect(broad.findings.find(f=>f.category==='insufficient')?.confidence).toBe('medium');
  expect(report(code,[p+'drive.appdata'],{driveAccess:'app-data'}).findings.some(f=>f.category==='observed')).toBe(true);
  expect(report(call('drive','files.create'),[p+'drive.file'],{driveAccess:'app-data'}).findings.some(f=>f.category==='observed')).toBe(false);
 });
 it('requires write-capable Calendar scopes for mutations',()=>{
  const r=report(call('calendar','events.insert'),[p+'calendar.events.readonly']);
  expect(r.findings.some(f=>f.category==='insufficient')).toBe(true);
  expect(report(call('calendar','events.insert'),[p+'calendar.events']).findings.some(f=>f.category==='observed')).toBe(true);
 });
 it('does not assume calendars are owned, public or created by the application',()=>{
  for(const [scope,context]of[
   ['calendar.events.owned',{calendarResources:'owned'}],['calendar.app.created',{calendarResources:'app-created'}],
   ['calendar.events.public.readonly',{calendarResources:'public'}],['calendar.events.freebusy',{calendarData:'availability'}]
  ]){
   const code=call('calendar','events.list');
   const r=report(code,[p+scope]);expect(r.findings.some(f=>f.category==='observed')).toBe(false);
   expect(report(code,[p+scope],context as Record<string,string>).findings.some(f=>f.category==='observed')).toBe(true);
  }
  expect(report(call('calendar','events.list'),[],{calendarResources:'public'}).findings.some(f=>f.category==='insufficient')).toBe(false);
 });
 it('suggests smaller scopes only when every relevant known operation is covered',()=>{
  const read=report(call('calendar','events.list'),[p+'calendar']);
  expect(read.findings.find(f=>f.suggestedScopes)?.suggestedScopes).toContain(p+'calendar.events.readonly');
  const media=report(call('drive','files.get',"{alt:'media'}"),[p+'drive']);
  expect(media.findings.find(f=>f.suggestedScopes)?.suggestedScopes).not.toContain(p+'drive.metadata.readonly');
  const both=call('gmail','users.messages.send')+"\napi.users.messages.delete({});";
  expect(report(both,[full]).findings.some(f=>f.suggestedScopes)).toBe(false);
 });
});
describe('Google classifications, unknown states and data contracts',()=>{
 it('reports sensitive/restricted/non-sensitive with source dates and leaves unverified categories unknown',()=>{
  const r=report('',[p+'gmail.send',p+'gmail.readonly',p+'drive.file',p+'calendar.events.readonly']);
  const entries=new Map(r.scopeAssessments.map(s=>[s.uri,s]));
  expect(entries.get(p+'gmail.send')?.sensitivity).toBe('sensitive');
  expect(entries.get(p+'gmail.readonly')?.sensitivity).toBe('restricted');
  expect(entries.get(p+'drive.file')?.sensitivity).toBe('non_sensitive');
  expect(entries.get(p+'calendar.events.readonly')?.sensitivity).toBe('unknown');
  expect(entries.get(p+'gmail.send')?.verified).toBe('2026-10-31');
  expect(shouldFail(r,'info')).toBe(false);
 });
 it('redacts unrecognized scope values and does not pretend sufficiency is known',()=>{
  const r=report(call('gmail','users.messages.send'),[p+'SENTINEL','openid']);
  expect(JSON.stringify(r)).not.toContain('SENTINEL');
  expect(r.declaredScopes).toEqual(['<unrecognized>']);
  expect(r.findings.some(f=>f.category==='unknown')).toBe(true);
  expect(r.findings.some(f=>f.category==='insufficient')).toBe(false);
 });
 it('preserves unsupported calls, traversal notices and provider isolation',()=>{
  const r=report("fetch(url);");
  expect(r.findings[0]?.category).toBe('unknown');
  const s=scan(call('gmail','users.messages.list'));
  expect(()=>evaluate({...s,operations:s.operations.map(op=>({...op,provider:'github-oauth' as const}))},cfg())).toThrow('does not match');
  const limited=evaluate({...s,complete:false,notices:[{code:'limit',message:'Limit reached.'}]},cfg());
  expect(limited.analysis.complete).toBe(false);expect(limited.findings.some(f=>f.message==='Limit reached.')).toBe(true);
 });
 it('has deterministic findings and no inferred global scope merging',()=>{
  const s=scan(call('gmail','users.messages.send')+"api.users.messages.list({});");
  const a=evaluate(s,cfg([full])),b=evaluate({...s,operations:[...s.operations].reverse()},cfg([full]));
  expect(a.findings.map(f=>f.id)).toEqual(b.findings.map(f=>f.id));
  expect(googleCatalog.narrower[p+'gmail.readonly']).not.toContain(p+'gmail.labels');
  expect(googleCatalog.narrower[p+'drive']).not.toContain(p+'drive.appdata');
  expect(googleCatalog.narrower[p+'calendar.events']).not.toContain(p+'calendar.app.created');
 });
 it('keeps unique documented rules, scopes and valid condition vocabulary',()=>{
  expect(new Set(googleCatalog.rules.map(r=>r.id)).size).toBe(22);
  expect(new Set(googleCatalog.scopes.map(s=>s.uri)).size).toBe(googleCatalog.scopes.length);
  for(const r of googleCatalog.rules){
   expect(r.docs.every(url=>new URL(url).hostname==='developers.google.com')).toBe(true);
   for(const a of r.alternatives)expect(['always','drive-general','gmail-metadata','drive-metadata','drive-metadata-write','drive-file','drive-appdata','calendar-owned','calendar-app-created','calendar-public','calendar-availability','unmodeled-context']).toContain(a.condition);
   for(const s of r.alternatives.flatMap(a=>a.scopes))expect(googleCatalog.scopes.some(v=>v.uri===s)).toBe(true);
  }
  for(const list of Object.values(googleCatalog.narrower))for(const s of list)expect(googleCatalog.scopes.some(v=>v.uri===s)).toBe(true);
 });
 it('validates all categories against the independent v3 JSON schema',()=>{
  const validate=new Ajv2020({strict:true}).compile(JSON.parse(readFileSync(new URL('../../schemas/google-oauth-report.schema.json',import.meta.url),'utf8')));
  for(const r of [
   report(call('gmail','users.messages.send'),[full]),
   report(call('drive','files.get'),[p+'drive.file']),
   report(call('calendar','events.insert'),[p+'calendar.events.readonly']),
   report(call('gmail','users.messages.list'),[p+'SENTINEL'])
  ])expect(validate(r),JSON.stringify(validate.errors)).toBe(true);
  expect(validate({...report(''),provider:'github-oauth'})).toBe(false);
 });
 it('shows scope classifications and narrower alternatives in terminal, JSON and Markdown without secrets',()=>{
  const r=report(call('gmail','users.messages.send',"{requestBody:{raw:'SENTINEL'}}"),[full,p+'gmail.send']);
  for(const format of ['text','json','markdown'] as const){
   const output=render(r,format);expect(output).not.toContain('SENTINEL');expect(output).toContain('restricted');expect(output).toContain(p+'gmail.send');
  }
  expect(render(r,'text')).toContain('Google OAuth 2.0');
  expect(render(r,'markdown')).toContain('## Scope classifications');
  expect(JSON.parse(render(r,'json'))).toEqual(r);
 });
});
