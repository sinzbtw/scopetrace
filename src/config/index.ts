import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { appCatalog } from '../providers/github-app/index.js';
import type { PermissionDomain } from '../types.js';

const pattern = z.string().min(1).max(256).refine(p =>
 !p.includes('\\') && !p.startsWith('/') && !/^[A-Za-z]:/.test(p) &&
 !p.split('/').includes('..') && !/[\x00-\x1f]/.test(p),
 'Use relative forward-slash glob patterns without parent traversal');
const common = {
 include: z.array(pattern).min(1).max(100).default(['**/*.{js,jsx,ts,tsx}']),
 exclude: z.array(pattern).max(100).default(['**/*.test.*', '**/*.spec.*']),
 repositoryVisibility: z.enum(['unknown', 'public', 'private']).default('unknown'),
 limits: z.strictObject({
  maxFiles: z.number().int().min(1).max(10000).default(2000),
  maxFileBytes: z.number().int().min(1).max(2097152).default(524288),
  maxTotalBytes: z.number().int().min(1).max(104857600).default(20971520),
  maxEntries: z.number().int().min(1).max(200000).default(50000),
  maxDepth: z.number().int().min(1).max(64).default(32)
 }).default({ maxFiles: 2000, maxFileBytes: 524288, maxTotalBytes: 20971520, maxEntries: 50000, maxDepth: 32 })
};
const levels = z.enum(['read', 'write']);
function permissions(domain: PermissionDomain) {
 return z.unknown().superRefine((input, ctx) => {
  if (input !== null && typeof input === 'object' && Object.keys(input).some(name => !Object.hasOwn(appCatalog.permissions[domain], name))) {
   ctx.addIssue({ code: 'custom', message: 'Unsupported permission name for this domain.' });
  }
 }).pipe(z.partialRecord(z.enum(Object.keys(appCatalog.permissions[domain]) as [string, ...string[]]), levels)).superRefine((values, ctx) => {
  if (Object.keys(values).length > 100 || Object.entries(values).some(([name, level]) => level === undefined || !appCatalog.permissions[domain][name]?.includes(level))) {
   ctx.addIssue({ code: 'custom', message: 'Unsupported permission name or level for this domain.' });
  }
 }).default({});
}
export const oauthConfigSchema = z.strictObject({
 ...common, provider: z.literal('github-oauth'),
 declaredScopes: z.array(z.string().regex(/^[a-z][a-z0-9_:]*$/).max(80)).max(100)
});
export const appConfigSchema = z.strictObject({
 ...common, provider: z.literal('github-app'), tokenType: z.enum(['installation', 'user']),
 declaredPermissions: z.strictObject({ repository: permissions('repository'), organization: permissions('organization'), account: permissions('account') })
});
export const googleConfigSchema = z.strictObject({
 ...common, provider: z.literal('google-oauth'),
 declaredScopes: z.array(z.string().min(1).max(256).regex(/^(?:https:\/\/www\.googleapis\.com\/auth\/[a-zA-Z0-9._-]+|https:\/\/mail\.google\.com\/?|openid|email|profile)$/)).max(100),
 googleContext: z.strictObject({
  driveAccess: z.enum(['unknown', 'app-authorized', 'app-data']).default('unknown'),
  calendarResources: z.enum(['unknown', 'owned', 'app-created', 'public']).default('unknown'),
  calendarData: z.enum(['unknown', 'events', 'availability']).default('unknown')
 }).default({ driveAccess: 'unknown', calendarResources: 'unknown', calendarData: 'unknown' })
}).omit({ repositoryVisibility: true });
export const configSchema = z.discriminatedUnion('provider', [oauthConfigSchema, appConfigSchema, googleConfigSchema]);
export type OAuthConfig = z.infer<typeof oauthConfigSchema>;
export type AppConfig = z.infer<typeof appConfigSchema>;
export type GoogleConfig = z.infer<typeof googleConfigSchema>;
export type Config = OAuthConfig | AppConfig | GoogleConfig;
export const defaultConfig = { provider: 'github-oauth', declaredScopes: [],
 include: ['src/**/*.{js,jsx,ts,tsx}'], exclude: ['**/*.test.*', '**/*.spec.*'],
 repositoryVisibility: 'unknown' };
export const defaultAppConfig = { provider: 'github-app', tokenType: 'installation',
 declaredPermissions: { repository: { contents: 'read', issues: 'read', metadata: 'read' }, organization: {}, account: {} },
 include: ['src/**/*.{js,jsx,ts,tsx}'], exclude: ['**/*.test.*', '**/*.spec.*'], repositoryVisibility: 'unknown' };
export const defaultGoogleConfig = { provider: 'google-oauth', declaredScopes: [],
 include: ['src/**/*.{js,jsx,ts,tsx}'], exclude: ['**/*.test.*', '**/*.spec.*'],
 googleContext: { driveAccess: 'unknown', calendarResources: 'unknown', calendarData: 'unknown' } };
export function within(root: string, candidate: string): boolean {
 const rel = path.relative(root, candidate);
 return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
export async function loadConfig(root: string, filename = 'scopetrace.config.json'): Promise<Config> {
 const base = await realpath(root);
 const target = path.resolve(base, filename);
 if (!within(base, target) || path.extname(target).toLowerCase() !== '.json') throw new Error('Config must be a JSON file inside the project root.');
 const meta = await lstat(target);
 if (!meta.isFile() || meta.isSymbolicLink() || meta.size > 65536 || !within(base, await realpath(target))) throw new Error('Config must be a regular JSON file of at most 64 KiB inside the root.');
 let input: unknown;
 try { input = JSON.parse(await readFile(target, 'utf8')); } catch { throw new Error('Config is not valid JSON.'); }
 const parsed = configSchema.safeParse(input);
 if (!parsed.success) throw new Error('Invalid config: ' + parsed.error.issues.map(i => i.path.slice(0, 2).join('.') + ': ' + i.code).join('; '));
 return parsed.data;
}
