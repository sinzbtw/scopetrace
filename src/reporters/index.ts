import type { Report } from '../types.js';
export type Format = 'text' | 'json' | 'markdown';
function safe(value: string): string { return value.replace(/[\x00-\x1f\x7f-\x9f]/g, '?'); }
function md(value: string): string { return safe(value).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!).replace(/[\\|\x60*_\[\]]/g, c => '\\' + c); }
function permissionEvidence(f: Report['findings'][number]): string {
 return f.permission ? f.permission.domain + '.' + f.permission.name + (f.declaredLevel ? '=' + f.declaredLevel : '') : '';
}
export function render(report: Report, format: Format): string {
 if (format === 'json') return JSON.stringify(report, null, 2) + '\n';
 if (format === 'markdown') {
  return ['# ScopeTrace report', '', 'Provider: ' + report.provider + ' · Schema: ' + report.schemaVersion + ' · Catalog: ' + report.catalogVersion,
   '', 'Files analyzed: ' + report.analysis.filesScanned + ' · Traversal complete: ' + report.analysis.complete,
   '', '| Category | Severity | Confidence | Evidence | Explanation |', '| --- | --- | --- | --- | --- |',
   ...report.findings.map(f => {
    const op = f.operation;
    const evidence = op ? op.location.file + ':' + op.location.line + ':' + op.location.column + ' ' + op.method + ' ' + op.endpoint : (f.scope ?? (permissionEvidence(f) || f.id));
    return '| ' + [f.category, f.severity, f.confidence, evidence, f.message + (f.suggestedScopes ? ' Review alternative narrower scopes: ' + f.suggestedScopes.join(', ') : '')].map(md).join(' | ') + ' |';
   }), '', '## Sources', '', ...[...new Set(report.findings.flatMap(f => f.docs))].map(url => '- [Official documentation](' + url + ')'),
   ...(report.provider === 'google-oauth' ? ['', '## Scope classifications', '', ...report.scopeAssessments.map(s => '- ' + md(s.uri) + ': ' + s.sensitivity + ' (verified ' + s.verified + ')'),
    '', 'Classification is not a determination that verification or a security assessment is required for this app.'] : []),
   '', '## Limits', '', ...report.analysis.limitations.map(s => '- ' + s), ''
  ].join('\n');
 }
 return ['ScopeTrace ' + report.toolVersion + ' — ' + (report.provider === 'google-oauth' ? 'Google OAuth 2.0' : report.provider === 'github-app' ? 'GitHub Apps (' + report.tokenType + ')' : 'GitHub OAuth Apps'), 'Files analyzed: ' + report.analysis.filesScanned +
  ' | Traversal complete: ' + report.analysis.complete, ...report.findings.map(f => {
   const op = f.operation;
   const at = op ? ' ' + safe(op.location.file) + ':' + op.location.line + ':' + op.location.column + ' ' + safe(op.method) + ' ' + safe(op.endpoint) : '';
   return '[' + safe(f.category) + '/' + safe(f.severity) + '/' + safe(f.confidence) + '] ' + safe(f.id) + (f.scope ? ' ' + safe(f.scope) : f.permission ? ' ' + safe(permissionEvidence(f)) : '') + at + '\n  ' + safe(f.message) +
    (f.sensitivity ? '\n  Scope sensitivity: ' + f.sensitivity : '') + (f.suggestedScopes ? '\n  Review alternative narrower scopes: ' + f.suggestedScopes.join(', ') : '') + (f.ruleId ? '\n  Rule: ' + safe(f.ruleId) : '') + (f.permissionAlternatives ? '\n  Permission alternatives: ' + safe(JSON.stringify(f.permissionAlternatives)) : '') + (f.docs[0] ? '\n  ' + safe(f.docs[0]) : '');
  }), ...(report.provider === 'google-oauth' ? ['Scope classifications:', ...report.scopeAssessments.map(s => s.uri + ': ' + s.sensitivity + ' (verified ' + s.verified + ')'), 'Classification alone does not determine verification or security-assessment obligations.'] : []), 'Review required: static analysis cannot establish a minimal permission set for the entire application.', ''
 ].join('\n');
}
