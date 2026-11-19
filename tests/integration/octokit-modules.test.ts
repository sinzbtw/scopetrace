import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { oauthConfigSchema } from '../../src/config/index.js';
import { evaluate } from '../../src/engine/index.js';
import { parseSource } from '../../src/scanner/ast.js';
import { scanProject } from '../../src/scanner/index.js';

const roots: string[] = [];
const octokit = "import { Octokit } from '@octokit/rest';\n";
const client = octokit + 'export const github = new Octokit();';
const call = 'github.rest.users.listEmailsForAuthenticatedUser();';
const importClient = (specifier: string) => `import { github } from '${specifier}';\n`;
const config = (options: Record<string, unknown> = {}) =>
 oauthConfigSchema.parse({ provider: 'github-oauth', declaredScopes: [], ...options });

async function project(files: Record<string, string>): Promise<string> {
 const parent = path.resolve('work/tests');
 await mkdir(parent, { recursive: true });
 const root = await mkdtemp(path.join(parent, 'octokit-modules-'));
 roots.push(root);
 for (const [relative, source] of Object.entries(files)) {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, source);
 }
 return root;
}

afterEach(async () => {
 for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('shared Octokit clients', () => {
 it('attributes renamed imports and local method aliases to the caller in OAuth reports', async () => {
  const source = [
   "import { github as api } from '../github.js';",
   'const list = api.rest.users.listEmailsForAuthenticatedUser;',
   'list();',
   'function shadow(api) { api.rest.users.listEmailsForAuthenticatedUser(); }',
   "fetch('https://api.github.com/user/emails');"
  ].join('\n');
  const root = await project({ 'src/calls/email.ts': source, 'src/github.ts': client });
  const scan = await scanProject(root, config());
  expect(scan.filesScanned).toBe(2);
  expect(scan.operations).toMatchObject([
   { endpoint: '/user/emails', source: 'octokit-rest', location: { file: 'src/calls/email.ts', line: 3, column: 1 } },
   { endpoint: '/user/emails', source: 'fetch', location: { line: 5 } }
  ]);
  expect(evaluate(scan, config()).findings).toContainEqual(expect.objectContaining({ category: 'insufficient', ruleId: 'gh.email.list' }));
  expect(parseSource(source, 'src/calls/email.ts').operations.map(operation => operation.source)).toEqual(['fetch']);
 });

 it('supports exact JavaScript paths and preserves request overrides and custom transports as unknown', async () => {
  const root = await project({
   'client.js': client + "\nexport const enterprise = new Octokit({ '\\u0062aseUrl': 'https://sentinel.invalid' });",
   'use.js': [
    "import { github, enterprise } from './client.js';",
    "github.request('GET /user/emails');",
    "github.request('GET /user/emails', { '\\u0075rl': 'SENTINEL' });",
    'enterprise.rest.users.listEmailsForAuthenticatedUser();'
   ].join('\n')
  });
  const scan = await scanProject(root, config());
  expect(scan.operations.map(operation => [operation.endpoint, operation.confidence])).toEqual([
   ['/user/emails', 'high'], ['/<dynamic>', 'low'], ['/<custom-client>', 'low']
  ]);
  expect(JSON.stringify(scan)).not.toMatch(/sentinel/i);
 });

 it('downgrades calls after visible writes in exporters and other importers', async () => {
  const root = await project({
   'a.ts': importClient('./c.ts') + call,
   'b.ts': "import { other } from './c.ts';\nconst alias = other;\nalias.rest = replacement;",
   'c.ts': client + '\nexport const other = github;',
   'd.ts': importClient('./e.ts') + call,
   'e.ts': client + '\ndelete github.rest.users;',
   'x.ts': importClient('./y.ts') + '(github).rest = replacement;\n' + call,
   'y.ts': client
  });
  const scan = await scanProject(root, config());
  expect(scan.operations).toMatchObject([
   { method: 'UNKNOWN', confidence: 'low', reason: expect.stringContaining('visible write'), location: { file: 'a.ts' } },
   { method: 'UNKNOWN', confidence: 'low', reason: expect.stringContaining('visible write'), location: { file: 'd.ts' } },
   { method: 'UNKNOWN', confidence: 'low', reason: expect.stringContaining('visible write'), location: { file: 'x.ts' } }
  ]);
 });

 it.each([
  ['excluded', './client.ts', { 'client.ts': client }, { exclude: ['client.ts'] }],
  ['file limit', './client.ts', { 'client.ts': client }, { limits: { maxFiles: 1 } }],
  ['ambiguous with an excluded JS file', './client.js', { 'client.ts': client, 'client.js': '' }, { exclude: ['client.js'] }],
  ['JS fallback shadowed by JSX', './client.js', { 'client.ts': client, 'client.jsx': '' }, {}],
  ['re-exported', './client.ts', { 'client.ts': "export { github } from './factory.ts';", 'factory.ts': client }, {}],
  ['unrelated', './client.ts', { 'client.ts': 'export const github = makeClient();' }, {}],
  ['syntactically invalid', './client.ts', { 'client.ts': client + '\nfunction (' }, {}],
  ['extensionless', './client', { 'client.ts': client }, {}],
  ['bare alias', 'client.ts', { 'client.ts': client }, {}],
  ['outside root', '../client.ts', { 'client.ts': client }, {}]
 ] as const)('does not resolve an %s client', async (_case, specifier, files, options) => {
  const root = await project({ 'a.ts': importClient(specifier) + call, ...files });
  expect((await scanProject(root, config(options))).operations).toEqual([]);
 });

 it('skips linked directories and type-only imports', async () => {
  const external = await project({ 'client.ts': client });
  const root = await project({
   'client.ts': client,
   'use.ts': "import type { github } from './client.ts';\n" + call,
   'via-link.ts': importClient('./linked/client.ts') + call
  });
  await symlink(external, path.join(root, 'linked'), 'junction');
  const scan = await scanProject(root, config());
  expect(scan.operations).toEqual([]);
  expect(scan.notices).toContainEqual(expect.objectContaining({ code: 'symlink-skipped' }));
 });
});
