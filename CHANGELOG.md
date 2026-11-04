# Changelog

## Unreleased

## 0.5.1 — 2026-11-04

- Bound configuration reads to 64 KiB through a validated file descriptor, rejecting detected replacement, growth and truncation.
- Validate source-file identity and changes through open descriptors; preserve atomic exclusive report creation and verify release archives without reopening their paths for hashing.
- Simplify maintainer release documentation, remove setup-session notes and refresh installation and validation guides.

## 0.5.0 — 2026-11-04

- Add compare CLI/API for committed ScopeTrace declarations from local refs or fetched PR heads, including unique merge-base comparisons.
- Detect added, expanded, reduced, removed and redundant-equivalent privileges for GitHub OAuth, App read/write and Google OAuth, preserving confidence/sensitivity and unknown cases.
- Independent permission-diff JSON schema 1.0.0, terminal/Markdown reports, escalation warnings and optional strict unknown-review gate.
- Read-only pinned PR workflows attach change summaries and require review without running application code or using write tokens.
- Bounded offline Git plumbing, no checkout/fetch/hooks/filters, symlink rejection, secret redaction, installed-package checks and Git history regression tests.
- README RU/EN and comparison guides updated; existing scan contracts and SARIF remain compatible.

## 0.4.2 — 2026-11-03

- Enable automated registry releases for @nesinz/scopetrace through the configured Trusted Publisher.
- Publish the checked archive through GitHub OIDC with provenance and token-based publishing disabled.
- Document the scoped registry installation command and retain all existing provider/report behavior.

## 0.4.1 — 2026-11-03

- Prepare public scoped npm identity @nesinz/scopetrace; CLI remains scopetrace. The occupied unscoped npm package is unrelated.
- Token-free GitHub Trusted Publishing workflow with provenance, isolated OIDC publish permissions, release/tag/main guards and an explicit repository opt-in.
- Exact-tarball install/API/types/provider/gate/privacy checks, package allowlist, audit and dry-run before publication.
- SHA-256/SHA-512 artifact checks, immutable-version/retry safeguards and latest rollback prevention.
- Native release-policy tests and bilingual maintainer publishing documentation. Existing providers and JSON/SARIF behavior remain compatible.

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
