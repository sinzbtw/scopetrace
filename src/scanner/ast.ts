import ts from 'typescript';
import { operationRules, normalizeEndpoint } from '../providers/github/index.js';
import type { Operation, Provider, ScanNotice } from '../types.js';

const octokitPackages = new Set(['octokit', '@octokit/rest', '@octokit/core']);
type Ref = { kind: 'ctor' | 'module' | 'client' | 'custom'; chain: string[] };
export function parseSource(text: string, file: string, provider: Provider = 'github-oauth'): { operations: Operation[]; notices: ScanNotice[] } {
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
 const symbol = (n: ts.Node) => checker.getSymbolAtLocation(n);
 const written = new Set<ts.Symbol>();
 const root = (n: ts.Expression): ts.Expression => ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n) ? root(n.expression) : n;
 for (const n of nodes) {
  let target: ts.Expression | undefined;
  if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) target = n.left;
  if (ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) {
   if (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken) target = n.operand;
  }
  if (target) { const s = symbol(root(target)); if (s) written.add(s); }
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
    if (p.name.getText(source).replace(/^['"]|['"]$/g, '') === key) return p.initializer;
   }
  }
  return undefined;
 }
 function safeOptions(n: ts.Expression | undefined): boolean {
  if (!n) return true;
  n = unbox(n);
  return ts.isObjectLiteralExpression(n) && n.properties.every(p =>
   ts.isPropertyAssignment(p) && !ts.isComputedPropertyName(p.name) &&
   !['baseUrl', 'request'].includes(p.name.getText(source).replace(/^['"]|['"]$/g, '')));
 }
 function ref(n: ts.Expression, depth = 0): Ref | undefined {
  if (depth > 10) return undefined;
  n = unbox(n);
  if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) {
   const base = ref(n.expression, depth + 1);
   const name = ts.isPropertyAccessExpression(n) ? n.name.text : literal(n.argumentExpression);
   if (!base || !name) return undefined;
   if (base.kind === 'module' && name === 'Octokit') return { kind: 'ctor', chain: [] };
   return { ...base, chain: [...base.chain, name] };
  }
  if (ts.isNewExpression(n)) {
   const ctor = ref(n.expression, depth + 1);
   if (ctor?.kind === 'ctor' && ctor.chain.length === 0) return { kind: safeOptions(n.arguments?.[0]) ? 'client' : 'custom', chain: [] };
  }
  if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'require' && !symbol(n.expression)) {
   const pkg = literal(n.arguments[0]);
   if (pkg && octokitPackages.has(pkg)) return { kind: 'module', chain: [] };
  }
  if (ts.isIdentifier(n)) {
   const s = symbol(n);
   if (!s || written.has(s)) return undefined;
   const decl = s.declarations?.[0];
   if (decl && (ts.isImportSpecifier(decl) || ts.isNamespaceImport(decl))) {
    const imp = ts.isImportSpecifier(decl) ? decl.parent.parent.parent : decl.parent.parent;
    if (ts.isImportDeclaration(imp) && ts.isStringLiteral(imp.moduleSpecifier) && octokitPackages.has(imp.moduleSpecifier.text)) {
     if (ts.isNamespaceImport(decl)) return { kind: 'module', chain: [] };
     if (!decl.isTypeOnly && !decl.parent.parent.isTypeOnly && (decl.propertyName ?? decl.name).text === 'Octokit') return { kind: 'ctor', chain: [] };
    }
   }
   if (decl && ts.isVariableDeclaration(decl) && decl.initializer && (decl.parent.flags & ts.NodeFlags.Const)) return ref(decl.initializer, depth + 1);
   if (decl && ts.isBindingElement(decl) && ts.isObjectBindingPattern(decl.parent) && ts.isVariableDeclaration(decl.parent.parent)) {
    const variable = decl.parent.parent;
    if ((variable.parent.flags & ts.NodeFlags.Const) && variable.initializer && (decl.propertyName ?? decl.name).getText(source) === 'Octokit') {
     const base = ref(variable.initializer, depth + 1);
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
 for (const n of nodes) {
  if (!ts.isCallExpression(n)) continue;
  const callee = unbox(n.expression);
  const isFetch = ts.isIdentifier(callee) && callee.text === 'fetch' && !symbol(callee);
  if (isFetch) {
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
  const r = ref(callee);
  if (!r || !['client', 'custom'].includes(r.kind)) continue;
  const chain = r.chain.join('.');
  if (r.kind === 'custom') { add(n, 'octokit-request', 'UNKNOWN', '/<custom-client>', 'Custom Octokit transport or base URL is outside this analysis.'); continue; }
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
