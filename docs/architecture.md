# Architecture

Flow: CLI → strict discriminated JSON config → bounded walker → TypeScript AST → provider-specific normalized operations → provider catalog → permission/evidence engine → reporter.

## Independent authorization models

Config selects github-oauth, github-app or google-oauth. OAuth accepts declaredScopes; Apps accept domain-separated declaredPermissions and explicit tokenType. They cannot be combined in one config. No scope-to-permission conversion is performed.

Scanner recognition uses operationRules(provider), consuming the selected catalog's endpoint and Octokit mappings. Every operation carries its selected provider. The engine dispatcher rejects provider mismatches, then delegates to engine/oauth.ts, engine/app.ts or engine/google.ts.

The OAuth engine retains its scope implication logic and schemaVersion 1.0.0 reports. The App engine compares read/write levels within a domain/name, checks token kinds, evaluates OR-of-AND alternatives and uses schemaVersion 2.0.0 reports. Both attach source evidence and preserve uncertainty. Shared IDs/version live in engine/shared.ts; formatting remains separate.

## Modules

- types.ts: provider, operation, catalog, permission requirement, findings and discriminated report contracts.
- config: strict Zod schemas, domain/key/level validation, limits, JSON size and path checks. Invalid permission names are not echoed.
- scanner: bounded sorted traversal, fixed secret/dependency exclusions and symlink avoidance. TypeScript uses an in-memory host without module resolution or project execution. Lexical symbols distinguish imported aliases from shadowed names.
- providers/github and providers/github-app: separate trusted JSON data and scope/level helpers.
- engine: model dispatch, permission evaluation, stable IDs and confidence-aware CI thresholds.
- reporters: terminal, Markdown and model-specific JSON.
- cli: arguments, provider-selectable init/rules, config-driven scan and exclusive output creation.

## Evidence and uncertainty

No snippets, raw URLs, request bodies, headers or tokens are stored. Paths are relative with forward slashes; unknown endpoints use fixed markers. Findings are sorted and IDs hash provider/location/operation identity or scope/permission/notice keys. Moving a call can change its ID.

Potential excess is low-confidence advice. Public reads, unknown visibility, token-kind mismatch, implicit metadata and conditional content/workflow rights are handled explicitly. Installation/user access, webhook needs and global minimum grants cannot be proven from static calls.

## Extension and boundaries

Add a distinct catalog, config discriminator and engine for another authorization model. Add mappings and official evidence to data rather than AST permission logic. Never dynamically load provider code from a scanned project.

No interprocedural analysis, token tracking or GraphQL analysis. All calls use one declared model per scan. Traversal completeness is not whole-application completeness. Filesystem protections assume a stable untrusted checkout; they are not an OS sandbox against concurrent mutation. Output files use exclusive open; explicit export is the only scan-related write.

## Google OAuth

The AST scanner dispatches the Google model to scanner/google.ts while sharing the in-memory compiler, symbol identities and mutation/literal checks. Proven Google SDK bindings and allowlisted static fetch URLs become normalized routes plus categorical parameter facts. No Google SDK package is loaded.

The Google catalog keeps exact documented alternatives and conditions rather than pretending URI prefixes establish hierarchy. The engine distinguishes true/false/unknown conditions, checks every relevant operation before suggesting a narrower candidate, and exposes dated classifications independently from authorization findings. Calendar/unverified categories stay unknown. The Google config omits GitHub-specific visibility/token fields, and its report uses schema 3.0.0. Existing schemas remain unchanged.
