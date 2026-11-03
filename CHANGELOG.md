# Changelog

## 0.4.1 — 2026-11-03

- Prepare public scoped npm identity @nesinz/scopetrace; CLI remains scopetrace. The occupied unscoped npm package is unrelated.
- Token-free GitHub Trusted Publishing workflow with provenance, isolated OIDC publish permissions, release/tag/main guards and owner activation.
- Exact-tarball install/API/types/provider/gate/privacy checks, package allowlist, audit and dry-run before publication.
- SHA-256/SHA-512 artifact checks, immutable-version/retry safeguards and latest rollback prevention.
- Native release-policy tests and bilingual npm bootstrap/trusted-publisher instructions. Existing providers and JSON/SARIF behavior remain compatible.

## 0.4.0 — 2026-11-02

- SARIF 2.1.0 export via --format sarif and toSarif API for all three providers.
- Original confidence, severity, alternatives, App read/write levels and Google classifications retained; observed/non-applicable evidence stays out of alert results.
- Stable rule variants, line-shift-resistant fingerprints, encoded relative source URIs and honest config-level anchors.
- Pinned GitHub Code Scanning PR/default-branch workflows for ScopeTrace itself and consuming applications upload SARIF before enforcing the existing confidence-aware gate.
- Offline official-schema contracts, CLI/privacy/fingerprint/workflow regressions, built SARIF CI checks and bilingual SARIF/README documentation.
- Existing provider JSON schemas and offline analysis behavior remain compatible.

## 0.3.0 — 2026-10-31

- Independent Google OAuth provider for Gmail v1, Drive v3 and Calendar v3.
- 22 source-verified operation rules; static fetch and proven Google Node SDK imports/aliases.
- Conditional resource/response/query scope analysis with explicit unknown cases.
- Dated sensitive/restricted/non-sensitive classifications where verified; unverified categories remain unknown.
- Low-confidence narrower-scope suggestions, separate Google JSON schema 3.0.0 and bilingual guides.
- Existing GitHub OAuth/App schemas and offline safety guarantees preserved.

## 0.2.0 — 2026-10-29

- Separate GitHub App provider with installation/user token kinds and repository, organization and account permission domains.
- Read/write sufficiency, unused-grant review and low-confidence write-to-read suggestions.
- 26 source-verified App operation rules, alternatives, token incompatibility and conservative public/metadata/workflow conditions.
- Provider-selectable init/rules, App examples and CLI/contract regressions.
- Independent App report schema 2.0.0; OAuth report schema 1.0.0 remains compatible.
- Still local, token-free and unpublished on npm.

## 0.1.0 — 2026-10-29

- Local GitHub OAuth App scope analysis CLI.
- AST recognition of supported fetch/Octokit forms in JS/JSX/TS/TSX.
- Thirteen verified operation rules, scope normalization, explicit repository visibility and unknown states.
- Evidence, stable IDs, JSON schema, terminal/JSON/Markdown reports and CI severity thresholds.
- Strict config, bounded traversal, symlink skipping and reports without source snippets.
- Windows/Linux CI, regression tests, bilingual docs and MIT license.

Not published to the npm registry.
