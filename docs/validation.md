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
