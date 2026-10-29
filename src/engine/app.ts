import type { AppConfig } from '../config/index.js';
import type { AppReport, Finding, PermissionDomain, PermissionLevel, PermissionRequirement, ScanResult } from '../types.js';
import { appCatalog, levelCovers, permissionKey, permissionLabel } from '../providers/github-app/index.js';
import { findingId, VERSION } from './shared.js';

const docs = 'https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps';
export function evaluateApp(scan: ScanResult, config: AppConfig): AppReport {
 const findings: Finding[] = [];
 const declared: PermissionRequirement[] = [];
 for (const domain of ['repository', 'organization', 'account'] as PermissionDomain[]) {
  for (const [name, level] of Object.entries(config.declaredPermissions[domain]).sort(([a], [b]) => a.localeCompare(b))) {
   if (level !== undefined && Object.hasOwn(appCatalog.permissions[domain], name) && appCatalog.permissions[domain][name]?.includes(level)) declared.push({ domain, name, level });
  }
 }
 const grants = new Map(declared.map(p => [permissionKey(p), p.level]));
 const needs = new Map<string, PermissionLevel>();
 const add = (key: string, finding: Omit<Finding, 'id'>) => findings.push({ id: findingId('github-app:' + key), ...finding });
 for (const op of scan.operations) {
  const key = JSON.stringify([op.location, op.source, op.method, op.endpoint]);
  const rule = appCatalog.rules.find(r => r.method === op.method && r.endpoint === op.endpoint);
  if (!rule || op.reason) {
   add(key, { category: 'unknown', severity: 'info', confidence: 'low', operation: op,
    message: op.reason ?? 'No verified GitHub App permission rule covers this operation.', docs: [] });
   continue;
  }
  const evidence = { operation: op, ruleId: rule.id, permissionAlternatives: rule.alternatives, docs: rule.docs };
  if (!rule.tokenTypes.includes(config.tokenType)) {
   add(key, { ...evidence, category: 'insufficient', severity: 'high', confidence: 'high',
    message: 'This endpoint does not accept the configured installation token. A GitHub App user token is required; adding permissions to an installation token cannot fix this.' });
   continue;
  }
  if (rule.condition === 'organization-members') {
   add(key, { ...evidence, category: 'unknown', severity: 'info', confidence: 'low',
    message: rule.rationale + ' Public/private membership intent is unknown, so permission necessity cannot be established.' });
   continue;
  }
  if (rule.condition === 'repository-read' && config.repositoryVisibility === 'unknown') {
   add(key, { ...evidence, category: 'unknown', severity: 'info', confidence: 'low',
    message: 'Repository visibility is unknown. Public reads may require no permission; private reads use the documented permission alternatives.' });
   continue;
  }
  if ((rule.condition === 'repository-read' && config.repositoryVisibility === 'public') || rule.alternatives.some(a => a.length === 0)) {
   add(key, { ...evidence, category: 'not_applicable', severity: 'info', confidence: rule.condition === 'repository-read' ? 'medium' : 'high',
    message: 'This modeled public read does not establish a need for a declared GitHub App permission. Resource access restrictions may still apply.' });
   continue;
  }
  if (rule.alternatives.some(a => a.some(p => p.domain === 'repository' && p.name === 'metadata')) && !grants.has('repository.metadata')) {
   add(key, { ...evidence, category: 'unknown', severity: 'info', confidence: 'low',
    message: 'Metadata access may be implicit in the effective token. Its omission from this declaration is not treated as a denied permission; verify the effective grant.' });
   continue;
  }
  // Consider every documented alternative before suggesting write -> read, including alternatives missing another required permission.
  for (const p of rule.alternatives.flat()) {
   const name = permissionKey(p);
   if (p.level === 'write' || !needs.has(name)) needs.set(name, p.level);
  }
  const sufficient = rule.alternatives.some(a => a.every(p => levelCovers(grants.get(permissionKey(p)), p.level)));
  const confidence = rule.condition === 'repository-read' ? 'medium' : rule.confidence;
  const alternatives = rule.alternatives.map(a => a.map(permissionLabel).join(' AND ')).join(' OR ');
  if (rule.condition === 'content-write' && sufficient && !levelCovers(grants.get('repository.workflows'), 'write')) {
   add(key, { ...evidence, category: 'unknown', severity: 'info', confidence: 'low',
    message: rule.rationale + ' Contents write is covered, but applicability of additional Workflows write remains unknown. No extra permission is demanded without target-path evidence.' });
   continue;
  }
  if (sufficient) {
   add(key, { ...evidence, category: 'observed', severity: 'info', confidence,
    message: rule.rationale + ' The declaration covers: ' + alternatives + '. Token grants and resource access are not verified.' });
  } else {
   const common = (rule.alternatives[0] ?? []).filter(p => rule.alternatives.every(a => a.some(r => permissionKey(r) === permissionKey(p) && r.level === p.level)));
   const requirement = common.length === 1 ? common[0] : undefined;
   add(key, { ...evidence, category: 'insufficient', severity: op.method === 'GET' ? 'medium' : 'high', confidence,
    ...(requirement ? { permission: { domain: requirement.domain, name: requirement.name }, declaredLevel: grants.get(permissionKey(requirement)) ?? 'none', requiredLevel: requirement.level } : {}),
    message: rule.rationale + ' No documented alternative is covered. Required: ' + alternatives + '.' });
  }
 }
 for (const permission of declared) {
  const key = permissionKey(permission);
  const need = needs.get(key);
  if (permission.domain === 'repository' && permission.name === 'metadata' && permission.level === 'read') {
   if (!need) add('permission:' + key, { category: 'not_applicable', severity: 'info', confidence: 'medium', permission: { domain: permission.domain, name: permission.name }, declaredLevel: permission.level,
    message: 'Metadata read may be a platform baseline; it is not suggested for removal merely because no metadata operation was found.', docs: [docs] });
  } else if (!need) {
   add('permission:' + key, { category: 'possibly_excessive', severity: 'low', confidence: 'low', permission: { domain: permission.domain, name: permission.name }, declaredLevel: permission.level,
    message: 'No supported operation establishes a need for ' + permissionLabel(permission) + '. Review unknown calls, webhooks, other tokens and excluded code before reducing it.', docs: [docs] });
  } else if (permission.level === 'write' && need === 'read') {
   add('level:' + key, { category: 'possibly_excessive', severity: 'low', confidence: 'low', permission: { domain: permission.domain, name: permission.name }, declaredLevel: 'write', requiredLevel: 'read', suggestedLevel: 'read',
    message: 'Only read access to ' + key + ' is established by supported operations. Review remaining behavior before changing write to read.', docs: [docs] });
  }
 }
 for (const [index, notice] of scan.notices.entries()) add('notice:' + index + ':' + notice.code, {
  category: 'unknown', severity: 'info', confidence: 'low', message: notice.message, docs: []
 });
 findings.sort((a, b) => a.id.localeCompare(b.id));
 return {
  schemaVersion: '2.0.0', provider: 'github-app', tokenType: config.tokenType, toolVersion: VERSION, catalogVersion: appCatalog.version,
  declaredPermissions: declared, operations: scan.operations, findings,
  analysis: { filesScanned: scan.filesScanned, complete: scan.complete, notices: scan.notices, limitations: [
   'GitHub App permissions are separate from OAuth scopes, fine-grained PATs and GitHub Actions workflow permission declarations.',
   'Write covers read only for the same permission in the same domain; no cross-permission implication is inferred.',
   'All calls are compared with one declaration and configured token type. Actual credentials, installation repository selection and user access are not verified.',
   'Repository visibility applies to all modeled repository reads and is a user assertion. Metadata omission and organization membership intent can remain unknown.',
   'Intrafile static calls only; dynamic routes, GraphQL, exported clients, App factories and wrappers are not resolved.',
   'Webhook subscriptions can need permissions without API calls. Potential excess is always low-confidence manual review advice.',
   'Complete refers only to bounded traversal and parsing; it does not mean complete application behavior coverage.'
  ] }
 };
}
