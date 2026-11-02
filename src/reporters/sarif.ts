import { createHash } from 'node:crypto';
import type { Category, Finding, Report, Severity } from '../types.js';

export interface SarifOptions { configFile?: string; category?: string }
const guide = 'https://github.com/sinzbtw/scopetrace/blob/v0.4.0/docs/sarif.md';
const descriptions: Record<Category, string> = {
 insufficient: 'Declared permissions do not cover a modeled API operation',
 possibly_excessive: 'Review a potentially excessive permission declaration',
 unknown: 'Authorization analysis requires manual review',
 observed: 'Declared permissions cover the modeled requirement',
 not_applicable: 'No permission requirement established for this operation'
};
const levels: Record<Severity, 'error' | 'warning' | 'note'> = {
 high: 'error', medium: 'warning', low: 'note', info: 'note'
};
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
// Treat paths as data, never as pre-encoded URIs. Do not expose an absolute root.
function artifactUri(file: string): string {
 const normalized = file.replace(/\\/g, '/');
 if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized) || normalized.split('/').includes('..')) {
  throw new Error('SARIF locations must be relative paths inside the project root.');
 }
 const parts = normalized.split('/').filter(p => p && p !== '.');
 if (!parts.length) throw new Error('SARIF locations must identify a file.');
 return parts.map(p => encodeURIComponent(p)).join('/');
}
function ruleId(report: Report, finding: Finding): string {
 // Confidence and severity are rule-level metadata in GitHub. Separate variants
 // avoid upgrading a low-confidence review when another result is more certain.
 return ['scopetrace', report.provider, finding.ruleId ?? 'declaration', finding.category, finding.severity, finding.confidence].join('/');
}
function identity(f: Finding, uri: string): string {
 return JSON.stringify([uri, f.category, f.ruleId, f.operation?.source, f.operation?.method,
  f.operation?.endpoint, f.scope, f.permission, f.operation ? undefined : f.message]);
}
export function toSarif(report: Report, options: SarifOptions = {}) {
 const configUri = artifactUri(options.configFile ?? 'scopetrace.config.json');
 if (options.category !== undefined && (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(options.category) || options.category.length > 128)) {
  throw new Error('SARIF category must be 1-128 letters, digits, dots, underscores, slashes or hyphens, starting with a letter or digit.');
 }
 const alerts = report.findings.filter(f => !['observed', 'not_applicable'].includes(f.category));
 const entries = alerts.map(f => ({ f, id: ruleId(report, f), uri: f.operation ? artifactUri(f.operation.location.file) : configUri }));
 entries.sort((a, b) => compare(a.id, b.id) || compare(a.uri, b.uri) ||
  (a.f.operation?.location.line ?? 0) - (b.f.operation?.location.line ?? 0) ||
  (a.f.operation?.location.column ?? 0) - (b.f.operation?.location.column ?? 0) || compare(a.f.id, b.f.id));
 const ruleIds = [...new Set(entries.map(e => e.id))].sort(compare);
 const rules = ruleIds.map(id => {
  const f = entries.find(e => e.id === id)!.f;
  return {
   id, shortDescription: { text: descriptions[f.category] },
   fullDescription: { text: descriptions[f.category] + '. Confidence: ' + f.confidence + '. Review source coverage and runtime behavior before changing authorization.' },
   helpUri: guide,
   help: { text: 'ScopeTrace analyzes supported static calls against declarations. Potential excess is advice, and unknown means no authorization conclusion was reached. Confidence is separate from severity. See ' + guide },
   defaultConfiguration: { level: levels[f.severity] },
   properties: { precision: f.confidence, tags: ['authorization', report.provider, f.category],
    'problem.severity': f.severity === 'high' ? 'error' : f.severity === 'medium' ? 'warning' : 'recommendation' }
  };
 });
 const occurrences = new Map<string, number>();
 const results = entries.map(({ f, id, uri }) => {
  const key = identity(f, uri);
  const occurrence = (occurrences.get(key) ?? 0) + 1;
  occurrences.set(key, occurrence);
  const location = f.operation?.location;
  if (location && (!Number.isSafeInteger(location.line) || !Number.isSafeInteger(location.column) || location.line < 1 || location.column < 1)) {
   throw new Error('SARIF source positions must be positive integers.');
  }
  const context = !f.operation ? ' Declaration or scan-level finding; the configuration file is a file-level review anchor, not an inferred source position.' : '';
  return {
   ruleId: id, ruleIndex: ruleIds.indexOf(id), level: levels[f.severity],
   message: { text: '[' + f.category + '; confidence: ' + f.confidence + '; severity: ' + f.severity + '] ' + f.message +
    (f.scope ? ' Scope: ' + f.scope + '.' : '') +
    (f.permission ? ' Permission: ' + f.permission.domain + '.' + f.permission.name + '.' : '') +
    (f.suggestedScopes ? ' Review alternative narrower scopes: ' + f.suggestedScopes.join(', ') + '.' : '') + context },
   locations: [{ physicalLocation: { artifactLocation: { uri },
    ...(location ? { region: { startLine: location.line, startColumn: location.column } } : {}) } }],
   // Exclude line/column so inserting unrelated lines does not churn every alert.
   // Identical calls are distinguished by their source-order occurrence number.
   partialFingerprints: { 'scopetrace/v1': createHash('sha256').update(JSON.stringify([report.provider, key, occurrence])).digest('hex') },
   properties: { confidence: f.confidence, category: f.category, severity: f.severity, scopetrace: f }
  };
 });
 const { findings, ...metadata } = report;
 return {
  $schema: 'https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json',
  version: '2.1.0' as const,
  runs: [{ tool: { driver: { name: 'ScopeTrace', version: report.toolVersion,
   informationUri: 'https://github.com/sinzbtw/scopetrace', rules } },
   // Let upload-sarif assign its category unless an API caller explicitly sets one.
   ...(options.category ? { automationDetails: { id: options.category.replace(/\/$/, '') + '/' } } : {}),
   columnKind: 'utf16CodeUnits' as const, results,
   invocations: [{ executionSuccessful: true,
    toolExecutionNotifications: [
     ...report.analysis.notices.map(n => ({ descriptor: { id: n.code }, level: 'warning', message: { text: n.message } })),
     ...(!report.analysis.complete ? [{ descriptor: { id: 'incomplete-analysis' }, level: 'warning', message: { text: 'Selected-file analysis is incomplete. An absent alert does not establish sufficient authorization.' } }] : [])
    ] }],
   properties: { scopetrace: { ...metadata, nonAlertFindings: findings.filter(f => ['observed', 'not_applicable'].includes(f.category)) } }
  }]
 };
}
