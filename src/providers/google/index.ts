import { readFileSync } from 'node:fs';
import type { GoogleCatalog, GoogleService } from '../../types.js';
export const googleCatalog = JSON.parse(readFileSync(new URL('../../../rules/google-oauth.json', import.meta.url), 'utf8')) as GoogleCatalog;
export interface GoogleTarget { service?: GoogleService; endpoint: string; url?: URL }
const hosts: Record<string, GoogleService | 'shared'> = {
 'gmail.googleapis.com': 'gmail', 'drive.googleapis.com': 'drive', 'calendar.googleapis.com': 'calendar', 'www.googleapis.com': 'shared'
};
export function googleTarget(input: string): GoogleTarget | undefined {
 let url: URL;
 try { url = new URL(input); } catch { return undefined; }
 if (url.protocol !== 'https:' || !Object.hasOwn(hosts, url.hostname) || url.port || url.username || url.password) return undefined;
 const service = (['gmail', 'drive', 'calendar'] as GoogleService[]).find(s => url.pathname.startsWith('/' + s + '/'));
 if (!service || (hosts[url.hostname] !== 'shared' && hosts[url.hostname] !== service)) return { endpoint: '/<unsupported>' };
 // Match literal segments before parameters, preventing resources such as "messages/send" from becoming an arbitrary message ID.
 const candidates = [...googleCatalog.rules].sort((a, b) =>
  b.endpoint.split('/').filter(p => !p.startsWith('{')).length - a.endpoint.split('/').filter(p => !p.startsWith('{')).length);
 const parts = url.pathname.replace(/\/$/, '').split('/');
 const rule = candidates.find(r => {
  const template = r.endpoint.split('/');
  return r.service === service && template.length === parts.length && template.every((p, i) => p.startsWith('{') ? !!parts[i] : p === parts[i]);
 });
 return { service, endpoint: rule?.endpoint ?? '/' + service + '/<unsupported>', url };
}
