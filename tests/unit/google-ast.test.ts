import { describe, expect, it } from 'vitest';
import { parseSource } from '../../src/scanner/ast.js';
import { googleTarget, googleCatalog } from '../../src/providers/google/index.js';
const pre="import {google as g} from 'googleapis'; const api=g.gmail({version:'v1',auth});\n";
const parse=(code:string,file='src/app.ts')=>parseSource(code,file,'google-oauth');
const ops=(code:string)=>parse(code).operations;
describe('Google Node SDK AST recognition',()=>{
 it.each(['js','jsx','ts','tsx'])('recognizes supported %s files without loading googleapis',ext=>{
  const r=parse(pre+"api.users.messages.list({userId:'me'});",'src/app.'+ext);
  expect(r.operations[0]).toMatchObject({provider:'google-oauth',source:'google-sdk',method:'GET',endpoint:'/gmail/v1/users/{userId}/messages',location:{line:2,column:1},google:{gmailQuery:'absent'}});
 });
 it.each([
  "import * as sdk from 'googleapis'; const api=sdk.google.gmail('v1');",
  "import sdk from 'googleapis'; const api=sdk.google.gmail({version:'v1'});",
  "const {google:g}=require('googleapis');const api=g.gmail('v1');",
  "const sdk=require('googleapis'); const api=sdk.google.gmail('v1');",
  "import {gmail as make} from '@googleapis/gmail'; const api=make({version:'v1'});",
  "const {gmail:make}=require('@googleapis/gmail');const api=make('v1');",
  "import * as sdk from '@googleapis/gmail';const api=sdk.gmail('v1');"
 ])('supports a proven import/constructor form: %s',init=>{
  expect(ops(init+"api.users.messages.get({userId:'me',id:'SENTINEL',format:'metadata'});")[0]).toMatchObject({method:'GET',google:{gmailFormat:'metadata'}});
 });
 it('handles const aliases, string concatenation, brackets, shorthand and assertions',()=>{
  const code=pre+"const alias=(api as unknown)!;const list=alias['users'].messages.list;const q='SENTINEL';list({userId:'me',q});";
  expect(ops(code)[0]?.google?.gmailQuery).toBe('present');
  expect(ops("import {google} from 'googleapis';const v='v'+'1';const api=google.gmail({version:v});api.users.messages.list({});")[0]?.reason).toBeUndefined();
 });
 it('recognizes every selected Google method in all three services',()=>{
  for(const r of googleCatalog.rules){
   const v=r.service==='gmail'?'v1':'v3';
   const result=ops("import {google} from 'googleapis';const api=google."+r.service+"('"+v+"');api."+r.sdk+"({});");
   expect(result[0]).toMatchObject({method:r.method,endpoint:r.endpoint,source:'google-sdk'});
  }
 });
 it('does not mistake fake, type-only, shadowed or mutated bindings for proven clients',()=>{
  for(const code of [
   "import {google} from 'fake';const api=google.gmail('v1');api.users.messages.list({});",
   "import type {google} from 'googleapis';const api=google.gmail('v1');api.users.messages.list({});",
   "import {type google} from 'googleapis';const api=google.gmail('v1');api.users.messages.list({});",
   "function f(require:Function){const {google}=require('googleapis');const api=google.gmail('v1');api.users.messages.list({});}",
   pre+"function f(api:unknown){api.users.messages.list({});}",
   pre+"api.users=other;api.users.messages.list({});",
   "const google={gmail(){return other}};const api=google.gmail('v1');api.users.messages.list({});",
   "const a=b;const b=a;a();", "import {other} from 'googleapis';other();",
   "const {other}=require('googleapis');other();"
  ])expect(ops(code)).toEqual([]);
 });
 it.each([
  "api.users.messages.list(params);","api.users.messages.list({...params});",
  "api.users.messages.list({[key]:'SENTINEL'});","api.users.messages.list({get q(){return 'SENTINEL'}});",
  "api.users.messages.list({},options);","api.users.messages.list({},{url:'https://example.com'});",
  "api.users.messages.list({},{params:{q:'SENTINEL'}});","api.users.messages.list({}, {}, callback);",
  "api.users.unrecognized();","api.users.messages.list({key:'SENTINEL'});"
 ])('reports unsupported request context honestly: %s',code=>{
  expect(ops(pre+code)[0]?.reason).toBeDefined();
  expect(JSON.stringify(ops(pre+code))).not.toContain('SENTINEL');
 });
 it.each(["{version:'v2'}","{version}","options","{...options}","{version:'v1',rootUrl:'https://example.com'}","{version:'v1',auth:'SENTINEL'}","{}"])('marks custom factory context unknown: %s',options=>{
  expect(ops("import {google} from 'googleapis';const api=google.gmail("+options+");api.users.messages.list({});")[0]?.reason).toBeDefined();
 });
 it('does not assume global options, including aliases, preserve URLs or scope parameters',()=>{
  expect(ops(pre+"g.options({params:{q:'SENTINEL'}});api.users.messages.list({});")[0]?.endpoint).toBe('/gmail/<custom-client>');
  expect(ops(pre+"const options=g.options;options({auth});api.users.messages.list({});")[0]?.reason).toBeDefined();
 });
 it('recognizes string-like auth as uncertain by syntax without extracting its value',()=>{
  for(const auth of ["'SENTINEL'",'key',"'SENTINEL'+suffix"]){
   const code="import {google} from 'googleapis';const key='SENTINEL';const api=google.gmail({version:'v1',auth:"+auth+"});api.users.messages.list({});";
   const r=ops(code);expect(r[0]?.reason).toBeDefined();expect(JSON.stringify(r)).not.toContain('SENTINEL');
  }
  const r=ops("import {google} from 'googleapis';const auth=new OAuthClient();const api=google.gmail({version:'v1',auth});api.users.messages.list({});");
  expect(r[0]?.reason).toBeUndefined();
 });
 it('permits harmless response options without reading headers or bodies',()=>{
  const r=ops("import {google} from 'googleapis';const api=google.drive('v3');api.files.get({fileId:'SENTINEL',alt:'media'},{responseType:'stream',headers:{Authorization:'SENTINEL'}});");
  expect(r[0]?.google?.driveResponse).toBe('media');expect(r[0]?.reason).toBeUndefined();
  expect(JSON.stringify(r)).not.toContain('SENTINEL');
 });
 it('retains only categorical facts from Gmail and Drive parameters',()=>{
  expect(ops(pre+"api.users.messages.get({format:unknown});")[0]?.google?.gmailFormat).toBe('unknown');
  const init="import {google} from 'googleapis';const api=google.drive('v3');";
  expect(ops(init+"api.files.get({alt:mode});")[0]?.google?.driveResponse).toBe('unknown');
  expect(ops(init+"api.files.update({media:{body:secret}});")[0]?.google?.driveWrite).toBe('content');
  expect(ops(init+"api.files.update({requestBody:{name:secret}});")[0]?.google?.driveWrite).toBe('metadata');
 });
});
describe('Google HTTP targets and privacy',()=>{
 it('normalizes supported hosts and endpoints and removes queries, email addresses and resource IDs',()=>{
  const r=ops("const url='https://gmail.googleapis.com/gmail/v1/users/PRIVATE_EMAIL/messages/PRIVATE_ID?format=metadata&q=SENTINEL';fetch(url,{headers:{Authorization:'SENTINEL'}});");
  expect(r[0]).toMatchObject({method:'GET',endpoint:'/gmail/v1/users/{userId}/messages/{id}',google:{gmailFormat:'metadata',gmailQuery:'present'}});
  expect(JSON.stringify(r)).not.toMatch(/PRIVATE_|SENTINEL|Authorization/);
  expect(googleTarget('https://www.googleapis.com/calendar/v3/calendars/private/events')?.endpoint).toBe('/calendar/v3/calendars/{calendarId}/events');
 });
 it('prioritizes literal endpoints over resource placeholders',()=>{
  expect(ops("fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST'});")[0]?.endpoint).toBe('/gmail/v1/users/{userId}/messages/send');
 });
 it('extracts only format/availability facts and treats duplicate or unknown options conservatively',()=>{
  expect(ops("fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/id?format=full&format=metadata');")[0]?.google?.gmailFormat).toBe('unknown');
  expect(ops("fetch('https://www.googleapis.com/drive/v3/files/id?alt=media');")[0]?.google?.driveResponse).toBe('media');
  expect(ops("fetch('https://www.googleapis.com/drive/v3/files/id?alt=json');")[0]?.google?.driveResponse).toBe('metadata');
  expect(ops("fetch('https://www.googleapis.com/drive/v3/files/id?alt=SENTINEL');")[0]?.google?.driveResponse).toBe('unknown');
 });
 it.each(['https://evil.example/gmail/v1/users/me/messages','https://gmail.googleapis.com.evil.example/gmail/v1/users/me/messages','http://gmail.googleapis.com/gmail/v1/users/me/messages','https://secret@gmail.googleapis.com/gmail/v1/users/me/messages','https://www.googleapis.com:8443/drive/v3/files','not a URL'])('rejects non-Google and nonstandard target %s',url=>{
  expect(ops("fetch('"+url+"');")).toEqual([]);
 });
 it('keeps dynamic URLs/methods, API keys, wrong-service hosts and unsupported routes unknown',()=>{
  for(const code of [
   'fetch(url);',"fetch('https://www.googleapis.com/drive/v3/files',opts);",
   "fetch('https://www.googleapis.com/drive/v3/files',{method:dynamic});",
   "fetch('https://www.googleapis.com/drive/v3/files',{method:'BREW'});",
   "fetch('https://www.googleapis.com/drive/v3/files?key=SENTINEL');",
   "fetch('https://gmail.googleapis.com/drive/v3/files');",
   "fetch('https://www.googleapis.com/unmodeled/SENTINEL');",
   "fetch('https://www.googleapis.com/drive/v2/files/SENTINEL');"
  ]){const r=ops(code);expect(r[0]?.reason).toBeDefined();expect(JSON.stringify(r)).not.toContain('SENTINEL');}
 });
 it('preserves old providers: a Google SDK call is not an Octokit call',()=>{
  expect(parseSource(pre+'api.users.messages.list({});','src/app.ts').operations).toEqual([]);
  expect(parseSource(pre+'api.users.messages.list({});','src/app.ts','github-app').operations).toEqual([]);
 });
});
