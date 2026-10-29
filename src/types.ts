export type Provider = 'github-oauth' | 'github-app';
export type Confidence = 'low' | 'medium' | 'high';
export type Severity = 'info' | 'low' | 'medium' | 'high';
export type Category = 'observed' | 'possibly_excessive' | 'insufficient' | 'unknown' | 'not_applicable';
export type PermissionLevel = 'read' | 'write';
export type PermissionDomain = 'repository' | 'organization' | 'account';
export type AppTokenType = 'installation' | 'user';
export interface PermissionRequirement { domain: PermissionDomain; name: string; level: PermissionLevel }
export interface Location { file: string; line: number; column: number }
export interface Operation {
 provider: Provider; method: string; endpoint: string;
 source: 'fetch' | 'octokit-rest' | 'octokit-request' | 'octokit-graphql';
 location: Location; confidence: Confidence; reason?: string;
}
export interface ScanNotice { code: string; message: string; location?: Location }
export interface ScanResult { operations: Operation[]; notices: ScanNotice[]; filesScanned: number; complete: boolean }
export interface Rule {
 id: string; method: string; endpoint: string; octokit: string[];
 alternatives: string[][]; condition: 'always' | 'repository-read';
 confidence: Confidence; rationale: string; docs: string[]; verified: string;
}
export interface AppRule {
 id: string; method: string; endpoint: string; octokit: string[];
 alternatives: PermissionRequirement[][]; condition: 'always' | 'repository-read' | 'organization-members' | 'content-write';
 tokenTypes: AppTokenType[]; confidence: Confidence; rationale: string; docs: string[]; verified: string;
}
export interface Catalog {
 version: string; provider: 'github-oauth'; verified: string;
 scopes: string[]; implies: Record<string, string[]>; rules: Rule[];
}
export interface AppCatalog {
 version: string; provider: 'github-app'; verified: string;
 permissions: Record<PermissionDomain, Record<string, PermissionLevel[]>>; rules: AppRule[];
}
export interface Finding {
 id: string; category: Category; severity: Severity; confidence: Confidence;
 message: string; scope?: string; operation?: Operation;
 ruleId?: string; alternatives?: string[][]; docs: string[];
 permission?: { domain: PermissionDomain; name: string };
 declaredLevel?: PermissionLevel | 'none'; requiredLevel?: PermissionLevel; suggestedLevel?: PermissionLevel;
 permissionAlternatives?: PermissionRequirement[][];
}
export interface ReportBase {
 toolVersion: string; catalogVersion: string;
 analysis: { filesScanned: number; complete: boolean; notices: ScanNotice[]; limitations: string[] };
 operations: Operation[]; findings: Finding[];
}
export interface OAuthReport extends ReportBase {
 schemaVersion: '1.0.0'; provider: 'github-oauth'; declaredScopes: string[]; normalizedScopes: string[];
}
export interface AppReport extends ReportBase {
 schemaVersion: '2.0.0'; provider: 'github-app'; tokenType: AppTokenType; declaredPermissions: PermissionRequirement[];
}
export type Report = OAuthReport | AppReport;
