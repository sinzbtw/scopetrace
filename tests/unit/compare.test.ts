import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { configSchema, googleConfigSchema, type Config } from '../../src/config/index.js';
import { comparePermissions, shouldFailComparison, googleScopeCovers, googleScopeRelations } from '../../src/compare/engine.js';
import { renderComparison } from '../../src/compare/reporters.js';
const cfg = (provider: 'github-oauth' | 'google-oauth', scopes: string[]): Config => configSchema.parse({ provider, declaredScopes: scopes });
const app = (permissions: object, tokenType = 'installation'): Config => configSchema.parse({ provider: 'github-app', tokenType, declaredPermissions: permissions });
const google = (name: string) => name.startsWith('https:') ? name : 'https://www.googleapis.com/auth/' + name;
const validate = new Ajv2020({ strict: true }).compile(JSON.parse(readFileSync('schemas/comparison-report.schema.json', 'utf8')));
describe('permission declaration changes', () => {
 it('identifies OAuth widening, narrowing, additions and removals independently', () => {
  const a = cfg('github-oauth', ['user:email', 'gist']), b = cfg('github-oauth', ['user', 'delete_repo']);
  const report = comparePermissions(a, b);
  expect(report.changes).toEqual(expect.arrayContaining([
   expect.objectContaining({ kind: 'expanded', before: [{ kind: 'scope', scope: 'user:email' }], after: [{ kind: 'scope', scope: 'user' }], escalation: true, confidence: 'high', severity: 'high' }),
   expect.objectContaining({ kind: 'added', after: [{ kind: 'scope', scope: 'delete_repo' }], escalation: true }),
   expect.objectContaining({ kind: 'removed', before: [{ kind: 'scope', scope: 'gist' }], escalation: false })
  ]));
  expect(report.summary).toMatchObject({ added: 1, expanded: 1, removed: 1, escalations: 2 });
  expect(comparePermissions(b, a).summary).toMatchObject({ reduced: 1, added: 1, removed: 1 });
 });
 it('does not mistake redundant scopes or ordering for new access', () => {
  const a = cfg('github-oauth', ['user']), b = cfg('github-oauth', ['user:email', 'user', 'user:email']);
  const report = comparePermissions(a, b);
  expect(report.summary).toMatchObject({ equivalent: 1, escalations: 0 });
  expect(report.declarations.added).toEqual([{ kind: 'scope', scope: 'user:email' }]);
  expect(comparePermissions(b, cfg('github-oauth', ['user', 'user:email'])).changes).toEqual([]);
  expect(shouldFailComparison(report, 'info')).toBe(false);
 });
 it('retains both an incomparable addition and removal instead of guessing a net reduction', () => {
  const r = comparePermissions(cfg('github-oauth', ['repo']), cfg('github-oauth', ['delete_repo']));
  expect(r.summary).toMatchObject({ added: 1, removed: 1, expanded: 0 });
  expect(shouldFailComparison(r, 'medium')).toBe(true);
 });
 it('uses levels only within one App permission name and domain', () => {
  const r = comparePermissions(app({ repository: { contents: 'read', issues: 'write' }, organization: { members: 'write' } }), app({ repository: { contents: 'write', issues: 'read' }, account: { emails: 'read' } }));
  expect(r.summary).toMatchObject({ expanded: 1, reduced: 1, removed: 1, added: 1, escalations: 2 });
  expect(r.changes.find(c => c.kind === 'expanded')).toMatchObject({ before: [{ kind: 'permission', domain: 'repository', name: 'contents', level: 'read' }], after: [{ kind: 'permission', domain: 'repository', name: 'contents', level: 'write' }] });
 });
 it('does not call metadata read a new App privilege and retains token/context evidence', () => {
  const r = comparePermissions(app({}), app({ repository: { metadata: 'read', issues: 'write' } }));
  expect(r.summary).toMatchObject({ added: 1, unknown: 1, escalations: 1 });
  expect(r.changes.find(c => c.kind === 'added')?.severity).toBe('high');
  expect(r.base.tokenType).toBe('installation');expect(r.head.context).toEqual({ repositoryVisibility: 'unknown' });
  const onlyMetadata = comparePermissions(app({}), app({ repository: { metadata: 'read' } }));
  expect(onlyMetadata.summary).toMatchObject({ unknown: 1, escalations: 0, equivalent: 0 });
 });
 it('preserves unknown for provider/token-kind changes without translating models', () => {
  const a = app({ repository: { contents: 'read' } }), b = app({ repository: { contents: 'write' } }, 'user');
  for (const r of [comparePermissions(a, b), comparePermissions(a, cfg('github-oauth', ['repo']))]) {
   expect(r.summary.escalations).toBe(0);expect(r.analysis.complete).toBe(false);
   expect(r.changes.every(c => c.kind === 'unknown')).toBe(true);
   expect(shouldFailComparison(r, 'info')).toBe(false);expect(shouldFailComparison(r, undefined, true)).toBe(true);
  }
 });
 it.each([['gmail.readonly', 'gmail.modify'], ['drive.readonly', 'drive'], ['drive.file', 'drive'], ['calendar.app.created', 'calendar'], ['calendar.events.readonly', 'calendar.events'], ['calendar.calendarlist.readonly', 'calendar.calendarlist']])('orders documented Google grants %s -> %s', (narrow, broad) => {
  const r = comparePermissions(cfg('google-oauth', [google(narrow)]), cfg('google-oauth', [google(broad)]));
  expect(r.summary).toMatchObject({ expanded: 1, escalations: 1 });
  expect(comparePermissions(cfg('google-oauth', [google(broad)]), cfg('google-oauth', [google(narrow)])).summary).toMatchObject({ reduced: 1, escalations: 0 });
 });
 it('preserves Google sensitivity independently from confidence', () => {
  const r = comparePermissions(cfg('google-oauth', []), cfg('google-oauth', [google('gmail.modify'), google('calendar.events')]));
  expect(r.head.grants).toEqual(expect.arrayContaining([expect.objectContaining({ scope: google('gmail.modify'), sensitivity: 'restricted' }), expect.objectContaining({ scope: google('calendar.events'), sensitivity: 'unknown' })]));
  expect(r.changes.find(c => c.after.some(g => g.kind === 'scope' && g.scope === google('gmail.modify')))).toMatchObject({ severity: 'high', confidence: 'high', escalation: true });
 });
 it.each([['drive.appdata', 'drive'], ['calendar.app.created', 'calendar.events']])('does not conflate conditional/unrelated scopes %s -> %s', (a, b) => {
  expect(googleScopeCovers(google(b), google(a))).toBe(false);
  const r = comparePermissions(cfg('google-oauth', [google(a)]), cfg('google-oauth', [google(b)]));
  expect(r.summary).toMatchObject({ expanded: 0, added: 1, removed: 1 });
 });
 it('redacts unrecognized values and makes uncertain comparisons reviewable by a separate gate', () => {
  const r = comparePermissions(cfg('github-oauth', ['unrecognized_sentinel']), cfg('github-oauth', ['user', 'unrecognized_sentinel']));
  expect(JSON.stringify(r)).not.toContain('unrecognized_sentinel');expect(r.base.unrecognizedCount).toBe(1);
  expect(r.analysis.complete).toBe(false);expect(r.changes.every(c => !c.escalation && c.kind === 'unknown')).toBe(true);
  expect(shouldFailComparison(r, 'info')).toBe(false);expect(shouldFailComparison(r, 'info', true)).toBe(true);
  for (const uri of ['drive.appfolder', 'openid']) {
   const scope = uri === 'openid' ? uri : google(uri);
   expect(comparePermissions(cfg('google-oauth', []), cfg('google-oauth', [scope])).analysis.complete).toBe(false);
  }
  expect(comparePermissions(cfg('github-oauth', []), cfg('github-oauth', ['offline_access'])).analysis.complete).toBe(false);
 });
 it('detects creation/deletion of the declaration file without claiming prior grants or revocation', () => {
  const config = cfg('github-oauth', ['repo']);
  const added = comparePermissions(null, config), removed = comparePermissions(config, null);
  expect(added.summary).toMatchObject({ added: 1, unknown: 1, escalations: 1 });
  expect(added.changes.find(c => c.kind === 'added')?.confidence).toBe('medium');
  expect(removed.summary).toMatchObject({ removed: 1, unknown: 1, escalations: 0 });
  expect(removed.analysis.complete).toBe(false);expect(shouldFailComparison(removed, 'high', true)).toBe(true);
  expect(() => comparePermissions(null, null)).toThrow('Neither');
 });
 it('reports changed selectors/assertions without letting context changes suppress known increases', () => {
  const a = cfg('github-oauth', ['user:email']), b = configSchema.parse({ provider: 'github-oauth', declaredScopes: ['user'], include: ['different/*.ts'] });
  const r = comparePermissions(a, b);expect(r.summary).toMatchObject({ expanded: 1, unknown: 1, escalations: 1 });
  expect(r.analysis.complete).toBe(false);expect(shouldFailComparison(r, 'high')).toBe(true);
  const x = configSchema.parse({ provider: 'github-oauth', declaredScopes: [], include: ['src/**', 'lib/**'], exclude: ['a/**', 'b/**'] });
  const y = configSchema.parse({ provider: 'github-oauth', declaredScopes: [], include: ['lib/**', 'src/**'], exclude: ['b/**', 'a/**'] });
  expect(comparePermissions(x, y).changes).toEqual([]);
 });
 it('ignores object key order in API contexts and preserves classification dates', () => {
  const x = googleConfigSchema.parse({ provider: 'google-oauth', declaredScopes: [google('gmail.send')] });
  const y = { ...x, googleContext: { calendarData: x.googleContext.calendarData, calendarResources: x.googleContext.calendarResources, driveAccess: x.googleContext.driveAccess },
   limits: { maxDepth: x.limits.maxDepth, maxEntries: x.limits.maxEntries, maxTotalBytes: x.limits.maxTotalBytes, maxFileBytes: x.limits.maxFileBytes, maxFiles: x.limits.maxFiles } };
  expect(JSON.stringify(comparePermissions(x, y))).toBe(JSON.stringify(comparePermissions(x, x)));
  expect(comparePermissions(null, x).head.grants[0]).toMatchObject({ sensitivity: 'sensitive', sensitivityVerified: '2026-10-31' });
  expect(renderComparison(comparePermissions(null, x), 'markdown')).toContain('sensitive, verified 2026-10-31');
  const custom = comparePermissions(null, x);
  for (const change of custom.changes) for (const grant of change.after) if (grant.kind === 'scope') delete grant.sensitivityVerified;
  expect(renderComparison(custom, 'text')).not.toContain('undefined');
 });
 it('enforces severity thresholds only for declared increases', () => {
  const r = comparePermissions(cfg('github-oauth', []), cfg('github-oauth', ['gist']));
  expect(shouldFailComparison(r, 'medium')).toBe(true);expect(shouldFailComparison(r, 'high')).toBe(false);
  expect(shouldFailComparison(r)).toBe(false);expect(shouldFailComparison(comparePermissions(cfg('github-oauth', ['user']), cfg('github-oauth', ['user:email'])), 'info')).toBe(false);
 });
 it('keeps deterministic IDs/order and validates the independent JSON schema', () => {
  const a = cfg('github-oauth', ['gist', 'user:email']), b = cfg('github-oauth', ['delete_repo', 'user']);
  const r = comparePermissions(a, b);
  expect(r).toEqual(comparePermissions(cfg('github-oauth', ['user:email', 'gist']), cfg('github-oauth', ['user', 'delete_repo'])));
  for (const report of [r, comparePermissions(null, b), comparePermissions(app({}), b), comparePermissions(cfg('google-oauth', []), cfg('google-oauth', [google('gmail.modify')]))]) expect(validate(report), JSON.stringify(validate.errors)).toBe(true);
  expect(JSON.parse(renderComparison(r, 'json'))).toEqual(r);
  expect(renderComparison(r, 'text')).toContain('WARNING: ACCESS INCREASE');
  expect(renderComparison(r, 'markdown')).toContain('ACCESS INCREASE');
  expect(renderComparison(r, 'markdown')).toContain('## Declaration changes');
  const clean = comparePermissions(a, a);expect(renderComparison(clean, 'text')).toContain('No modeled privilege changes');
  expect(renderComparison(clean, 'markdown')).toContain('No modeled privilege changes');
 });
 it('checks whole-scope relations against independent official Discovery evidence', () => {
  const evidence = JSON.parse(readFileSync('tests/fixtures/google-relations/evidence.json', 'utf8')) as { services: Record<string, { methods: { id: string; scopes: string[] }[] }> };
  for (const [broad, narrowScopes] of Object.entries(googleScopeRelations.implies)) for (const narrow of narrowScopes) {
   for (const service of Object.values(evidence.services)) for (const method of service.methods) {
    if (method.scopes.includes(narrow)) expect(method.scopes, broad + ' must cover ' + narrow + ' at ' + method.id).toContain(broad);
   }
  }
  expect(googleScopeCovers(google('calendar.events'), google('calendar.events.owned'))).toBe(false);
  const mixed = comparePermissions(cfg('google-oauth', [google('calendar.events.owned')]), cfg('google-oauth', [google('calendar.events')]));
  expect(mixed.summary).toMatchObject({ added: 1, removed: 1, expanded: 0 });
 });
 it('validates explicit relation data and defends traversal against cycles', () => {
  for (const [scope, children] of Object.entries(googleScopeRelations.implies)) {
   expect(googleScopeCovers(scope, scope)).toBe(true);
   for (const child of children) { expect(googleScopeCovers(scope, child)).toBe(true);expect(googleScopeCovers(child, scope)).toBe(false); }
  }
  googleScopeRelations.implies['cycle:a'] = ['cycle:b'];googleScopeRelations.implies['cycle:b'] = ['cycle:a'];
  try { expect(googleScopeCovers('cycle:a', 'missing')).toBe(false); } finally { delete googleScopeRelations.implies['cycle:a'];delete googleScopeRelations.implies['cycle:b']; }
 });
});
