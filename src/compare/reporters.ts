import { grantLabel } from './engine.js';
import type { ComparisonFormat, ComparisonReport } from './types.js';
const safe = (s: string) => s.replace(/[\x00-\x1f\x7f-\x9f]/g, '?');
const md = (s: string) => safe(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!).replace(/[\\|\x60*_\[\]]/g, c => '\\' + c);
export function renderComparison(report: ComparisonReport, format: ComparisonFormat): string {
 if (format === 'json') return JSON.stringify(report, null, 2) + '\n';
 const display = (g: Parameters<typeof grantLabel>[0]) => grantLabel(g) + (g.kind === 'scope' && g.sensitivity ? ' [' + g.sensitivity + (g.sensitivityVerified ? ', verified ' + g.sensitivityVerified : '') + ']' : '');
 const lines = report.changes.map(c => ({ change: c, before: c.before.map(display).join(', ') || '(none)', after: c.after.map(display).join(', ') || '(none)' }));
 const source = report.source ? report.source.baseCommit + ' -> ' + report.source.headCommit + ' (' + report.source.mode + ', ' + report.source.configPath + ')' : 'Validated configuration objects';
 const contexts = JSON.stringify({ base: report.base.context, head: report.head.context, baseTokenType: report.base.tokenType, headTokenType: report.head.tokenType });
 const summary = Object.entries(report.summary).map(([key, value]) => key + ': ' + value).join(' | ');
 if (format === 'markdown') return ['# ScopeTrace permission changes', '', 'Provider: ' + md(report.provider ?? 'incomparable models'), '', md(source), '', 'Authorization context: ' + md(contexts), '', md(summary),
  '', 'Comparison complete: ' + report.analysis.complete, '', '| Change | Severity | Confidence | Before | After | Review |', '| --- | --- | --- | --- | --- | --- |',
  ...lines.map(({ change: c, before, after }) => '| ' + [c.kind, c.severity, c.confidence, before, after, (c.escalation ? 'ACCESS INCREASE: ' : '') + c.message].map(md).join(' | ') + ' |'),
  ...(report.changes.length ? [] : ['', 'No modeled privilege changes detected.']), '', '## Declaration changes', '',
  ...report.declarations.added.map(g => '- Added: ' + md(grantLabel(g))), ...report.declarations.removed.map(g => '- Removed: ' + md(grantLabel(g))),
  '', '## Limits', '', ...report.analysis.limitations.map(s => '- ' + md(s)), ''
 ].join('\n');
 return ['ScopeTrace ' + report.toolVersion + ' — permission changes', safe(source), 'Authorization context: ' + safe(contexts), summary, 'Comparison complete: ' + report.analysis.complete,
  ...lines.map(({ change: c, before, after }) => '[' + c.kind + '/' + c.severity + '/' + c.confidence + '] ' + (c.escalation ? 'WARNING: ACCESS INCREASE ' : '') + safe(before) + ' -> ' + safe(after) + '\n  ' + safe(c.message)),
  ...(report.changes.length ? [] : ['No modeled privilege changes detected.']), 'Declared additions: ' + report.declarations.added.map(grantLabel).map(safe).join(', '),
  'Declared removals: ' + report.declarations.removed.map(grantLabel).map(safe).join(', '), 'Declaration changes do not establish runtime token grants or revocation.', ''
 ].join('\n');
}
