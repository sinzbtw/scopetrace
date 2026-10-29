# Architecture

Flow: CLI → strict JSON config → bounded walker → TypeScript AST → normalized operations → GitHub OAuth catalog → permission/evidence engine → reporter.

The runtime makes no network calls. TypeScript uses an in-memory compiler host without module resolution, project libraries or executable configuration. The checker supplies lexical symbol identity for aliases/shadowing. Only bounded const chains and supported constructors/imports are resolved. Mutated bindings are not trusted. Recognizable dynamic/overridden calls preserve uncertainty.

## Interfaces and modules

- types.ts: Location, Operation, Catalog, Rule, ScanResult, Finding and Report.
- config: strict Zod validation, defaults, JSON size and path boundary checks.
- scanner: fixed exclusions, sorted traversal, limits and symlink avoidance; AST recognition and sanitized notices.
- providers/github: trusted versioned JSON, endpoint normalization and transitive scope implication. AST recognition consumes catalog method mappings.
- engine: OR-of-AND scope alternatives, visibility conditions, category/severity/confidence and evidence construction.
- reporters: presentation only. JSON schema version is independent of tool/catalog version.
- cli: arguments, exclusive output creation and exit policy. Public library exports live in src/index.ts.

A future provider adds its model/catalog/adapter, extends the config/operation discriminator and matching registry, and supplies tests. GitHub Apps and PAT permissions need distinct models. The MVP has one explicit provider rather than dynamically loading code from scanned projects.

## Evidence and determinism

No snippets, user data or raw URLs are stored. Supported routes become catalog templates; unknown routes use fixed markers. Source paths are relative with forward slashes. Finding IDs derive from a SHA-256 hash of operation location/identity or a scope/notice key. Moving an operation can change its ID. Findings and operations are sorted; reports contain no wall-clock generation timestamp.

Observed means a modeled operation is covered by declarations. Not applicable means the modeled public read requires no scope. Insufficient means no documented alternative is covered. Potential excess always means low-confidence review advice. Unknown preserves unsupported behavior, visibility or parser/traversal failures.

## Boundaries

No interprocedural analysis, credential identity tracking, GraphQL analysis or response-field reasoning. Visibility is a global user assertion for modeled repository reads. Public-read rules cover public information.

Limits stop/skip work and mark traversal incomplete. A complete selected scan cannot prove full behavior coverage. Filesystem protections target stable untrusted trees, not a race-proof OS sandbox. See SECURITY.md.

Output uses exclusive open and never overwrites files. Explicit export is the only scan-related write. CLI errors omit raw parser/filesystem/JSON diagnostics.
