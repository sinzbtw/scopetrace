# Validation

Before v0.1.0 publication, the complete Windows local checks passed:
- TypeScript typecheck, ESLint and build.
- Unit/integration/contract tests with enforced coverage gates.
- Full dependency audit, including development dependencies.
- CLI version, real fixture scan, JSON/Markdown export and confidence-aware exit code.
- Report validation against JSON Schema; bilingual README section/link checks.
- Installation of the packed build into an isolated local prefix.
- Credential-pattern inspection of tracked files and complete Git history.

CI is authoritative for Linux and additional Node versions. Coverage percentages and job outcomes are visible in the CI logs rather than hard-coded as product guarantees.

Review boundaries: the credential check is pattern-based, not proof of the absence of every possible secret. Only synthetic fixtures are intentionally included; no user project or environment file is part of the published source. Findings do not establish safe scope removal.

## 0.2.0

Adds App-specific AST, permission-level, domain, token-kind, alternative, privacy, CLI and JSON-schema regression tests. Both authorization models run through the same safe traversal and formatting paths. CI runs both built fixtures on Windows/Linux and Node.js 22/24/26. Release-specific results are recorded in the release notes and CI logs.

## 0.3.0

Adds Google SDK/fetch binding, conditional Gmail/Drive/Calendar scopes, classification, resource-context, redaction, CLI and schema tests. Development validation compares all 22 scope lists and methods against the saved official Discovery revisions. Scan and automated test execution require neither tokens nor Google network access. CI includes a built Google fixture alongside the GitHub fixtures.

## 0.4.0

Adds offline validation against the official vendored OASIS SARIF 2.1.0 Errata 01 schema for all providers; confidence/level variants, evidence preservation, URI encoding, fingerprint stability, privacy, empty/incomplete reports, CLI exclusive output and gate behavior. Workflow contracts verify pinned Actions, PR events, permissions, checkout roots and upload-before-gate order. Built SARIF smoke checks run for all providers across the existing CI matrix. Release notes record the final local and CI results.

## 0.4.1

Adds native release-policy tests for scoped registry identity, version/tag/repository guards, disabled publishing, immutable version integrity, latest rollback and artifact tampering. Package checks install the exact tarball, exercise all providers and JSON/SARIF gates, verify exported TypeScript declarations and packaged Markdown links, inspect allowed paths, and run npm publish --dry-run. Workflow tests assert least-privilege OIDC isolation and pinned Actions. A dry run does not verify the npm owner trust relationship or constitute a registry publish.

## 0.5.0

Adds declaration-semantic tests and real local Git fixtures for branch tips, merge bases/ambiguity, PR refs, dirty copies, config creation/deletion, malformed/oversized/link blobs, replaced objects, untrusted Git executables and disabled lazy transports. Installed-archive checks validate the new JSON schema, public comparison API/types, compiled Git CLI and escalation gate. Read-only PR workflow contracts and a built comparison run join the existing Windows/Linux matrix.
