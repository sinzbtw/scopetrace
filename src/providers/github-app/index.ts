import { readFileSync } from 'node:fs';
import type { AppCatalog, PermissionLevel, PermissionRequirement } from '../../types.js';
export const appCatalog = JSON.parse(readFileSync(new URL('../../../rules/github-app.json', import.meta.url), 'utf8')) as AppCatalog;
export function levelCovers(granted: PermissionLevel | undefined, required: PermissionLevel): boolean {
 return granted === 'write' || granted === required;
}
export function permissionKey(p: Pick<PermissionRequirement, 'domain' | 'name'>): string { return p.domain + '.' + p.name; }
export function permissionLabel(p: PermissionRequirement): string { return permissionKey(p) + '=' + p.level; }
