import ts from 'typescript';
import { detectGoogle } from './google.js';
import { operationRules, normalizeEndpoint } from '../providers/github/index.js';
import type { Operation, Provider, ScanNotice } from '../types.js';
import { isLocalSourceImport, uncertainOctokitClient } from './octokit-modules.js';
import type { LinkedImports, LocalImport, OctokitClient, OctokitModule } from './octokit-modules.js';

const octokitPackages = new Set(['octokit', '@octokit/rest', '@octokit/core']);
type Ref = { chain: string[] } & (
 { kind: 'ctor' | 'module' } |
 { kind: 'client' | 'custom'; origin: ts.NewExpression } |
 { kind: 'import'; binding: LocalImport }
);
interface ParsedSource { operations: Operation[]; notices: ScanNotice[] }
interface ModuleAnalysis { module?: OctokitModule; linkedImports?: LinkedImports }

export function parseSource(text: string, file: string, provider: Provider = 'github-oauth'): ParsedSource {
 return analyzeSource(text, file, provider);
}

export function analyzeSource(text: string, file: string, provider: Provider, { module, linkedImports }: ModuleAnalysis = {}): ParsedSource {
 const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
 // No module resolution, library reads, tsconfig loading or project code execution.
 const host: ts.CompilerHost = {
  getSourceFile: name => name === file ? source : undefined, getDefaultLibFileName: () => '',
  writeFile: () => {}, getCurrentDirectory: () => '', getDirectories: () => [],
  fileExists: name => name === file, readFile: () => undefined,
  getCanonicalFileName: name => name, useCaseSensitiveFileNames: () => true, getNewLine: () => '\n'
 };
 const program = ts.createProgram([file], { noLib: true, noResolve: true, allowJs: true, jsx: ts.JsxEmit.Preserve }, host);
 const checker = program.getTypeChecker();
 const operations: Operation[] = [];
 const notices: ScanNotice[] = [];
 const loc = (node: ts.Node) => {
  const p = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { file: file.replaceAll('\\', '/'), line: p.line + 1, column: p.character + 1 };
 };
 if (program.getSyntacticDiagnostics(source).length) return { operations, notices: [{
  code: 'syntax-error', message: 'File has unsupported or invalid syntax; its contents were not analyzed.', location: { file, line: 1, column: 1 }
 }] };
 // An iterative walk bounds JS call-stack usage even for deeply nested untrusted syntax.
 const nodes: ts.Node[] = [];
 const pending: ts.Node[] = [source];
 while (pending.length) { const n = pending.pop()!; nodes.push(n); ts.forEachChild(n, child => { pending.push(child); }); }
 const symbol = (n: ts.Node) => ts.isIdentifier(n) && ts.isShorthandPropertyAssignment(n.parent) ? checker.getShorthandAssignmentValueSymbol(n.parent) : checker.getSymbolAtLocation(n);
 const written = new Set<ts.Symbol>();
 const writeRoots = new Map<ts.Symbol, ts.Identifier>();
 for (const n of nodes) {
  let target: ts.Expression | undefined;
  if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) target = n.left;
  if (ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) {
   if (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken) target = n.operand;
  }
  const deleting = !!module && ts.isDeleteExpression(n);
  if (deleting) target = n.expression;
  if (!target) continue;
  let binding = unbox(target);
  while (ts.isPropertyAccessExpression(binding) || ts.isElementAccessExpression(binding)) binding = unbox(binding.expression);
  const s = symbol(binding);
  if (!s) continue;
  if (!deleting) written.add(s);
  if (module && ts.isIdentifier(binding)) writeRoots.set(s, binding);
 }
 function unbox(n: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) || ts.isSatisfiesExpression(n)) n = n.expression;
  return n;
 }
 function literal(n: ts.Expression | undefined, depth = 0): string | undefined {
  if (!n || depth > 8) return undefined;
  n = unbox(n);
  if (ts.isStringLiteralLike(n)) return n.text;
  if (ts.isIdentifier(n)) {
   const s = symbol(n);
   if (!s || written.has(s)) return undefined;
   const d = s.valueDeclaration;
   if (d && ts.isVariableDeclaration(d) && (d.parent.flags & ts.NodeFlags.Const)) return literal(d.initializer, depth + 1);
  }
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
   const a = literal(n.left, depth + 1), b = literal(n.right, depth + 1);
   if (a !== undefined && b !== undefined && a.length + b.length < 8192) return a + b;
  }
  return undefined;
 }
 function property(n: ts.Expression | undefined, key: string): ts.Expression | undefined {
  if (!n) return undefined;
  n = unbox(n);
  if (!ts.isObjectLiteralExpression(n)) return undefined;
  for (let i = n.properties.length - 1; i >= 0; i--) {
   const p = n.properties[i]!;
   if (ts.isSpreadAssignment(p) || ts.isShorthandPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p)) return undefined;
   if (ts.isPropertyAssignment(p)) {
    if (ts.isComputedPropertyName(p.name)) return undefined;
    if (propertyName(p.name) === key) return p.initializer;
   }
  }
  return undefined;
 }
 function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
 }
 function safeOptions(n: ts.Expression | undefined): boolean {
  if (!n) return true;
  n = unbox(n);
  return ts.isObjectLiteralExpression(n) && n.properties.every(p =>
   ts.isPropertyAssignment(p) && !ts.isComputedPropertyName(p.name) &&
   !['baseUrl', 'request', '__proto__'].includes(propertyName(p.name) ?? ''));
 }
 const localImports = new Map<ts.ImportSpecifier, LocalImport>();
 function ref(n: ts.Expression, depth = 0, ignoreWrites = false): Ref | undefined {
  if (depth > 10) return undefined;
  n = unbox(n);
  if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) {
   const base = ref(n.expression, depth + 1, ignoreWrites);
   const name = ts.isPropertyAccessExpression(n) ? n.name.text : literal(n.argumentExpression);
   if (!base || !name) return undefined;
   if (base.kind === 'module' && name === 'Octokit') return { kind: 'ctor', chain: [] };
   return { ...base, chain: [...base.chain, name] };
  }
  if (ts.isNewExpression(n)) {
   const ctor = ref(n.expression, depth + 1, ignoreWrites);
   if (ctor?.kind === 'ctor' && ctor.chain.length === 0) return { kind: safeOptions(n.arguments?.[0]) ? 'client' : 'custom', origin: n, chain: [] };
  }
  if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'require' && !symbol(n.expression)) {
   const pkg = literal(n.arguments[0]);
   if (pkg && octokitPackages.has(pkg)) return { kind: 'module', chain: [] };
  }
  if (ts.isIdentifier(n)) {
   const s = symbol(n);
   if (!s || (!ignoreWrites && written.has(s))) return undefined;
   const decl = s.declarations?.[0];
   if (decl && (ts.isImportSpecifier(decl) || ts.isNamespaceImport(decl))) {
    const imp = ts.isImportSpecifier(decl) ? decl.parent.parent.parent : decl.parent.parent;
    if (ts.isImportDeclaration(imp) && ts.isStringLiteral(imp.moduleSpecifier) && !imp.importClause?.isTypeOnly) {
     const specifier = imp.moduleSpecifier.text;
     if (ts.isNamespaceImport(decl)) return octokitPackages.has(specifier) ? { kind: 'module', chain: [] } : undefined;
     if (decl.isTypeOnly) return undefined;
     const name = (decl.propertyName ?? decl.name).text;
     if (octokitPackages.has(specifier) && name === 'Octokit') return { kind: 'ctor', chain: [] };
     if ((module || linkedImports) && !imp.attributes && isLocalSourceImport(specifier)) {
      let binding = localImports.get(decl);
      if (!binding) { binding = { specifier, name }; localImports.set(decl, binding); }
      return { kind: 'import', binding, chain: [] };
     }
    }
   }
   if (decl && ts.isVariableDeclaration(decl) && decl.initializer && (decl.parent.flags & ts.NodeFlags.Const)) return ref(decl.initializer, depth + 1, ignoreWrites);
   if (decl && ts.isBindingElement(decl) && ts.isObjectBindingPattern(decl.parent) && ts.isVariableDeclaration(decl.parent.parent)) {
    const variable = decl.parent.parent;
    if ((variable.parent.flags & ts.NodeFlags.Const) && variable.initializer && (decl.propertyName ?? decl.name).getText(source) === 'Octokit') {
     const base = ref(variable.initializer, depth + 1, ignoreWrites);
     if (base?.kind === 'module') return { kind: 'ctor', chain: [] };
    }
   }
  }
  return undefined;
 }
 function add(n: ts.CallExpression, from: Operation['source'], method: string, endpoint: string, reason?: string) {
  operations.push({ provider, method, endpoint, source: from, location: loc(n),
   confidence: reason ? 'low' : 'high', ...(reason ? { reason } : {}) });
 }
 if (provider === 'google-oauth') return { operations: detectGoogle({ source, nodes, written, symbol, literal, unbox, loc }), notices };
 if (module) {
  const modified = new Set<ts.NewExpression>();
  for (const name of writeRoots.values()) {
   const r = ref(name, 0, true);
   if (r?.kind === 'import') module.writes.add(r.binding);
   if (r?.kind === 'client' || r?.kind === 'custom') modified.add(r.origin);
  }
  const clients = new Map<ts.NewExpression, OctokitClient>();
  for (const statement of source.statements) {
   if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const) ||
       !statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
   for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name)) continue;
    const active = ref(declaration.name);
    const r = active ?? ref(declaration.name, 0, true);
    if ((r?.kind !== 'client' && r?.kind !== 'custom') || r.chain.length) continue;
    const isModified = modified.has(r.origin);
    if (!isModified && !active) continue;
    let client = clients.get(r.origin);
    if (!client) {
     client = { kind: isModified && r.kind === 'client' ? 'modified' : r.kind };
     clients.set(r.origin, client);
    }
    module.exports.set(declaration.name.text, client);
   }
  }
 }
 for (const n of nodes) {
  if (!ts.isCallExpression(n)) continue;
  const callee = unbox(n.expression);
  const isFetch = ts.isIdentifier(callee) && callee.text === 'fetch' && !symbol(callee);
  if (isFetch) {
   if (linkedImports) continue;
   const url = literal(n.arguments[0]);
   if (url === undefined) { add(n, 'fetch', 'UNKNOWN', '/<dynamic>', 'Dynamic fetch target may be GitHub or another provider.'); continue; }
   const endpoint = normalizeEndpoint(url, true, provider);
   if (!endpoint) continue;
   let method: string | undefined = 'GET';
   if (n.arguments[1]) {
    const options = unbox(n.arguments[1]);
    if (!ts.isObjectLiteralExpression(options) || options.properties.some(p => !ts.isPropertyAssignment(p) || ts.isComputedPropertyName(p.name))) method = undefined;
    else {
     const m = property(options, 'method');
     method = m ? literal(m)?.toUpperCase() : 'GET';
    }
   }
   if (!method || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method)) {
    add(n, 'fetch', 'UNKNOWN', endpoint, 'HTTP method cannot be statically established.');
   } else add(n, 'fetch', method, endpoint, endpoint === '/<unsupported>' || endpoint === '/graphql' ? 'Endpoint is outside the supported REST catalog.' : undefined);
   continue;
  }
  const active = ref(callee);
  const r = active ?? ((module?.writes.size || (linkedImports && written.size)) ? ref(callee, 0, true) : undefined);
  if (!r || r.kind === 'ctor' || r.kind === 'module') continue;
  let kind;
  if (r.kind === 'import') {
   module?.uses.add(r.binding);
   kind = linkedImports?.get(r.binding.specifier)?.get(r.binding.name);
   if (!kind || (!active && kind === 'client')) continue;
  } else {
   if (!active || linkedImports) continue;
   kind = r.kind;
  }
  const chain = r.chain.join('.');
  if (kind !== 'client') {
   const { endpoint, reason } = uncertainOctokitClient(kind);
   add(n, 'octokit-request', 'UNKNOWN', endpoint, reason);
   continue;
  }
  if (chain === 'graphql') { add(n, 'octokit-graphql', 'UNKNOWN', '/graphql', 'GraphQL operation analysis is not supported.'); continue; }
  if (chain === 'request') {
   const route = literal(n.arguments[0]);
   if (!route) { add(n, 'octokit-request', 'UNKNOWN', '/<dynamic>', 'Octokit route is dynamic or uses unsupported object form.'); continue; }
   const match = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (\/[^\s]*)$/.exec(route);
   // Options may override method/url/baseUrl; never infer a route through these overrides.
   if (!safeOptions(n.arguments[1]) || ['method', 'url'].some(k => property(n.arguments[1], k))) {
    add(n, 'octokit-request', 'UNKNOWN', '/<dynamic>', 'Octokit request options can override the route.'); continue;
   }
   const endpoint = match ? normalizeEndpoint(match[2]!, false, provider) : undefined;
   if (!match || !endpoint) add(n, 'octokit-request', 'UNKNOWN', '/<dynamic>', 'Octokit route is outside the supported request syntax.');
   else add(n, 'octokit-request', match[1]!, endpoint, endpoint === '/<unsupported>' ? 'Endpoint is outside the supported REST catalog.' : undefined);
   continue;
  }
  const rule = operationRules(provider).find(item => item.octokit.includes(chain.replace(/^rest\./, '')));
  if (rule && safeOptions(n.arguments[0]) && !['method', 'url'].some(k => property(n.arguments[0], k))) add(n, 'octokit-rest', rule.method, rule.endpoint);
  else add(n, 'octokit-rest', 'UNKNOWN', '/<unsupported>', 'Octokit method or overriding options are outside the supported catalog.');
 }
 operations.sort((a, b) => a.location.line - b.location.line || a.location.column - b.location.column);
 return { operations, notices };
}
