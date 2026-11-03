export { configSchema, oauthConfigSchema, appConfigSchema, googleConfigSchema, loadConfig } from './config/index.js';
export { scanProject } from './scanner/index.js';
export { parseSource } from './scanner/ast.js';
export { evaluate, shouldFail } from './engine/index.js';
export { catalog, covers, normalizeScopes } from './providers/github/index.js';
export { render } from './reporters/index.js';
export type * from './types.js';
export { appCatalog, levelCovers } from './providers/github-app/index.js';
export type { Config, OAuthConfig, AppConfig, GoogleConfig } from './config/index.js';
export { googleCatalog } from './providers/google/index.js';

export { toSarif } from './reporters/sarif.js';
export type { SarifOptions } from './reporters/sarif.js';
export type { Format } from './reporters/index.js';

export { comparePermissions, shouldFailComparison, googleScopeCovers } from './compare/engine.js';
export { compareGit } from './compare/git.js';
export { renderComparison } from './compare/reporters.js';
export type * from './compare/types.js';
