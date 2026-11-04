# Validation

## Source checks

~~~sh
npm ci --ignore-scripts
npm run check
npm run smoke
npm audit --audit-level=moderate
~~~

check runs TypeScript typechecking, ESLint, coverage tests, release/workflow policy tests and the build. CI repeats validation on Windows/Linux with Node.js 22, 24 and 26, then exercises the built CLI. Current coverage and job results are recorded in [CI](https://github.com/sinzbtw/scopetrace/actions/workflows/ci.yml).

[CodeQL](https://github.com/sinzbtw/scopetrace/blob/main/.github/workflows/codeql.yml) separately analyzes JavaScript/TypeScript with security-extended queries on main pushes, pull requests, weekly scheduled runs and manual dispatch. It uses build-mode none with no project installation or execution, excludes synthetic fixtures and generated directories, and uploads to GitHub Code Scanning. It complements ScopeTrace's own permission analysis.

[Dependabot](https://github.com/sinzbtw/scopetrace/blob/main/.github/dependabot.yml) checks npm and GitHub Actions weekly. Vitest packages are grouped together; other minor/patch npm updates are grouped while major upgrades remain separate. Major TypeScript and @types/node version updates are excluded pending dedicated compiler API/runtime compatibility review. Actions and security updates use separate groups. Maintainers enable Dependabot alerts and security updates in the repository's code security settings, review each update and require checks to pass before merging.

## Analysis and report contracts

Tests cover supported AST bindings, aliases, shadowing, dynamic/unsupported calls, permission hierarchies, App read/write and token kinds, conditional Google scope requirements, sensitivity metadata and explicit uncertainty. Filesystem tests cover traversal limits, links, bounded reads and redaction. Fixtures use synthetic data and are parsed without execution.

Deterministic filesystem regressions also exercise configuration growth/truncation during reading, replaced configuration/source paths, changed source content, descriptor closure and competing exclusive report exports. Configuration reads enforce the 64 KiB limit on bytes read from one checked descriptor. Release archive verification reads and hashes a checked descriptor; publication still assumes an isolated runner and stable artifact files until npm opens the archive.

Provider JSON reports and permission comparisons are validated against their independent schemas. SARIF exports for all providers are checked offline against the vendored official OASIS SARIF 2.1.0 Errata 01 schema. Confidence, severity, evidence, relative URIs, fingerprints, exclusive output creation and CLI exit policies have regression coverage.

Comparison tests create local Git histories for branch tips, merge bases, PR refs, dirty files, configuration creation/deletion, malformed and oversized blobs, symlinks, replaced objects, untrusted executables and disabled lazy transports. Google scope relations are checked against saved official Discovery method/scope evidence as well as documented scope semantics.

## Package and workflow checks

~~~sh
npm run package:check
~~~

The package check installs the exact tarball in an isolated directory and exercises the compiled CLI, all providers, JSON/SARIF exports, comparison reports and gates, public API/types, allowed archive paths and packaged documentation links. Publishing checks enforce repository/version/tag identity, immutable-version integrity, artifact checksums and latest rollback prevention.

Workflow contracts cover pinned Actions, PR events, minimum permissions, separate analyzer/application checkouts, SARIF upload before gating and OIDC isolation. [Publishing](publishing.md) describes the release workflow and registry verification.

## Privacy review

Release review includes tracked files, Git history and package contents for credentials and private local paths. Automated secret detection is supplemented by inspection of documentation, fixtures and metadata; it cannot establish the absence of every possible secret.

Reports retain relative source locations and recognized permission metadata. They omit source snippets and credential values. Scope removal and actual runtime authorization remain outside the guarantees of static analysis.
