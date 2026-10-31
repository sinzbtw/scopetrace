import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { defaultConfig, defaultAppConfig, defaultGoogleConfig, loadConfig } from '../config/index.js';
import { evaluate, shouldFail, VERSION } from '../engine/index.js';
import { googleCatalog } from '../providers/google/index.js';
import { appCatalog } from '../providers/github-app/index.js';
import { catalog } from '../providers/github/index.js';
import { render, type Format } from '../reporters/index.js';
import { scanProject } from '../scanner/index.js';
import type { Severity } from '../types.js';
const help = `ScopeTrace — static GitHub and Google authorization analysis (Node.js 22+)

Usage:
  scopetrace init [--provider github-oauth|github-app|google-oauth]
  scopetrace scan [--config FILE] [--format text|json|markdown] [--output FILE]
                  [--fail-on info|low|medium|high]
  scopetrace rules [--provider github-oauth|github-app|google-oauth]
  scopetrace --help
  scopetrace --version

Run scan from the project root. Config paths must stay inside it.
Output files are created exclusively: existing files are never overwritten.
--fail-on blocks insufficient findings at or above the severity with medium/high confidence.
Exit codes: 0 successful scan, 1 threshold met, 2 execution/configuration error.
Scan is local: no tokens, network calls or execution of project code.
`;
export interface CliIO { stdout: (text: string) => void; stderr: (text: string) => void }
const clean = (s: string) => s.replace(/[\x00-\x1f\x7f-\x9f]/g, '?');
async function writeNew(filename: string, data: string): Promise<void> {
 const absolute = path.resolve(filename);
 const parent = await realpath(path.dirname(absolute));
 // The parent must resolve exactly to prevent writing through directory symlinks.
 const normalize = (p: string) => process.platform === 'win32' ? p.toLowerCase() : p;
 if (normalize(path.resolve(parent)) !== normalize(path.dirname(absolute))) throw new Error('Output parent must not contain a symbolic link.');
 try { await lstat(absolute); throw new Error('Output file already exists; choose a new filename.'); }
 catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
 const handle = await open(absolute, 'wx');
 try { await handle.writeFile(data, 'utf8'); } finally { await handle.close(); }
}
export async function runCli(args: string[], cwd: string, io: CliIO): Promise<number> {
 try {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
   help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
   provider: { type: 'string' }, config: { type: 'string' }, format: { type: 'string' }, output: { type: 'string' }, 'fail-on': { type: 'string' }
  } });
  if (values.help) { io.stdout(help); return 0; }
  if (values.version) { io.stdout(VERSION + '\n'); return 0; }
  const command = positionals[0];
  if (!command && args.length === 0) { io.stdout(help); return 0; }
  if (positionals.length !== 1 || !['init', 'scan', 'rules'].includes(command ?? '')) throw new Error('Expected one command: init, scan or rules. See --help.');
  if (command !== 'scan' && ['config', 'format', 'output', 'fail-on'].some(k => k in values)) throw new Error('Scan options are only valid with scan.');
  if (values.provider && !['github-oauth', 'github-app', 'google-oauth'].includes(values.provider)) throw new Error('Provider must be github-oauth, github-app or google-oauth.');
  if (command === 'scan' && values.provider) throw new Error('Select the scan provider in the JSON config.');
  if (command === 'init') {
   await writeNew(path.join(cwd, 'scopetrace.config.json'), JSON.stringify(values.provider === 'google-oauth' ? defaultGoogleConfig : values.provider === 'github-app' ? defaultAppConfig : defaultConfig, null, 2) + '\n');
   io.stdout('Created scopetrace.config.json. Set the declarations and review include patterns.\n'); return 0;
  }
  if (command === 'rules') {
   if (values.provider === 'google-oauth') {
    io.stdout('google-oauth catalog ' + googleCatalog.version + '\n' + googleCatalog.rules.map(r =>
     r.id + ' ' + r.method + ' ' + r.endpoint + '\n  SDK: ' + r.service + '.' + r.sdk +
     '\n  Alternatives: ' + JSON.stringify(r.alternatives) + '\n  Verified: ' + r.verified + '\n  ' + r.docs.join('\n  ')).join('\n') +
     '\nScope classifications:\n' + googleCatalog.scopes.map(s => s.uri + ': ' + s.sensitivity + ' (verified ' + s.verified + ')').join('\n') + '\n');
    return 0;
   }
   const selected = values.provider === 'github-app' ? appCatalog : catalog;
   io.stdout(selected.provider + ' catalog ' + selected.version + '\n' + selected.rules.map(r =>
    r.id + ' ' + r.method + ' ' + r.endpoint + '\n  ' + r.rationale + '\n  Condition: ' + r.condition +
    '\n  Alternatives: ' + JSON.stringify(r.alternatives) + '\n  Verified: ' + r.verified + '\n  ' + r.docs.join('\n  ')).join('\n') + '\n');
   return 0;
  }
  const format = values.format ?? 'text';
  if (!['text', 'json', 'markdown'].includes(format)) throw new Error('Format must be text, json or markdown.');
  const threshold = values['fail-on'];
  if (threshold && !['info', 'low', 'medium', 'high'].includes(threshold)) throw new Error('Invalid --fail-on severity.');
  const config = await loadConfig(cwd, values.config);
  const result = await scanProject(cwd, config);
  const report = evaluate(result, config);
  const output = render(report, format as Format);
  if (values.output) await writeNew(path.resolve(cwd, values.output), output);
  else io.stdout(output);
  return threshold && shouldFail(report, threshold as Severity) ? 1 : 0;
 } catch (error) {
  // Filesystem/JSON/parser errors may contain untrusted paths or source text.
  const code = (error as NodeJS.ErrnoException).code;
  const message = code ? 'Operation failed (' + clean(code) + '). Check paths and permissions.' :
   error instanceof Error && !error.message.includes('\n') ? clean(error.message) : 'Operation failed safely.';
  io.stderr('ScopeTrace: ' + message + '\n'); return 2;
 }
}
