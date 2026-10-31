import type { GoogleConfig } from '../config/index.js';
import type { Finding, GoogleAlternative, GoogleOperationFacts, GoogleReport, Operation, ScanResult } from '../types.js';
import { googleCatalog } from '../providers/google/index.js';
import { findingId, VERSION } from './shared.js';
type Certainty = true | false | 'unknown';
export function googleCondition(condition: GoogleAlternative['condition'], op: Operation, config: GoogleConfig): Certainty {
 const facts: GoogleOperationFacts = op.google ?? {};
 if (op.endpoint.startsWith('/drive/') && config.googleContext.driveAccess === 'app-data' && condition !== 'drive-appdata') return false;
 switch (condition) {
  case 'always': return true;
  case 'drive-general': return true;
  case 'gmail-metadata':
   if (op.endpoint.endsWith('/messages')) return facts.gmailQuery === 'absent' ? true : facts.gmailQuery === 'present' ? false : 'unknown';
   return facts.gmailFormat === 'metadata' || facts.gmailFormat === 'minimal' ? true : facts.gmailFormat === 'full' || facts.gmailFormat === 'raw' ? false : 'unknown';
  case 'drive-metadata': return facts.driveResponse === 'metadata' ? true : facts.driveResponse === 'media' ? false : 'unknown';
  case 'drive-metadata-write': return facts.driveWrite === 'metadata' ? true : facts.driveWrite === 'content' ? false : 'unknown';
  case 'drive-file': return config.googleContext.driveAccess === 'app-authorized' ? true : 'unknown';
  case 'drive-appdata': return config.googleContext.driveAccess === 'app-data' ? true : 'unknown';
  case 'calendar-owned': return config.googleContext.calendarResources === 'owned' ? true : 'unknown';
  case 'calendar-app-created': return config.googleContext.calendarResources === 'app-created' ? true : 'unknown';
  case 'calendar-public': return config.googleContext.calendarResources === 'public' ? true : 'unknown';
  case 'calendar-availability': return config.googleContext.calendarData === 'availability' ? true : 'unknown';
  case 'unmodeled-context': return 'unknown';
 }
}
export function evaluateGoogle(scan: ScanResult, config: GoogleConfig): GoogleReport {
 const findings: Finding[] = [];
 const vocabulary = new Map(googleCatalog.scopes.map(s => [s.uri, s]));
 const declared = [...new Set(config.declaredScopes.filter(s => vocabulary.has(s)))].sort();
 const grants = new Set(declared);
 const relevant = new Map<string, { op: Operation; alternatives: GoogleAlternative[] }[]>();
 const add = (key: string, finding: Omit<Finding, 'id'>) => findings.push({ id: findingId('google-oauth:' + key), ...finding });
 for (const op of scan.operations) {
  const key = JSON.stringify([op.location, op.source, op.method, op.endpoint]);
  const rule = googleCatalog.rules.find(r => r.method === op.method && r.endpoint === op.endpoint);
  if (!rule || op.reason) {
   add(key, { category: 'unknown', severity: 'info', confidence: 'low', operation: op,
    message: op.reason ?? 'No verified Google OAuth rule covers this operation.', docs: [] });
   continue;
  }
  const alternatives = rule.alternatives.map(a => a.scopes);
  const evidence = { operation: op, ruleId: rule.id, alternatives, googleAlternatives: rule.alternatives, docs: rule.docs };
  for (const scope of declared) {
   if (rule.alternatives.some(a => a.scopes.includes(scope) && googleCondition(a.condition, op, config) !== false)) {
    const rows = relevant.get(scope) ?? []; rows.push({ op, alternatives: rule.alternatives }); relevant.set(scope, rows);
   }
  }
  const granted = rule.alternatives.filter(a => a.scopes.every(s => grants.has(s)));
  const provenAlternatives = granted.filter(a => googleCondition(a.condition, op, config) === true);
  const proven = provenAlternatives.length > 0;
  const uncertain = config.declaredScopes.some(s => !vocabulary.has(s)) || granted.some(a => googleCondition(a.condition, op, config) === 'unknown') ||
   declared.some(s => vocabulary.get(s)?.sufficiency === 'unmodeled' && vocabulary.get(s)?.service === rule.service);
  if (proven) {
   add(key, { ...evidence, category: 'observed', severity: 'info', confidence: provenAlternatives.some(a => ['always', 'drive-general', 'gmail-metadata', 'drive-metadata', 'drive-metadata-write'].includes(a.condition)) ? rule.confidence : 'medium',
    message: 'A documented Google OAuth alternative is declared and its modeled conditions hold. Actual token grants, user access and response use are not verified.' });
  } else if (uncertain || (rule.service === 'calendar' && config.googleContext.calendarResources === 'public' && op.method === 'GET')) {
   add(key, { ...evidence, category: 'unknown', severity: 'info', confidence: 'low',
    message: 'A declared scope may cover this operation, but its parameter, resource or authorization-context conditions are not proven. No broader grant is demanded.' });
  } else {
   add(key, { ...evidence, category: 'insufficient', severity: op.method === 'GET' ? 'medium' : 'high', confidence: rule.service === 'drive' && config.googleContext.driveAccess === 'app-data' ? 'medium' : 'high',
    message: 'No known declared Google OAuth alternative satisfies this operation and its modeled conditions. Check documented alternatives before requesting additional access.' });
  }
 }
 const assessments = declared.map(scope => vocabulary.get(scope)!);
 for (const scope of declared) {
  const info = vocabulary.get(scope)!;
  const evidence = { scope, sensitivity: info.sensitivity, docs: info.docs };
  const rows = relevant.get(scope) ?? [];
  if (info.sensitivity === 'unknown') add('classification:' + scope, {
   ...evidence, category: 'unknown', severity: 'info', confidence: 'low',
   message: 'The checked official sources do not establish a sensitivity category for this scope. Verify the current consent configuration; it is not classified as non-sensitive.'
  });
  if (!rows.length) {
   add('unused:' + scope, { ...evidence, category: 'possibly_excessive', severity: 'low', confidence: 'low',
    message: 'No supported operation establishes a need for this scope. Review unknown calls, excluded code, login flows and other credentials before removing it.' });
   continue;
  }
  const candidates = (googleCatalog.narrower[scope] ?? []).filter(candidate => rows.every(({op, alternatives}) =>
   alternatives.some(a => a.scopes.length === 1 && a.scopes[0] === candidate && googleCondition(a.condition, op, config) === true)));
  if (candidates.length) add('broad:' + scope, { ...evidence, category: 'possibly_excessive', severity: 'low', confidence: 'low', suggestedScopes: candidates,
   message: 'Narrower candidates cover the modeled operations that support this scope. Each candidate is an alternative, not a request to add all scopes. Verify remaining behavior and resource coverage before changing consent.'
  });
 }
 if (config.declaredScopes.some(s => !vocabulary.has(s))) add('unrecognized-scopes', {
  category: 'unknown', severity: 'info', confidence: 'low', message: 'Unrecognized scope values are omitted from reports; their authorization and sensitivity are not inferred.', docs: []
 });
 for (const [index, notice] of scan.notices.entries()) add('notice:' + index + ':' + notice.code, {
  category: 'unknown', severity: 'info', confidence: 'low', message: notice.message, docs: []
 });
 findings.sort((a, b) => a.id.localeCompare(b.id));
 return {
  schemaVersion: '3.0.0', provider: 'google-oauth', toolVersion: VERSION, catalogVersion: googleCatalog.version,
  declaredScopes: [...declared, ...(config.declaredScopes.some(s => !vocabulary.has(s)) ? ['<unrecognized>'] : [])],
  normalizedScopes: declared, scopeAssessments: assessments, operations: scan.operations, findings,
  analysis: { filesScanned: scan.filesScanned, complete: scan.complete, notices: scan.notices, limitations: [
   'Gmail v1, Drive v3 and Calendar v3 only, using supported static fetch URLs and proven Google Node SDK imports.',
   'URI spelling does not establish scope implication. Conditional file/calendar/add-on scopes are not treated as global grants.',
   'Resource context is a user assertion applying to the entire scan. Split mixed-resource applications into separate scans.',
   'Sensitive/restricted classifications are dated evidence, not a finding that an app violates policy. Verification or security assessment depends on audience, publication and data handling.',
   'Calendar and other unverified classifications remain unknown; consult the current consent configuration. No verification service is queried.',
   'No token identity, incremental consent, actual grants, service-account delegation, API-key/public access, response use or cross-file behavior is inferred.',
   'Dynamic routes, mutated clients, browser gapi, Apps Script, custom transports and unmodeled SDK methods are outside supported resolution.',
   'Potential excess and narrower-scope suggestions always have low confidence. Review unknown calls and runtime behavior before changing consent.',
   'Complete means bounded selected-file traversal and parsing, not complete application coverage.'
  ] }
 };
}
