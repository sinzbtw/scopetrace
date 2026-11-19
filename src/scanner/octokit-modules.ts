import { posix } from 'node:path';

export type ClientKind = 'client' | 'custom' | 'modified';
export interface OctokitClient { kind: ClientKind }
export interface LocalImport { specifier: string; name: string }
export interface OctokitModule {
 exports: Map<string, OctokitClient>;
 writes: Set<LocalImport>;
 uses: Set<LocalImport>;
}
export type LinkedImports = Map<string, Map<string, ClientKind>>;

export const sourceExtension = /\.(?:js|jsx|ts|tsx)$/i;

export function isLocalSourceImport(specifier: string): boolean {
 return /^(?:\.\/|\.\.\/)/.test(specifier) && sourceExtension.test(specifier) &&
  !specifier.includes('//') && !/[\\:%?#\x00-\x1f]/.test(specifier);
}

export function uncertainOctokitClient(kind: 'custom' | 'modified') {
 return kind === 'custom'
  ? { endpoint: '/<custom-client>', reason: 'Custom Octokit transport or base URL is outside this analysis.' }
  : { endpoint: '/<custom-client>', reason: 'A statically visible write can modify this shared Octokit client.' };
}

export function linkOctokitModules(modules: Map<string, OctokitModule>, entries: Set<string>): Map<string, LinkedImports> {
 function resolve(file: string, binding: LocalImport): OctokitClient | undefined {
  const target = posix.join(posix.dirname(file), binding.specifier);
  if (target.startsWith('../') || target === file) return undefined;
  const candidates = [target];
  // TypeScript ESM often spells a .ts import with its emitted .js extension.
  if (/\.tsx?$/i.test(file) && target.endsWith('.js')) {
   const stem = target.slice(0, -3);
   if (entries.has((stem + '.jsx').toLowerCase())) return undefined;
   candidates.push(stem + '.ts', stem + '.tsx', stem + '.d.ts');
  }
  const present = candidates.filter(candidate => entries.has(candidate.toLowerCase()));
  return present.length === 1 ? modules.get(present[0]!)?.exports.get(binding.name) : undefined;
 }

 // Apply writes before emitting calls so the outcome is independent of file order.
 for (const [file, module] of modules) {
  for (const binding of module.writes) {
   const client = resolve(file, binding);
   if (client?.kind === 'client') client.kind = 'modified';
  }
 }
 const linked = new Map<string, LinkedImports>();
 for (const [file, module] of modules) {
  const imports: LinkedImports = new Map();
  for (const binding of module.uses) {
   const kind = resolve(file, binding)?.kind;
   if (!kind) continue;
   let bindings = imports.get(binding.specifier);
   if (!bindings) { bindings = new Map(); imports.set(binding.specifier, bindings); }
   bindings.set(binding.name, kind);
  }
  if (imports.size) linked.set(file, imports);
 }
 return linked;
}
