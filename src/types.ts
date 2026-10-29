export type Confidence = 'low' | 'medium' | 'high';
export type Severity = 'info' | 'low' | 'medium' | 'high';
export type Category = 'observed' | 'possibly_excessive' | 'insufficient' | 'unknown' | 'not_applicable';
export interface Location { file: string; line: number; column: number }
export interface Operation {
 provider: 'github-oauth'; method: string; endpoint: string;
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
export interface Catalog {
 version: string; provider: 'github-oauth'; verified: string;
 scopes: string[]; implies: Record<string, string[]>; rules: Rule[];
}
export interface Finding {
 id: string; category: Category; severity: Severity; confidence: Confidence;
 message: string; scope?: string; operation?: Operation;
 ruleId?: string; alternatives?: string[][]; docs: string[];
}
export interface Report {
 schemaVersion: '1.0.0'; toolVersion: string; provider: 'github-oauth'; catalogVersion: string;
 declaredScopes: string[]; normalizedScopes: string[];
 analysis: { filesScanned: number; complete: boolean; notices: ScanNotice[]; limitations: string[] };
 operations: Operation[]; findings: Finding[];
}
