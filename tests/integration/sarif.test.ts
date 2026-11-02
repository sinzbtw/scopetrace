import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runCli } from '../../src/cli/run.js';
const roots: string[] = [];
async function run(args: string[], cwd: string) {
 let stdout = '', stderr = '';
 const code = await runCli(args, cwd, { stdout: s => { stdout += s; }, stderr: s => { stderr += s; } });
 return { code, stdout, stderr };
}
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
describe('SARIF CLI and GitHub integration', () => {
 it.each(['basic', 'github-app', 'google-oauth'])('exports %s with a parseable SARIF document and unchanged gate exit', async fixture => {
  const result = await run(['scan', '--format', 'sarif', '--fail-on', 'high'], path.resolve('tests/fixtures', fixture));
  expect(result.code).toBe(1);expect(result.stderr).toBe('');
  const sarif = JSON.parse(result.stdout);
  expect(sarif.version).toBe('2.1.0');
  expect(sarif.runs[0].results.some((r: { properties: { category: string } }) => r.properties.category === 'insufficient')).toBe(true);
  expect((await run(['scan', '--format', 'sarif'], path.resolve('tests/fixtures', fixture))).code).toBe(0);
 });
 it('writes the full report before exit 1, uses the actual config anchor and never overwrites exports', async () => {
  const parent = path.resolve('work/tests');await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'sarif-'));roots.push(root);
  await mkdir(path.join(root, 'config'));
  await writeFile(path.join(root, 'config/permissions.json'), JSON.stringify({ provider: 'github-oauth', declaredScopes: ['workflow'], include: ['*.ts'] }));
  await writeFile(path.join(root, 'app.ts'), "fetch('https://api.github.com/repos/example/sample',{method:'DELETE'});");
  const args = ['scan', '--config', path.join(root, 'config/permissions.json'), '--format', 'sarif', '--output', 'report.sarif', '--fail-on', 'high'];
  expect(await run(args, root)).toEqual({ code: 1, stdout: '', stderr: '' });
  const original = await readFile(path.join(root, 'report.sarif'), 'utf8');
  const sarif = JSON.parse(original);
  const declaration = sarif.runs[0].results.find((r: { properties: { category: string } }) => r.properties.category === 'possibly_excessive');
  expect(declaration.locations).toEqual([{ physicalLocation: { artifactLocation: { uri: 'config/permissions.json' } } }]);
  expect(original).not.toContain(root.replace(/\\/g, '\\\\'));
  expect((await run(args, root)).code).toBe(2);
  expect(await readFile(path.join(root, 'report.sarif'), 'utf8')).toBe(original);
 });
 it('enables the same upload flow in this repository with an explicit source-only config', async () => {
  const yaml = await readFile('.github/workflows/code-scanning.yml', 'utf8');
  const cfg = JSON.parse(await readFile('.github/scopetrace.config.json', 'utf8'));
  expect(cfg).toMatchObject({ provider: 'github-oauth', declaredScopes: [], include: ['src/**/*.{js,jsx,ts,tsx}'] });
  expect(yaml).toContain('--config .github/scopetrace.config.json');
  expect(yaml).toContain('--format sarif');expect(yaml).toContain('pull_request:');
  expect(yaml).not.toContain('pull_request_target');expect(yaml).toContain('security-events: write');
  expect(yaml.indexOf('name: Enforce permission gate')).toBeGreaterThan(yaml.indexOf('name: Upload SARIF'));
 });
 it('documents a pinned PR upload workflow that uploads before applying the gate', async () => {
  const yaml = await readFile('examples/github-code-scanning.yml', 'utf8');
  expect(yaml).toContain('pull_request:');expect(yaml).not.toContain('pull_request_target');
  expect(yaml).toContain('security-events: write');expect(yaml).toContain('contents: read');
  expect(yaml).not.toContain('pull-requests: write');
  expect(yaml).toContain('checkout_path: app');expect(yaml).toContain('persist-credentials: false');
  expect(yaml).toContain('--format sarif');expect(yaml).toContain('--fail-on high');
  expect(yaml).toContain('if [ "$status" -gt 1 ]; then exit "$status"; fi');
  expect(yaml.indexOf('name: Upload SARIF')).toBeGreaterThan(yaml.indexOf('id: scan'));
  expect(yaml.indexOf('name: Enforce permission gate')).toBeGreaterThan(yaml.indexOf('name: Upload SARIF'));
  for (const line of yaml.split('\n').filter(l => l.includes('uses:'))) expect(line).toMatch(/@[0-9a-f]{40}(?:\s|$)/);
  expect(yaml).toMatch(/ref: [0-9a-f]{40}/);
 });
});
