import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import AjvModule from 'ajv-draft-04';
import { configSchema, oauthConfigSchema } from '../../src/config/index.js';
import { evaluate, shouldFail } from '../../src/engine/index.js';
import { parseSource } from '../../src/scanner/ast.js';
import { toSarif } from '../../src/reporters/sarif.js';
import { render } from '../../src/reporters/index.js';
import type { Category, Confidence, Finding, Report, Severity } from '../../src/types.js';
const ajv = new AjvModule.default({ allErrors: true, strict: false });
const uri = (value: string, base?: string) => !/[\s\\]/.test(value) && URL.canParse(value, base);
ajv.addFormat('uri', v => uri(v));
ajv.addFormat('uri-reference', v => uri(v, 'https://scopetrace.invalid/'));
ajv.addFormat('date-time', v => /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v)));
const validate = ajv.compile(JSON.parse(readFileSync(new URL('../schemas/sarif-schema-2.1.0.json', import.meta.url), 'utf8')));
function report(code = "fetch('https://api.github.com/user/emails');"): Report {
 return evaluate({ ...parseSource(code, 'src/app.ts'), filesScanned: 1, complete: true }, oauthConfigSchema.parse({ provider: 'github-oauth', declaredScopes: [] }));
}
function finding(category: Category, severity: Severity, confidence: Confidence): Finding {
 return { id: category + severity + confidence, category, severity, confidence, message: 'Synthetic evidence.', docs: [] };
}
describe('SARIF 2.1.0 contract', () => {
 it.each(['basic', 'github-app', 'google-oauth'])('validates %s against the offline official OASIS schema and preserves every finding', fixture => {
  const base = new URL('../fixtures/' + fixture + '/', import.meta.url);
  const cfg = configSchema.parse(JSON.parse(readFileSync(new URL('scopetrace.config.json', base), 'utf8')));
  const source = readFileSync(new URL('src/app.ts', base), 'utf8');
  const r = evaluate({ ...parseSource(source, 'src/app.ts', cfg.provider), filesScanned: 1, complete: true }, cfg);
  const before = JSON.stringify(r);
  const { findings, ...metadata } = r;
  const sarif = toSarif(r), run = sarif.runs[0]!;
  expect(validate(sarif), JSON.stringify(validate.errors)).toBe(true);
  expect(run.tool.driver).toMatchObject({ name: 'ScopeTrace', version: '0.4.0' });
  expect(run.columnKind).toBe('utf16CodeUnits');
  expect(run.automationDetails.id).toBe('scopetrace/' + cfg.provider + '/');
  expect(run.results.length + run.properties.scopetrace.nonAlertFindings.length).toBe(findings.length);
  for (const f of findings) {
   const result = run.results.find(result => result.properties.scopetrace.id === f.id);
   if (['observed', 'not_applicable'].includes(f.category)) expect(run.properties.scopetrace.nonAlertFindings).toContainEqual(f);
   else {
    expect(result?.properties).toMatchObject({ confidence: f.confidence, category: f.category, severity: f.severity, scopetrace: f });
    expect(result?.message.text).toContain('confidence: ' + f.confidence);
    expect(run.tool.driver.rules[result!.ruleIndex]?.id).toBe(result!.ruleId);
    expect(run.tool.driver.rules[result!.ruleIndex]?.properties.precision).toBe(f.confidence);
   }
  }
  expect(run.properties.scopetrace).toMatchObject(metadata);
  expect(JSON.parse(render(r, 'sarif'))).toEqual(sarif);
  expect(JSON.stringify(r)).toBe(before);
 });
 it('maps severity without raising review or unknown confidence and without inventing CVSS scores', () => {
  const r = report();
  r.findings = [finding('insufficient', 'high', 'high'), finding('insufficient', 'medium', 'medium'),
   finding('possibly_excessive', 'low', 'low'), finding('unknown', 'info', 'low')];
  const run = toSarif(r).runs[0]!;
  for (const result of run.results) {
   expect(result.level).toBe(({ high: 'error', medium: 'warning', low: 'note', info: 'note' })[result.properties.severity]);
   expect(result.locations[0]!.physicalLocation).toEqual({ artifactLocation: { uri: 'scopetrace.config.json' } });
   expect(result.message.text).toContain('file-level review anchor');
   expect(run.tool.driver.rules[result.ruleIndex]?.properties).not.toHaveProperty('security-severity');
  }
  expect(validate({ version: '2.1.0', runs: [run] }), JSON.stringify(validate.errors)).toBe(true);
 });
 it('uses separate stable rule variants for different confidence levels, not per-finding IDs', () => {
  const r = report();
  r.findings = [finding('insufficient', 'medium', 'high'), finding('insufficient', 'medium', 'low')];
  const rules = toSarif(r).runs[0]!.tool.driver.rules;
  expect(rules).toHaveLength(2);
  expect(rules.map(r => r.properties.precision).sort()).toEqual(['high', 'low']);
  expect(rules.every(rule => rule.id.startsWith('scopetrace/github-oauth/'))).toBe(true);
 });
 it('encodes relative paths, Windows separators, reserved characters and non-ASCII without exposing the checkout root', () => {
  const r = report();r.findings[0]!.operation!.location.file = 'src\\файл #?%[x].ts';
  const result = toSarif(r).runs[0]!.results[0]!;
  expect(result.locations[0]!.physicalLocation).toEqual({ artifactLocation: { uri: 'src/%D1%84%D0%B0%D0%B9%D0%BB%20%23%3F%25%5Bx%5D.ts' }, region: { startLine: 1, startColumn: 1 } });
  const sarif = toSarif(r);expect(validate(sarif), JSON.stringify(validate.errors)).toBe(true);
  r.findings = [finding('unknown', 'info', 'low')];
  expect(toSarif(r, { configFile: './config/permissions #.json' }).runs[0]!.results[0]!.locations[0]!.physicalLocation.artifactLocation.uri).toBe('config/permissions%20%23.json');
 });
 it.each(['/absolute/a.ts', 'C:\\private\\a.ts', 'C:relative.ts', '../secret.ts', 'src/../secret.ts', '', '.'])('rejects unsafe artifact paths: %s', file => {
  const r = report();r.findings[0]!.operation!.location.file = file;
  expect(() => toSarif(r)).toThrow('SARIF locations');
  expect(() => toSarif(report(), { configFile: file })).toThrow('SARIF locations');
 });
 it.each([0, -1, 1.5, Number.NaN])('rejects invalid source positions: %s', position => {
  const r = report();r.findings[0]!.operation!.location.line = position;
  expect(() => toSarif(r)).toThrow('positive integers');
  r.findings[0]!.operation!.location.line = 1;r.findings[0]!.operation!.location.column = position;
  expect(() => toSarif(r)).toThrow('positive integers');
 });
 it('retains fingerprints when unrelated lines are inserted, distinguishes repeated calls and sorts results independently of scan order', () => {
  const code = "fetch('https://api.github.com/user/emails');\nfetch('https://api.github.com/user/emails');";
  const first = report(code), shifted = report('\n\n' + code);
  const a = toSarif(first).runs[0]!.results, b = toSarif(shifted).runs[0]!.results;
  expect(a.map(r => r.partialFingerprints)).toEqual(b.map(r => r.partialFingerprints));
  expect(new Set(a.map(r => r.partialFingerprints['scopetrace/v1'])).size).toBe(2);
  expect(a[0]!.properties.scopetrace.id).not.toBe(b[0]!.properties.scopetrace.id);
  first.findings.reverse();expect(toSarif(first).runs[0]!.results).toEqual(a);
  const changed = report("fetch('https://api.github.com/user/following/example',{method:'PUT'});");
  expect(toSarif(changed).runs[0]!.results[0]!.partialFingerprints).not.toEqual(a[0]!.partialFingerprints);
 });
 it('retains incomplete analysis and notices, and does not turn a clean scan into findings', () => {
  const r = report();r.operations = [];r.findings = [];r.analysis.complete = false;
  r.analysis.notices = [{ code: 'limit', message: 'Traversal limit reached.' }];
  const sarif = toSarif(r), run = sarif.runs[0]!;
  expect(run.results).toEqual([]);expect(run.tool.driver.rules).toEqual([]);
  expect(run.properties.scopetrace.analysis.complete).toBe(false);
  expect(run.invocations[0]!.toolExecutionNotifications.map(n => n.descriptor.id)).toEqual(['limit', 'incomplete-analysis']);
  expect(validate(sarif), JSON.stringify(validate.errors)).toBe(true);
  r.analysis.complete = true;r.analysis.notices = [];
  expect(toSarif(r).runs[0]!.invocations[0]!.toolExecutionNotifications).toEqual([]);
 });
 it('keeps observed and not-applicable evidence out of alert results', () => {
  const r = report();r.findings = [finding('observed', 'info', 'high'), finding('not_applicable', 'info', 'medium')];
  const run = toSarif(r).runs[0]!;
  expect(run.results).toEqual([]);expect(run.properties.scopetrace.nonAlertFindings).toEqual(r.findings);
 });
 it('keeps the confidence-aware gate independent from the output format', () => {
  const r = report();r.findings = [finding('insufficient', 'high', 'low'), finding('possibly_excessive', 'high', 'low')];
  render(r, 'sarif');expect(shouldFail(r, 'info')).toBe(false);
  r.findings[0]!.confidence = 'medium';expect(shouldFail(r, 'high')).toBe(true);
 });
 it('does not render auth, body, query or raw URL identifiers from any provider', () => {
  for (const [provider, code] of [
   ['github-oauth', "fetch('https://api.github.com/repos/SENTINEL/private',{method:'DELETE',headers:{Authorization:'SENTINEL'},body:'SENTINEL'});"],
   ['github-app', "fetch('https://api.github.com/repos/SENTINEL/private/issues',{method:'POST',body:'SENTINEL'});"],
   ['google-oauth', "fetch('https://www.googleapis.com/drive/v3/files/SENTINEL?alt=media',{headers:{Authorization:'SENTINEL'}});"]
  ] as const) {
   const cfg = configSchema.parse(provider === 'github-app' ? { provider, tokenType: 'installation', declaredPermissions: {} } : { provider, declaredScopes: [] });
   const r = evaluate({ ...parseSource(code, 'src/app.ts', provider), filesScanned: 1, complete: true }, cfg);
   expect(render(r, 'sarif')).not.toContain('SENTINEL');
   expect(render(r, 'sarif')).not.toContain('Authorization');
  }
 });
});
