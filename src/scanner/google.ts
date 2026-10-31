import ts from 'typescript';
import { googleCatalog, googleTarget } from '../providers/google/index.js';
import type { GoogleOperationFacts, GoogleService, Location, Operation } from '../types.js';
interface Context {
 source: ts.SourceFile; nodes: ts.Node[]; written: Set<ts.Symbol>;
 symbol: (n: ts.Node) => ts.Symbol | undefined;
 literal: (n: ts.Expression | undefined, depth?: number) => string | undefined;
 unbox: (n: ts.Expression) => ts.Expression; loc: (n: ts.Node) => Location;
}
interface Ref { kind: 'module' | 'root' | 'factory' | 'client'; service?: GoogleService; chain: string[]; custom: boolean }
const versions = { gmail: 'v1', drive: 'v3', calendar: 'v3' } as const;
const isService = (value: string): value is GoogleService => ['gmail', 'drive', 'calendar'].includes(value);
export function detectGoogle(ctx: Context): Operation[] {
 const { source, nodes, written, symbol, literal, unbox, loc } = ctx;
 const operations: Operation[] = [];
 function object(n: ts.Expression | undefined): Map<string, ts.Expression> | undefined {
  const values = new Map<string, ts.Expression>();
  if (!n) return values;
  n = unbox(n);
  if (!ts.isObjectLiteralExpression(n)) return undefined;
  for (const p of n.properties) {
   if (ts.isShorthandPropertyAssignment(p)) values.set(p.name.text, p.name);
   else if (ts.isPropertyAssignment(p) && !ts.isComputedPropertyName(p.name)) values.set(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : p.name.getText(source), p.initializer);
   else return undefined;
  }
  return values;
 }
 function module(pkg: string): Ref | undefined {
  if (pkg === 'googleapis') return { kind: 'module', chain: [], custom: false };
  const service = pkg.replace('@googleapis/', '');
  return pkg.startsWith('@googleapis/') && isService(service) ? { kind: 'module', service, chain: [], custom: false } : undefined;
 }
 function member(base: Ref | undefined, name: string | undefined): Ref | undefined {
  if (!base || !name) return undefined;
  if (base.kind === 'module') {
   if (base.service && name === base.service) return { ...base, kind: 'factory', chain: [] };
   if (!base.service && name === 'google') return { ...base, kind: 'root', chain: [] };
   return undefined;
  }
  if (base.kind === 'root' && base.chain.length === 0 && isService(name)) return { kind: 'factory', service: name, chain: [], custom: false };
  return { ...base, chain: [...base.chain, name] };
 }
 function isStringLike(n: ts.Expression | undefined, depth = 0): boolean {
  if (!n || depth > 8) return false;
  n = unbox(n);
  if (ts.isStringLiteralLike(n) || ts.isTemplateExpression(n) || (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken)) return true;
  if (ts.isIdentifier(n)) {
   const s = symbol(n), declaration = s?.valueDeclaration;
   if (declaration && ts.isVariableDeclaration(declaration) && (declaration.parent.flags & ts.NodeFlags.Const)) return isStringLike(declaration.initializer, depth + 1);
  }
  return false;
 }
 function ref(n: ts.Expression, depth = 0): Ref | undefined {
  if (depth > 12) return undefined;
  n = unbox(n);
  if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) {
   return member(ref(n.expression, depth + 1), ts.isPropertyAccessExpression(n) ? n.name.text : literal(n.argumentExpression));
  }
  if (ts.isCallExpression(n)) {
   if (ts.isIdentifier(n.expression) && n.expression.text === 'require' && !symbol(n.expression)) return module(literal(n.arguments[0]) ?? '');
   const factory = ref(n.expression, depth + 1);
   if (factory?.kind === 'factory' && factory.service && factory.chain.length === 0) {
    const options = object(n.arguments[0]);
    const version = literal(n.arguments[0]) ?? literal(options?.get('version'));
    const custom = version !== versions[factory.service] || n.arguments.length !== 1 ||
     (options ? [...options.keys()].some(k => !['version', 'auth'].includes(k)) || isStringLike(options.get('auth')) : literal(n.arguments[0]) === undefined);
    return { ...factory, kind: 'client', custom };
   }
  }
  if (!ts.isIdentifier(n)) return undefined;
  const s = symbol(n);
  if (!s || written.has(s)) return undefined;
  const d = s.declarations?.[0];
  if (d && (ts.isImportSpecifier(d) || ts.isNamespaceImport(d) || ts.isImportClause(d))) {
   const imp = ts.isImportSpecifier(d) ? d.parent.parent.parent : ts.isNamespaceImport(d) ? d.parent.parent : d.parent;
   if (!ts.isImportDeclaration(imp) || !ts.isStringLiteral(imp.moduleSpecifier)) return undefined;
   const clause = imp.importClause;
   if (clause?.isTypeOnly || (ts.isImportSpecifier(d) && d.isTypeOnly)) return undefined;
   const base = module(imp.moduleSpecifier.text);
   return ts.isImportSpecifier(d) ? member(base, (d.propertyName ?? d.name).text) : base;
  }
  if (d && ts.isVariableDeclaration(d) && d.initializer && (d.parent.flags & ts.NodeFlags.Const)) return ref(d.initializer, depth + 1);
  if (d && ts.isBindingElement(d) && ts.isObjectBindingPattern(d.parent) && ts.isVariableDeclaration(d.parent.parent)) {
   const variable = d.parent.parent;
   if (variable.initializer && (variable.parent.flags & ts.NodeFlags.Const)) return member(ref(variable.initializer, depth + 1), (d.propertyName ?? d.name).getText(source));
  }
  return undefined;
 }
 const globalOptions = nodes.some(n => {
  if (!ts.isCallExpression(n)) return false;
  const r = ref(n.expression);
  return r?.kind === 'root' && r.chain.join('.') === 'options';
 });
 function add(n: ts.CallExpression, sourceKind: 'fetch' | 'google-sdk', method: string, endpoint: string, facts: GoogleOperationFacts = {}, reason?: string) {
  operations.push({ provider: 'google-oauth', method, endpoint, source: sourceKind, location: loc(n), confidence: reason ? 'low' : 'high',
   ...(Object.keys(facts).length ? { google: facts } : {}), ...(reason ? { reason } : {}) });
 }
 function factsFor(service: GoogleService, params: Map<string, ts.Expression>): GoogleOperationFacts {
  const value = (key: string) => literal(params.get(key));
  if (service === 'gmail') {
   const format = value('format');
   return { gmailQuery: !params.has('q') ? 'absent' : isStringLike(params.get('q')) ? 'present' : 'unknown',
    gmailFormat: !params.has('format') ? 'full' : ['full', 'raw', 'minimal', 'metadata'].includes(format ?? '') ? format as NonNullable<GoogleOperationFacts['gmailFormat']> : 'unknown' };
  }
  if (service === 'drive') {
   const alt = value('alt');
   return { driveResponse: !params.has('alt') || alt === 'json' ? 'metadata' : alt === 'media' ? 'media' : 'unknown',
    driveWrite: !params.has('media') ? 'metadata' : ts.isObjectLiteralExpression(unbox(params.get('media')!)) ? 'content' : 'unknown' };
  }
  return {};
 }
 function urlFacts(service: GoogleService, url: URL): GoogleOperationFacts {
  const one = (key: string) => url.searchParams.getAll(key).length === 1 ? url.searchParams.get(key) : undefined;
  if (service === 'gmail') {
   const format = one('format');
   return { gmailQuery: url.searchParams.has('q') ? 'present' : 'absent',
    gmailFormat: !url.searchParams.has('format') ? 'full' : ['full', 'raw', 'minimal', 'metadata'].includes(format ?? '') ? format as NonNullable<GoogleOperationFacts['gmailFormat']> : 'unknown' };
  }
  if (service === 'drive') return { driveResponse: !url.searchParams.has('alt') || one('alt') === 'json' ? 'metadata' : one('alt') === 'media' ? 'media' : 'unknown', driveWrite: 'unknown' };
  return {};
 }
 for (const n of nodes) {
  if (!ts.isCallExpression(n)) continue;
  const callee = unbox(n.expression);
  if (ts.isIdentifier(callee) && callee.text === 'fetch' && !symbol(callee)) {
   const input = literal(n.arguments[0]);
   if (input === undefined) { add(n, 'fetch', 'UNKNOWN', '/<dynamic>', {}, 'Dynamic fetch target may belong to Google or another provider.'); continue; }
   const target = googleTarget(input);
   if (!target) continue;
   const options = object(n.arguments[1]);
   const method = !options ? undefined : options.has('method') ? literal(options.get('method'))?.toUpperCase() : 'GET';
   const facts = target.service && target.url ? urlFacts(target.service, target.url) : {};
   if (!method || !['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(method)) {
    add(n, 'fetch', 'UNKNOWN', target.endpoint, facts, 'HTTP method cannot be statically established.'); continue;
   }
   if (target.url?.searchParams.has('key')) {
    add(n, 'fetch', method, target.endpoint, facts, 'An API key is present; API-key/public authorization is outside this OAuth model.'); continue;
   }
   add(n, 'fetch', method, target.endpoint, facts, target.endpoint.includes('<unsupported>') ? 'Google endpoint is outside the supported catalog.' : undefined);
   continue;
  }
  const r = ref(callee);
  if (r?.kind !== 'client' || !r.service) continue;
  if (r.custom || globalOptions) {
   add(n, 'google-sdk', 'UNKNOWN', '/' + r.service + '/<custom-client>', {}, 'Google SDK version, API-key auth or global/custom request options cannot be safely resolved.'); continue;
  }
  const rule = googleCatalog.rules.find(item => item.service === r.service && item.sdk === r.chain.join('.'));
  if (!rule) {
   add(n, 'google-sdk', 'UNKNOWN', '/' + r.service + '/<unsupported>', {}, 'Google SDK method is outside the supported catalog.'); continue;
  }
  const params = object(n.arguments[0]), options = object(n.arguments[1]);
  if (!params || !options || n.arguments.length > 2 || [...options.keys()].some(k => !['headers','timeout','responseType'].includes(k))) {
   add(n, 'google-sdk', rule.method, rule.endpoint, {}, 'Google request parameters or overriding options cannot be safely resolved.'); continue;
  }
  if (params.has('key')) {
   add(n, 'google-sdk', rule.method, rule.endpoint, {}, 'An API key is present; API-key/public authorization is outside this OAuth model.'); continue;
  }
  add(n, 'google-sdk', rule.method, rule.endpoint, factsFor(r.service, params));
 }
 return operations.sort((a, b) => a.location.line - b.location.line || a.location.column - b.location.column);
}
