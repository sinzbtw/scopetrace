import { createHash } from 'node:crypto';
export const VERSION = '0.2.0';
export function findingId(key: string): string { return 'ST-' + createHash('sha256').update(key).digest('hex').slice(0, 16); }
