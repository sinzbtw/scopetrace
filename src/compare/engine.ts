import { readFileSync } from 'node:fs';
import type { Config } from '../config/index.js';
import { catalog, covers } from '../providers/github/index.js';
import { googleCatalog } from '../providers/google/index.js';
import { findingId, VERSION } from '../engine/shared.js';
import type { Provider, Severity } from '../types.js';
import type { ChangeKind, ComparisonReport, DeclaredGrant, PermissionSnapshot, PrivilegeChange } from './types.js';
export const googleScopeRelations = JSON.parse(readFileSync(new URL('../../rules/google-scope-relations.json', import.meta.url), 'utf8')) as {
 version: string; verified: string; docs: string[]; implies: Record<string, string[]>;
};
const githubDocs = 'https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps';
const appDocs = 'https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps';
export function grantLabel(grant: DeclaredGrant): string {
 return grant.kind === 'scope' ? grant.scope : grant.domain + '.' + grant.name + '=' + grant.level;
}
const sorted = (grants: DeclaredGrant[]) => [...grants].sort((a, b) => grantLabel(a) < grantLabel(b) ? -1 : grantLabel(a) > grantLabel(b) ? 1 : 0);
export function googleScopeCovers(grant: string, required: string, seen = new Set<string>()): boolean {
 if (grant === required) return true;
 if (seen.has(grant)) return false;
 seen.add(grant);
 return (googleScopeRelations.implies[grant] ?? []).some(child => googleScopeCovers(child, required, new Set(seen)));
}
function snapshot(config: Config | null): PermissionSnapshot {
 if (!config) return { present: false, provider: null, grants: [], unrecognizedCount: 0, context: {} };
 if (config.provider === 'github-app') {
  const grants: DeclaredGrant[] = [];
  for (const domain of ['repository', 'organization', 'account'] as const) {
   for (const [name, level] of Object.entries(config.declaredPermissions[domain])) if (level) grants.push({ kind: 'permission', domain, name, level });
  }
  return { present: true, provider: config.provider, grants: sorted(grants), unrecognizedCount: 0, tokenType: config.tokenType, context: { repositoryVisibility: config.repositoryVisibility } };
 }
 const unique = [...new Set(config.declaredScopes)].sort();
 const grants: DeclaredGrant[] = [];
 let unrecognizedCount = 0;
 for (const scope of unique) {
  if (config.provider === 'github-oauth') {
   if (!catalog.scopes.includes(scope)) { unrecognizedCount++;continue; }
   grants.push({ kind: 'scope', scope, ...(scope === 'offline_access' ? { unmodeled: true as const } : {}) });
  } else {
   const info = googleCatalog.scopes.find(s => s.uri === scope);
   if (!info) { unrecognizedCount++;continue; }
   grants.push({ kind: 'scope', scope, sensitivity: info.sensitivity, sensitivityVerified: info.verified, ...(info.sufficiency === 'unmodeled' ? { unmodeled: true as const } : {}) });
  }
 }
 return { present: true, provider: config.provider, grants, unrecognizedCount, context: config.provider === 'google-oauth' ? { driveAccess: config.googleContext.driveAccess, calendarResources: config.googleContext.calendarResources, calendarData: config.googleContext.calendarData } : { repositoryVisibility: config.repositoryVisibility } };
}
function grantCovers(provider: Provider, broad: DeclaredGrant, narrow: DeclaredGrant): boolean {
 if (broad.kind === 'permission' && narrow.kind === 'permission') return broad.domain === narrow.domain && broad.name === narrow.name && (broad.level === narrow.level || broad.level === 'write');
 if (broad.kind !== 'scope' || narrow.kind !== 'scope') return false;
 return provider === 'github-oauth' ? covers(broad.scope, narrow.scope) : googleScopeCovers(broad.scope, narrow.scope);
}
function effective(provider: Provider, grants: DeclaredGrant[]): DeclaredGrant[] {
 const modeled = provider === 'github-app' ? grants.filter(g => !(g.kind === 'permission' && g.domain === 'repository' && g.name === 'metadata' && g.level === 'read')) : grants;
 return modeled.filter(grant => !modeled.some(other => other !== grant && grantCovers(provider, other, grant)));
}
function context(config: Config) {
 return { include: [...new Set(config.include)].sort(), exclude: [...new Set(config.exclude)].sort(), limits: { maxFiles: config.limits.maxFiles, maxFileBytes: config.limits.maxFileBytes, maxTotalBytes: config.limits.maxTotalBytes, maxEntries: config.limits.maxEntries, maxDepth: config.limits.maxDepth },
  ...(config.provider === 'google-oauth' ? { googleContext: { driveAccess: config.googleContext.driveAccess, calendarResources: config.googleContext.calendarResources, calendarData: config.googleContext.calendarData } } : { repositoryVisibility: config.repositoryVisibility }) };
}
export function comparePermissions(baseConfig: Config | null, headConfig: Config | null): ComparisonReport {
 if (!baseConfig && !headConfig) throw new Error('Neither Git snapshot contains a ScopeTrace configuration.');
 const base = snapshot(baseConfig), head = snapshot(headConfig);
 const provider = base.provider && head.provider && base.provider !== head.provider ? null : (head.provider ?? base.provider);
 const changes: PrivilegeChange[] = [];
 const notices: ComparisonReport['analysis']['notices'] = [];
 const docs = provider === 'github-app' ? [appDocs] : provider === 'github-oauth' ? [githubDocs] : googleScopeRelations.docs;
 const add = (kind: ChangeKind, before: DeclaredGrant[], after: DeclaredGrant[], message: string, uncertain = false) => {
  const confidence = uncertain ? 'low' : !base.present || !head.present ? 'medium' : 'high';
  const actualKind = uncertain ? 'unknown' : kind;
  const escalation = !uncertain && (kind === 'added' || kind === 'expanded');
  const sensitive = after.some(g => g.kind === 'scope' ? g.sensitivity === 'restricted' : g.level === 'write');
  const severity: Severity = uncertain ? 'info' : escalation ? (kind === 'expanded' || sensitive ? 'high' : 'medium') : 'info';
  const previous = sorted(before), current = sorted(after);
  changes.push({ id: findingId(JSON.stringify(['compare', provider, actualKind, previous, current, message])), kind: actualKind,
   before: previous, after: current, severity, confidence, escalation, message, docs });
 };
 const notice = (code: string, message: string) => {
  notices.push({ code, message });add('unknown', [], [], message, true);
 };
 const declarations = {
  added: head.grants.filter(g => !base.grants.some(b => grantLabel(b) === grantLabel(g))),
  removed: base.grants.filter(g => !head.grants.some(h => grantLabel(h) === grantLabel(g)))
 };
 const metadataChanged = provider === 'github-app' && [...declarations.added, ...declarations.removed].some(g => g.kind === 'permission' && g.domain === 'repository' && g.name === 'metadata' && g.level === 'read');
 if (metadataChanged) notice('metadata-baseline', 'Repository metadata read can be an implicit platform baseline. Its declaration change is not ranked as an access increase or reduction.');
 if (!base.present) notice('base-config-missing', 'The base configuration is absent. Additions are relative to this tracked declaration file, not proof that prior runtime grants were empty.');
 if (!head.present) notice('head-config-missing', 'The head configuration was removed. Declaration removals do not prove token revocation; authorization review coverage may have been disabled.');
 const unsupported = base.unrecognizedCount > 0 || head.unrecognizedCount > 0 || [...base.grants, ...head.grants].some(g => g.kind === 'scope' && g.unmodeled);
 if (unsupported) notice('unsupported-declarations', 'Unrecognized or unmodeled declarations prevent a complete privilege comparison. Unrecognized scope values are omitted.');
 const modelChanged = provider === null || (baseConfig?.provider === 'github-app' && headConfig?.provider === 'github-app' && baseConfig.tokenType !== headConfig.tokenType);
 if (modelChanged) notice('authorization-model-changed', 'The provider or GitHub App token kind changed. These authorization models cannot be ordered as an access increase or decrease. Review both declarations.');
 if (baseConfig && headConfig && JSON.stringify(context(baseConfig)) !== JSON.stringify(context(headConfig))) {
  const a = context(baseConfig), b = context(headConfig);
  const fields = Object.keys({ ...a, ...b }).filter(key => JSON.stringify(a[key as keyof typeof a]) !== JSON.stringify(b[key as keyof typeof b]));
  notice('analysis-context-changed', 'Changed context fields: ' + fields.join(', ') + '. Effects on actual access or source coverage are not inferred.');
 }
 if (provider && !modelChanged) {
  const before = effective(provider, base.grants), after = effective(provider, head.grants);
  for (const next of after) {
   if (before.some(old => grantCovers(provider, old, next))) continue;
   const narrower = before.filter(old => grantCovers(provider, next, old));
   add(narrower.length ? 'expanded' : 'added', narrower, [next], unsupported ?
    'A recognized declaration changed, but unsupported declarations prevent a firm conclusion about its net privilege increase.' :
    narrower.length ? 'A broader declared grant now covers previously narrower privileges. Review the access increase before approving.' :
    'A declared privilege is new within the documented comparison model. Review the access increase; effective token grants are not checked.', unsupported);
  }
  for (const old of before) {
   if (after.some(next => grantCovers(provider, next, old))) continue;
   const narrower = after.filter(next => grantCovers(provider, old, next));
   add(narrower.length ? 'reduced' : 'removed', [old], narrower, unsupported ?
    'A recognized declaration changed, but unsupported declarations prevent a firm conclusion about its net privilege reduction.' :
    narrower.length ? 'A broader declaration was replaced by narrower documented privileges. This does not prove existing tokens were narrowed.' :
    'This declared privilege is no longer present or covered by a documented broader grant. This does not prove consent or token revocation.', unsupported);
  }
  if (!changes.some(c => c.kind !== 'unknown') && !unsupported && !metadataChanged && (declarations.added.length || declarations.removed.length)) {
   const unchanged = before.every(b => after.some(h => grantCovers(provider, h, b))) && after.every(h => before.some(b => grantCovers(provider, b, h)));
   if (unchanged) add('equivalent', declarations.removed, declarations.added, 'Only redundant declarations changed. Documented modeled privileges are equivalent.');
  }
 }
 changes.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
 const summary: ComparisonReport['summary'] = { added: 0, expanded: 0, reduced: 0, removed: 0, equivalent: 0, unknown: 0, escalations: 0 };
 for (const change of changes) { summary[change.kind]++;if (change.escalation) summary.escalations++; }
 return { kind: 'permission-diff', schemaVersion: '1.0.0', toolVersion: VERSION, provider,
  relationVersions: { github: catalog.version, google: googleScopeRelations.version }, base, head, declarations, changes, summary,
  analysis: { complete: notices.length === 0, notices, limitations: [
   'Only the selected committed ScopeTrace JSON declarations are compared; code, arbitrary OAuth strings and provider manifests are not scanned by compare.',
   'These are declared privileges, not actual token grants, user consent, installation selection or runtime authorization. Removal is not revocation.',
   'GitHub OAuth uses the documented catalog hierarchy. Google uses selected explicit scope relations, never URI prefixes or operation-specific narrowing suggestions.',
   'Drive app-data/file and Calendar app-created/resource-specific scopes are not presumed equivalent to broader global access. Incomparable replacements may add and remove privileges simultaneously.',
   'Google sensitivity is dated metadata, separate from access confidence; unknown sensitivity does not mean non-sensitive or establish verification obligations.',
   'Unknown models/scopes and missing configurations require review. Use the separate fail-on-unknown comparison gate for a conservative PR policy.'
  ] }
 };
}
export function shouldFailComparison(report: ComparisonReport, threshold?: Severity, failOnUnknown = false): boolean {
 if (failOnUnknown && !report.analysis.complete) return true;
 const order: Severity[] = ['info', 'low', 'medium', 'high'];
 return !!threshold && report.changes.some(c => c.escalation && c.confidence !== 'low' && order.indexOf(c.severity) >= order.indexOf(threshold));
}
