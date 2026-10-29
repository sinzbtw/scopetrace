import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { catalog, covers } from '../../src/providers/github/index.js';
import { configSchema } from '../../src/config/index.js';
import { evaluate } from '../../src/engine/index.js';
import { parseSource } from '../../src/scanner/ast.js';
import * as publicApi from '../../src/index.js';
describe('versioned data contracts',()=>{
 it('exposes a usable public library entrypoint',()=>{expect(publicApi.scanProject).toBeTypeOf('function');});
 it('keeps unique documented catalog identities and recognized requirements',()=>{
  expect(new Set(catalog.rules.map(r=>r.id)).size).toBe(catalog.rules.length);
  expect(new Set(catalog.rules.map(r=>r.method+' '+r.endpoint)).size).toBe(catalog.rules.length);
  for(const rule of catalog.rules){
   expect(rule.verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
   expect(rule.docs.every(d=>new URL(d).hostname==='docs.github.com')).toBe(true);
   expect(rule.alternatives.length).toBeGreaterThan(0);
   expect(rule.alternatives.flat().every(s=>catalog.scopes.includes(s))).toBe(true);
   expect(rule.octokit.length).toBeGreaterThan(0);
  }
  for(const [parent,children] of Object.entries(catalog.implies)){
   expect(catalog.scopes).toContain(parent);
   for(const child of children){expect(catalog.scopes).toContain(child);expect(covers(child,parent)).toBe(false);}
  }
 });
 it('validates real reports against the published JSON schema',()=>{
  const schema=JSON.parse(readFileSync(new URL('../../schemas/report.schema.json',import.meta.url),'utf8'));
  const validate=new Ajv2020({strict:true}).compile(schema);
  const pre="import {Octokit} from 'octokit'; const api=new Octokit();";
  const parsed=parseSource(pre+"api.rest.gists.create({});api.graphql('query{}');fetch('https://api.github.com/user/emails');",'src/a.ts');
  const scan={...parsed,filesScanned:1,complete:false,notices:[{code:'limit',message:'Limit reached.'}]};
  const report=evaluate(scan,configSchema.parse({provider:'github-oauth',declaredScopes:['user:email','workflow','invalid_scope']}));
  expect(validate(report),JSON.stringify(validate.errors)).toBe(true);
  expect(validate({...report,schemaVersion:'bad'})).toBe(false);
 });
 it('supports OR alternatives and AND requirements independently of AST recognition',()=>{
  const original=catalog.rules.find(r=>r.id==='gh.email.list')!;
  const saved=original.alternatives;
  try {
   original.alternatives=[['user:email','gist'],['user']];
   const parsed=parseSource("fetch('https://api.github.com/user/emails');",'src/a.ts');
   const scan={...parsed,filesScanned:1,complete:true};
   const analyze=(scopes:string[])=>evaluate(scan,configSchema.parse({provider:'github-oauth',declaredScopes:scopes}));
   expect(analyze(['user:email']).findings.some(f=>f.category==='insufficient')).toBe(true);
   expect(analyze(['user:email','gist']).findings.some(f=>f.category==='observed')).toBe(true);
   expect(analyze(['user']).findings.some(f=>f.category==='observed')).toBe(true);
  }finally{original.alternatives=saved;}
 });
});
