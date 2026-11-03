import type { AppTokenType, Confidence, PermissionDomain, PermissionLevel, Provider, ScopeSensitivity, Severity } from '../types.js';
export type DeclaredGrant = { kind: 'scope'; scope: string; sensitivity?: ScopeSensitivity; sensitivityVerified?: string; unmodeled?: true } |
 { kind: 'permission'; domain: PermissionDomain; name: string; level: PermissionLevel };
export type ChangeKind = 'added' | 'expanded' | 'reduced' | 'removed' | 'equivalent' | 'unknown';
export interface PrivilegeChange {
 id: string; kind: ChangeKind; before: DeclaredGrant[]; after: DeclaredGrant[];
 severity: Severity; confidence: Confidence; escalation: boolean; message: string; docs: string[];
}
export interface PermissionSnapshot {
 present: boolean; provider: Provider | null; grants: DeclaredGrant[]; unrecognizedCount: number; tokenType?: AppTokenType;
 context: { repositoryVisibility?: 'unknown' | 'public' | 'private'; driveAccess?: 'unknown' | 'app-authorized' | 'app-data';
  calendarResources?: 'unknown' | 'owned' | 'app-created' | 'public'; calendarData?: 'unknown' | 'events' | 'availability' };
}
export interface ComparisonReport {
 kind: 'permission-diff'; schemaVersion: '1.0.0'; toolVersion: string; provider: Provider | null;
 relationVersions: { github: string; google: string };
 base: PermissionSnapshot; head: PermissionSnapshot;
 declarations: { added: DeclaredGrant[]; removed: DeclaredGrant[] };
 changes: PrivilegeChange[];
 summary: Record<ChangeKind | 'escalations', number>;
 analysis: { complete: boolean; notices: { code: string; message: string }[]; limitations: string[] };
 source?: { mode: 'direct' | 'merge-base'; requestedBaseCommit: string; baseCommit: string; headCommit: string; configPath: string; pullRequest?: number };
}
export interface CompareGitOptions { base: string; head?: string; pullRequest?: number; mergeBase?: boolean; config?: string }
export type ComparisonFormat = 'text' | 'json' | 'markdown';
