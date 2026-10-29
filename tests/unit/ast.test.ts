import { describe, expect, it } from 'vitest';
import { parseSource } from '../../src/scanner/ast.js';
import { normalizeEndpoint, catalog } from '../../src/providers/github/index.js';
const pre = "import {Octokit as GH} from '@octokit/rest'; const api = new GH();\n";
const ops = (code: string, file = 'src/app.ts') => parseSource(code, file).operations;

describe('AST recognition and source evidence', () => {
 it.each(['js', 'jsx', 'ts', 'tsx'])('reads %s without executing it', ext => {
  const result = ops(pre + "api.rest.users.listEmailsForAuthenticatedUser();", 'src/app.' + ext);
  expect(result).toMatchObject([{ method: 'GET', endpoint: '/user/emails', source: 'octokit-rest', confidence: 'high', location: { file: 'src/app.' + ext, line: 2, column: 1 } }]);
 });
 it('supports ESM namespace imports, const aliases, bracket access and unboxing', () => {
  expect(ops("import * as sdk from 'octokit'; const api = new sdk.Octokit(); const alias = (api!); const call = alias['rest'].users.listEmailsForAuthenticatedUser; call();")[0]?.endpoint).toBe('/user/emails');
 });
 it('supports CommonJS namespace and destructured constructor aliases', () => {
  for (const init of ["const sdk = require('@octokit/core'); const GH = sdk.Octokit;", "const {Octokit: GH} = require('@octokit/rest');", "const {Octokit} = require('octokit'); const GH=Octokit;"]) {
   expect(ops(init + "const k = new GH(); k.request('DELETE /repos/{owner}/{repo}', {owner:'e',repo:'s'});")[0]).toMatchObject({ method: 'DELETE', endpoint: '/repos/{owner}/{repo}' });
  }
 });
 it('handles JSX, no-substitution templates, const string routes and concatenation', () => {
  expect(ops("const route = 'https://api.github.com/' + 'user/emails'; const x = <p>Hello</p>; fetch((route as string)!);", 'view.tsx')[0]?.method).toBe('GET');
  expect(ops('fetch(`https://api.github.com/user/emails`);')[0]?.endpoint).toBe('/user/emails');
 });
 it('supports old Octokit endpoint shape', () => {
  expect(ops(pre + 'api.users.follow({username:"x"});')[0]?.method).toBe('PUT');
 });
 it('normalizes concrete URLs without retaining parameters or identifiers', () => {
  expect(ops("fetch('https://api.github.com/repos/secret-owner/secret-repo/contents/a/b.ts?token=SENTINEL');")[0]?.endpoint).toBe('/repos/{owner}/{repo}/contents/{path}');
  expect(JSON.stringify(ops("fetch('https://api.github.com/unrecognized/SENTINEL?token=SENTINEL')"))).not.toContain('SENTINEL');
 });
 it('recognizes a method and option literals', () => {
  expect(ops("const m = 'delete'; fetch('https://api.github.com/repos/o/r', {headers:{Authorization:'SENTINEL'}, method: m});")[0]).toMatchObject({ method: 'DELETE' });
 });
 it('covers every catalog Octokit mapping', () => {
  for (const rule of catalog.rules) for (const method of rule.octokit) {
   expect(ops(pre + 'api.rest.' + method + '({});')[0]).toMatchObject({ method: rule.method, endpoint: rule.endpoint });
  }
 });
 it('recognizes ordinary REST request patterns', () => {
  expect(ops(pre + "const route = 'GET /user/emails'; api.request(route);")[0]?.endpoint).toBe('/user/emails');
 });
 it('does not interpret comments, string contents, fake clients or shadowed bindings as operations', () => {
  expect(ops("// fetch('https://api.github.com/user/emails')\nconst x = \"api.rest.users.follow()\"; const api = {rest:{}};")).toEqual([]);
  expect(ops("function f(fetch: Function) { fetch('https://api.github.com/user/emails'); }")).toEqual([]);
  expect(ops(pre + "function f(api: unknown) { api.rest.users.follow(); }")).toEqual([]);
  expect(ops("import {Octokit} from 'unrelated'; const api=new Octokit(); api.rest.users.follow();")).toEqual([]);
  expect(ops("import type {Octokit} from 'octokit'; const api=new Octokit(); api.rest.users.follow();")).toEqual([]);
  expect(ops("import {type Octokit} from 'octokit'; const api=new Octokit(); api.rest.users.follow();")).toEqual([]);
  expect(ops("function f(require: Function) { const sdk=require('octokit'); const api=new sdk.Octokit(); api.rest.users.follow(); }")).toEqual([]);
 });
 it('does not trust reassigned clients, member assignments or mutable literal routes', () => {
  expect(ops(pre + "api.request = other; api.rest.users.follow();")).toEqual([]);
  expect(ops("import {Octokit} from 'octokit'; let api=new Octokit(); api.rest.users.follow();")).toEqual([]);
  expect(ops(pre + "const route='GET /user/emails'; route += other; api.request(route);")[0]?.reason).toBeDefined();
  expect(ops("let url='https://api.github.com/user/emails'; fetch(url);")[0]?.method).toBe('UNKNOWN');
 });
 it('limits cyclic/deep aliases and ignores non-Octokit module destructuring', () => {
  expect(ops('const a=b; const b=a; a();')).toEqual([]);
  expect(ops("const {Other} = require('octokit'); const api=new Other(); api.rest.users.follow();")).toEqual([]);
  expect(ops("const {Octokit}=require('different'); const api=new Octokit(); api.rest.users.follow();")).toEqual([]);
  const aliases = Array.from({length:15}, (_,i) => 'const a'+i+'=a'+(i+1)+';').join('');
  expect(ops(aliases+'a0();')).toEqual([]);
 });
 it.each([
  "api.request(route);", "api.request({method:'GET', url:'/user/emails'});",
  "api.request('GET /user/emails',{...options});", "api.request('GET /user/emails', {method:'POST'});",
  "api.request('GET /user/emails',{url:'/other'});", "api.request('GET /user/emails', options);",
  "api.request('https://api.github.com/user/emails');", "api.request('GET /unsupported/path');",
  "api.request('GET /user/emails',{get owner(){return 'x'}});",
  "api.request('GET /user/emails',{[key]:'x'});", "api.request('GET /user/emails',{baseUrl:'https://example.org'});",
  "api.graphql('query {viewer {login}}');", "api.rest.unknown.method();",
  "api.rest.users.follow({url:'/other'});", "api.rest.users.follow({method:'GET'});"
 ])('reports unknown for unsupported Octokit form: %s', code => {
  const result = ops(pre + code);
  expect(result).toHaveLength(1);
  expect(result[0]?.reason).toBeDefined();
 });
 it.each(["{baseUrl:'https://example.org'}", "{request:{fetch:other}}", "options", "{...options}"])('marks custom constructor options unknown: %s', options => {
  expect(ops("import {Octokit} from 'octokit'; const api=new Octokit("+options+"); api.rest.users.follow();")[0]?.endpoint).toBe('/<custom-client>');
 });
 it('ignores unknown import syntax and supports non-null/as/satisfies expressions', () => {
  expect(ops("import GH from 'octokit'; const api=new GH(); api.request('/x');")).toEqual([]);
  expect(ops(pre + "(api as any).rest.users.follow({}); (api satisfies unknown).rest.users.unfollow({});")).toHaveLength(2);
 });
 it.each([
  "fetch(url);", "fetch(`https://api.github.com/repos/${owner}/r`);",
  "fetch('https://api.github.com/user/emails', options);",
  "fetch('https://api.github.com/user/emails', {...options});",
  "fetch('https://api.github.com/user/emails', {method:method});",
  "fetch('https://api.github.com/user/emails', {method:'BREW'});",
  "fetch('https://api.github.com/user/emails', {[key]:'GET'});",
  "fetch('https://api.github.com/user/emails', {get method(){return 'GET'}});",
  "fetch('https://api.github.com/user/emails', {method});",
  "fetch('https://api.github.com/graphql');", "fetch('https://api.github.com/unknown/SENTINEL');"
 ])('retains uncertainty for fetch: %s', code => {
  expect(ops(code)[0]?.reason).toBeDefined();
 });
 it.each(['https://evil.example/user/emails', 'https://api.github.com.evil.example/user/emails', 'http://api.github.com/user/emails', 'https://api.github.com:8080/user/emails', 'https://SENTINEL@api.github.com/user/emails', 'not a url'])('ignores nonstandard URLs: %s', url => {
  expect(ops("fetch('"+url+"');")).toEqual([]);
 });
 it('supports property identifiers without treating type-only syntax as executable code', () => {
  expect(ops(pre + "type T = typeof api; api.rest.users.listEmailsForAuthenticatedUser({headers:{accept:'a'}});")).toHaveLength(1);
 });
 it('does not retain malformed source diagnostics', () => {
  const result = parseSource("const SECRET = 'SENTINEL'; function () {", 'src/a.ts');
  expect(result.notices[0]?.code).toBe('syntax-error');
  expect(JSON.stringify(result)).not.toContain('SENTINEL');
 });
 it('reports incremented literal bindings as dynamic', () => {
  expect(ops("const url='https://api.github.com/user/emails'; url++; fetch(url);")[0]?.method).toBe('UNKNOWN');
  expect(ops("const url='https://api.github.com/user/emails'; ++url; fetch(url);")[0]?.method).toBe('UNKNOWN');
 });
 it('handles duplicate method properties using last value', () => {
  expect(ops("fetch('https://api.github.com/user/emails',{method:'POST',method:'GET'});")[0]?.method).toBe('GET');
 });
});

describe('URL normalization', () => {
 it('accepts templates and discards query/fragment/trailing slash', () => {
  expect(normalizeEndpoint('/repos/{owner}/{repo}?token=SENTINEL')).toBe('/repos/{owner}/{repo}');
  expect(normalizeEndpoint('/user/emails/')).toBe('/user/emails');
  expect(normalizeEndpoint('/gists/123#x')).toBe('/gists/{gist_id}');
 });
 it.each(['//evil.test/x', 'not-relative', 'https://api.github.com/user/emails'])('rejects nonpaths: %s', value => {
  expect(normalizeEndpoint(value)).toBeUndefined();
 });
 it('does not confuse incomplete routes or graphql with modeled endpoints', () => {
  expect(normalizeEndpoint('/repos/o')).toBe('/<unsupported>');
  expect(normalizeEndpoint('/repos/o/r/contents')).toBe('/<unsupported>');
  expect(normalizeEndpoint('/graphql')).toBe('/graphql');
  expect(normalizeEndpoint('https://api.github.com/graphql', true)).toBe('/graphql');
 });
});
