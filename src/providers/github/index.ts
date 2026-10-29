import { readFileSync } from 'node:fs';
const raw: unknown = JSON.parse(readFileSync(new URL('../../../rules/github-oauth.json', import.meta.url), 'utf8'));
import type { Catalog, Rule } from '../../types.js';
export const catalog = raw as Catalog;
export function covers(grant: string, required: string, seen = new Set<string>()): boolean {
 if (grant === required) return true;
 if (seen.has(grant)) return false;
 seen.add(grant);
 return (catalog.implies[grant] ?? []).some(child => covers(child, required, seen));
}
export function normalizeScopes(scopes: string[]): string[] {
 const unique = [...new Set(scopes)].sort();
 return unique.filter(s => !unique.some(other => other !== s && covers(other, s)));
}
export function ruleFor(method: string, endpoint: string): Rule | undefined {
 return catalog.rules.find(r => r.method === method && r.endpoint === endpoint);
}
export function normalizeEndpoint(input: string, absolute = false): string | undefined {
 let pathname: string;
 try {
  if (absolute) {
   const url = new URL(input);
   if (url.protocol !== 'https:' || url.hostname !== 'api.github.com' || url.port || url.username || url.password) return undefined;
   pathname = url.pathname;
  } else {
   if (!input.startsWith('/') || input.startsWith('//')) return undefined;
   pathname = input.split(/[?#]/, 1)[0]!;
  }
 } catch { return undefined; }
 pathname = pathname.replace(/\/$/, '') || '/';
 for (const rule of catalog.rules) {
  const template = rule.endpoint.split('/');
  const parts = pathname.split('/');
  const wildcard = template.indexOf('{path}');
  if (wildcard < 0 && parts.length !== template.length) continue;
  if (wildcard >= 0 && parts.length <= wildcard) continue;
  if (template.every((part, i) => part === '{path}' || (part.startsWith('{') ? !!parts[i] : part === parts[i]))) return rule.endpoint;
 }
 // Never persist arbitrary URL segments, query parameters, identifiers or secrets.
 return pathname === '/graphql' ? '/graphql' : '/<unsupported>';
}
