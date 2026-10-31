export type Provider = 'github-oauth' | 'github-app' | 'google-oauth';
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
 source: 'fetch' | 'octokit-rest' | 'octokit-request' | 'octokit-graphql' | 'google-sdk';
 location: Location; confidence: Confidence; reason?: string; google?: GoogleOperationFacts;
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
 sensitivity?: ScopeSensitivity; suggestedScopes?: string[]; googleAlternatives?: GoogleAlternative[];
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
export type GoogleService = 'gmail' | 'drive' | 'calendar';
export type ScopeSensitivity = 'non_sensitive' | 'sensitive' | 'restricted' | 'unknown';
export interface GoogleOperationFacts {
 gmailFormat?: 'minimal' | 'full' | 'raw' | 'metadata' | 'unknown';
 gmailQuery?: 'present' | 'absent' | 'unknown';
 driveResponse?: 'metadata' | 'media' | 'unknown'; driveWrite?: 'metadata' | 'content' | 'unknown';
}
export type GoogleCondition = 'always' | 'gmail-metadata' | 'drive-metadata' | 'drive-metadata-write' | 'drive-file' | 'drive-appdata' |
 'calendar-owned' | 'calendar-app-created' | 'calendar-public' | 'calendar-availability' | 'unmodeled-context';
export interface GoogleAlternative { scopes: string[]; condition: GoogleCondition }
export interface GoogleScopeInfo { uri: string; service: GoogleService; sensitivity: ScopeSensitivity; docs: string[]; verified: string; classificationNote: string; sufficiency?: 'unmodeled' }
export interface GoogleRule {
 id: string; service: GoogleService; method: string; endpoint: string; sdk: string; alternatives: GoogleAlternative[];
 confidence: Confidence; rationale: string; docs: string[]; verified: string;
}
export interface GoogleCatalog {
 provider: 'google-oauth'; version: string; verified: string; discoveryRevisions: Record<GoogleService, string>; discoveryDocs: Record<GoogleService, string>;
 scopes: GoogleScopeInfo[]; narrower: Record<string, string[]>; rules: GoogleRule[];
}
export interface GoogleReport extends ReportBase {
 provider: 'google-oauth'; schemaVersion: '3.0.0'; declaredScopes: string[]; normalizedScopes: string[]; scopeAssessments: GoogleScopeInfo[];
}
export type Report = OAuthReport | AppReport | GoogleReport;
