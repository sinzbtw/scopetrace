import type { OAuthConfig } from '../config/index.js';
import { catalog, covers, normalizeScopes, ruleFor } from '../providers/github/index.js';
import type { Finding, OAuthReport, ScanResult, Severity } from '../types.js';
import { VERSION, findingId } from './shared.js';
const scopesDocs = 'https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps';
export function evaluateOAuth(scan: ScanResult, config: OAuthConfig): OAuthReport {
 const findings: Finding[] = [];
 const recognized = [...new Set(config.declaredScopes.filter(s => catalog.scopes.includes(s)))].sort();
 const normalized = normalizeScopes(recognized);
 const used = new Set<string>();
 const add = (key: string, f: Omit<Finding, 'id'>) => findings.push({ id: findingId(key), ...f });
 for (const op of scan.operations) {
  const key = JSON.stringify([op.location, op.source, op.method, op.endpoint]);
  const rule = ruleFor(op.method, op.endpoint);
  if (!rule || op.reason) {
   add(key, { category: 'unknown', severity: 'info', confidence: 'low', operation: op,
    message: op.reason ?? 'No verified GitHub OAuth rule covers this operation.', docs: [] });
   continue;
  }
  if (rule.condition === 'repository-read' && config.repositoryVisibility === 'unknown') {
   add(key, { category: 'unknown', severity: 'info', confidence: 'low', operation: op, ruleId: rule.id,
    message: 'Repository visibility is unknown. A public read may need no scope; a private read may require repo. No visibility is inferred from source code.', alternatives: rule.alternatives, docs: rule.docs });
   continue;
  }
  const alternatives = rule.condition === 'repository-read' ? (config.repositoryVisibility === 'public' ? [[]] : [['repo']]) : rule.alternatives;
  const confidence = rule.condition === 'repository-read' ? 'medium' : rule.confidence;
  if (alternatives.some(a => a.length === 0)) {
   add(key, { category: 'not_applicable', severity: 'info', confidence, operation: op, ruleId: rule.id,
    message: rule.rationale + ' This modeled public read does not establish a need for any declared scope.', alternatives, docs: rule.docs });
   continue;
  }
  const sufficient = alternatives.filter(a => a.every(required => normalized.some(grant => covers(grant, required))));
  if (sufficient.length) {
   for (const grant of normalized) if (sufficient.some(a => a.some(s => covers(grant, s)))) used.add(grant);
   add(key, { category: 'observed', severity: 'info', confidence, operation: op, ruleId: rule.id,
    message: rule.rationale + ' Declared scopes cover the modeled requirement; account access and runtime authorization are not checked.', alternatives, docs: rule.docs });
  } else {
   const severity: Severity = ['DELETE', 'PATCH', 'POST'].includes(op.method) ? 'high' : 'medium';
   add(key, { category: 'insufficient', severity, confidence, operation: op, ruleId: rule.id,
    message: rule.rationale + ' None of the documented scope alternatives is covered by the declaration.', alternatives, docs: rule.docs });
  }
 }
 for (const scope of normalized) {
  if (scope === 'offline_access') {
   add('scope:' + scope, { category: 'unknown', severity: 'info', confidence: 'low', scope,
    message: 'offline_access controls token lifetime and refresh behavior; source API operations cannot establish its necessity.', docs: [scopesDocs] });
  } else if (!used.has(scope)) {
   add('scope:' + scope, { category: 'possibly_excessive', severity: 'low', confidence: 'low', scope,
    message: 'No supported operation establishes a need for this scope. Review excluded files, unknown calls, runtime paths and other tokens before changing the declaration.', docs: [scopesDocs] });
  } else {
   const requirements = findings.filter(f => f.category === 'observed').flatMap(f => f.alternatives ?? []).flat();
   if (requirements.some(required => required !== scope && covers(scope, required)) && !requirements.includes(scope)) {
    add('broad:' + scope, { category: 'possibly_excessive', severity: 'low', confidence: 'low', scope,
     message: 'A narrower scope covers the observed use. Other operations may still need the broader grant; review before narrowing it.', docs: [scopesDocs] });
   }
  }
 }
 const unknownCount = new Set(config.declaredScopes.filter(s => !catalog.scopes.includes(s))).size;
 if (unknownCount) add('unrecognized-scopes', { category: 'unknown', severity: 'info', confidence: 'low',
  message: 'The declaration contains unrecognized scope names. Values are omitted from reports.', docs: [scopesDocs] });
 for (const [index, notice] of scan.notices.entries()) add('notice:' + index + ':' + notice.code, {
  category: 'unknown', severity: 'info', confidence: 'low',
  message: notice.message, docs: []
 });
 findings.sort((a, b) => a.id.localeCompare(b.id));
 return {
  schemaVersion: '1.0.0', toolVersion: VERSION, provider: 'github-oauth', catalogVersion: catalog.version,
  declaredScopes: [...recognized, ...(unknownCount ? ['<unrecognized>'] : [])], normalizedScopes: normalized,
  analysis: { filesScanned: scan.filesScanned, complete: scan.complete, notices: scan.notices,
   limitations: [
    'Complete means traversal and parsing finished within the selected files; it never means all application behavior was analyzed.',
    'Intrafile static calls only; wrappers, cross-file dataflow, dynamic routes, GraphQL, custom transports and other HTTP clients are not resolved.',
    'All detected operations are compared with one declared scope set; credential identity and reachability are not inferred.',
    'Repository visibility is a user assertion applying to all modeled repository reads.',
    'Scopes limit a token; user access, SSO, organization policies, granted scopes and runtime behavior are not verified.',
    'Potential excess is low-confidence evidence for manual review, never proof that revoking a scope is safe.'
   ] },
  operations: scan.operations, findings
 };
}
