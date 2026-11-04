**English** | [Русский](README.ru.md)

# ScopeTrace

[![CI](https://github.com/sinzbtw/scopetrace/actions/workflows/ci.yml/badge.svg)](https://github.com/sinzbtw/scopetrace/actions/workflows/ci.yml) [![CodeQL](https://github.com/sinzbtw/scopetrace/actions/workflows/codeql.yml/badge.svg)](https://github.com/sinzbtw/scopetrace/actions/workflows/codeql.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Local static analysis of **GitHub OAuth App scopes**, **GitHub App read/write permissions** and **Google OAuth scopes (Gmail, Drive, Calendar)** in JavaScript and TypeScript. Compare declarations with supported API operations, with source locations, rationale and official documentation.

[MIT license](LICENSE) · Node.js 22+ · Version 0.5.1

## Why ScopeTrace

OAuth declarations often outlive the features that needed them. ScopeTrace gives reviewers reproducible evidence for investigating broad grants and missing scopes without uploading source code or requesting a token. It does not prove a scope can safely be removed.

This independent project is not affiliated with other products using the name ScopeTrace.

## Features

- TypeScript Compiler API AST analysis of JS/JSX/TS/TSX.
- Imported Octokit constructors, aliases, CommonJS destructuring, REST methods and literal request routes.
- Global fetch with static GitHub URLs and HTTP methods.
- Separate catalogs: 13 GitHub OAuth rules, 26 GitHub App rules and 22 Google OAuth rules, including conditional access and dated sensitivity metadata.
- File/line/column evidence, stable finding IDs, rationale, confidence and documentation.
- Terminal, JSON, Markdown and SARIF 2.1.0 reports; confidence-aware CI thresholds and GitHub Code Scanning workflow.
- Committed branch/PR permission diffs with explicit escalation warnings and review gates.
- Local bounded traversal, secret-file exclusions and symlink/junction skipping.

## Analysis limits

Select **github-oauth**, **github-app** or **google-oauth**. These are separate models; Google support covers Gmail v1, Drive v3 and Calendar v3. Fine-grained PATs and GitHub Actions YAML declarations are not modeled or translated.

Resolution is intrafile and limited to supported const aliases/literals. Wrappers, cross-file dataflow, dynamic templates, GraphQL, custom transports, other HTTP clients, pagination helpers, default imports, constructor factories and exported clients are outside the supported forms. Some unsupported forms cannot be recognized at all. Dynamic fetch targets are reported as candidates that may use another provider.

Every detected call is compared with one declared authorization model and grant set. The analyzer does not track token identity, validate reachability, inspect responses, verify actual grants or check user access, SSO and organization policies. Recognizable custom Octokit transports/base URLs become unknown. Repository visibility is never guessed.

Potential excess always has low confidence. Review exclusions, unknown calls and runtime behavior before reducing permissions. Traversal completeness means selected files were processed within limits, not that all application behavior was analyzed.

## Install

Install **@nesinz/scopetrace** from npm; the CLI command remains **scopetrace**. The unscoped npm package is unrelated.

```sh
npm install --global @nesinz/scopetrace --ignore-scripts
scopetrace --version
```

Releases use GitHub OIDC and provenance; see the [npm publishing guide](docs/publishing.md). You can also build the public source:

```sh
git clone https://github.com/sinzbtw/scopetrace.git
cd scopetrace
npm ci --ignore-scripts
npm run build
node dist/cli/main.js --help
```

CLI runtime: Node.js 22+. Development checks: Node.js 22.13+ or a current 24/26 release. Optionally install the built checkout as a command with `npm install --global . --ignore-scripts`. Registry installs use the compiled distribution and need no build step.

## Quick start

Run in your application's root after installing the built command:

```sh
scopetrace init
# Edit scopetrace.config.json: declare scopes and select source files.
scopetrace scan
scopetrace scan --format json --output report.json
scopetrace scan --format markdown --output report.md
scopetrace scan --format sarif --output report.sarif
scopetrace scan --fail-on high
```

Without global installation, replace `scopetrace` with `node /absolute/path/to/scopetrace/dist/cli/main.js`, staying in the application's root. Use the actual Windows absolute path on Windows.

For a new GitHub App config, use `scopetrace init --provider github-app` instead of the default init. See the [GitHub Apps guide](docs/github-apps.md) for configuration, read/write semantics and limitations.

For Google OAuth, use `scopetrace init --provider google-oauth`. See the [Google OAuth guide](docs/google-oauth.md) for configuration, conditional resource access and sensitive/restricted scope classifications. Unverified sensitivity stays unknown.

## Configuration

`init` creates `scopetrace.config.json` exclusively. Edit this data-only JSON:

```json
{
  "provider": "github-oauth",
  "declaredScopes": ["user:email", "repo", "workflow"],
  "include": ["src/**/*.{js,jsx,ts,tsx}"],
  "exclude": ["**/*.test.*", "**/*.spec.*"],
  "repositoryVisibility": "unknown",
  "limits": {
    "maxFiles": 2000,
    "maxFileBytes": 524288,
    "maxTotalBytes": 20971520,
    "maxEntries": 50000,
    "maxDepth": 32
  }
}
```

Unknown keys/providers, invalid limits and traversal patterns are rejected. Use relative forward-slash globs on every platform. Config must be JSON inside the root, at most 64 KiB. Unknown scope names produce redacted unknown findings.

Configuration reads use one validated file descriptor and a bounded buffer, rejecting detected replacement, growth or truncation during reading. Scan still assumes a stable checkout; these checks are not an OS sandbox against concurrent filesystem changes.

Visibility accepts unknown (default), public or private. An explicit value is your assertion about **all modeled repository reads** in this scan. Use separate scans for mixed visibility. Public reads establish no scope need; modeled private reads require repo with medium confidence because visibility is user-supplied. Without that assertion they remain unknown.

Without include/exclude, all supported extensions are selected except test/spec files. The starter config narrows selection to src/. Dependencies, VCS data, build outputs, environment files and private-key names remain excluded regardless of include patterns.

## Commands

| Command | Purpose |
| --- | --- |
| `scopetrace init` | Create starter JSON config |
| `scopetrace scan` | Analyze current working directory |
| `scopetrace scan --config custom.json` | Another JSON config inside root |
| `scopetrace scan --format text\|json\|markdown\|sarif` | Choose reporter |
| `scopetrace scan --output report.json` | Create a new output file |
| `scopetrace scan --fail-on high` | Gate sufficiently confident insufficient grants |
| `scopetrace rules` | OAuth rules, alternatives, conditions and sources |
| `scopetrace init --provider github-app` | Create an App permission config |
| `scopetrace rules --provider github-app` | App permission rules and sources |
| `scopetrace init --provider google-oauth` | Create a Google URI-scope config |
| `scopetrace rules --provider google-oauth` | Gmail/Drive/Calendar rules and classifications |
| `scopetrace --help / --version` | Usage/version |

Outputs must not exist; parent directories must exist and must not resolve through symbolic links. JSON/SARIF stdout contains only the report; errors go to stderr.

Exit **0**: completed; **1**: an insufficient finding meets the requested severity threshold with medium/high confidence; **2**: execution/configuration error. Thresholds: info, low, medium, high. Unknown and potential-excess findings do not trigger exit 1. An empty/truncated scan is explicitly incomplete/unknown and does not by itself block the gate.

## Real examples

```ts
import { Octokit as GitHub } from '@octokit/rest';
const api = new GitHub({ auth: process.env.GITHUB_TOKEN });
api.rest.users.listEmailsForAuthenticatedUser(); // user:email or broader user
api.request('DELETE /repos/{owner}/{repo}', {
  owner: 'example', repo: 'sample'
}); // delete_repo; repo alone is insufficient
fetch('https://api.github.com/repos/example/sample');
// public visibility: no scope; private: repo; unspecified: unknown
```

Rules also cover email writes (user), follow/unfollow (user:follow), gist writes (gist), public user/gist reads and repository contents reads. See [rules](docs/rules.md). Recognition does not prove execution or success.

Run the bundled example after building:

```sh
cd tests/fixtures/basic
node ../../../dist/cli/main.js scan --format json --fail-on high
```

It exits **1**: user:email and workflow are declared, but repository deletion needs delete_repo.

## Example report

```text
[insufficient/high/high] ST-<stable-hash> src/app.ts:4:1 DELETE /repos/{owner}/{repo}
  Deleting a repository requires delete_repo and repository administration access.
  Rule: gh.repo.delete
```

The ID is illustrative; actual IDs derive from location and operation identity. OAuth JSON schemaVersion remains 1.0.0 ([schema](schemas/report.schema.json)); App reports use 2.0.0 ([schema](schemas/github-app-report.schema.json)). Both expose analysis, operations and findings, including alternatives, docs and confidence. App findings include declared/required/suggested levels. Google reports use schemaVersion 3.0.0 ([schema](schemas/google-oauth-report.schema.json)) with scopeAssessments and conditional alternatives. Markdown exports the same findings for review.

Categories: observed, possibly_excessive, insufficient, unknown, not_applicable.

## CI/CD

[CI](.github/workflows/ci.yml) checks Windows/Linux on Node.js 22/24/26: typecheck, ESLint, unit/integration coverage tests, build and built CLI smoke/gate tests for all three models. Permissions are read-only and Actions are pinned.

[CodeQL](https://github.com/sinzbtw/scopetrace/blob/main/.github/workflows/codeql.yml) analyzes JavaScript/TypeScript with the security-extended suite on pushes to main, pull requests and a weekly schedule, without installing dependencies or running project code. Synthetic fixtures and generated directories are excluded. Results appear in GitHub Code Scanning alongside ScopeTrace's own permission reports.

[Dependabot](https://github.com/sinzbtw/scopetrace/blob/main/.github/dependabot.yml) checks npm dependencies and GitHub Actions every Monday. Minor/patch npm updates are grouped, Vitest packages are updated together, and other major npm upgrades get separate PRs. Major TypeScript and @types/node version updates are excluded: compiler API migrations need dedicated review, and Node declarations follow the minimum supported runtime. Action updates and security updates have their own groups. Updates require review and passing checks; there is no automatic merge.

For another repository, build this source at a reviewed **full commit SHA** and run its CLI against your checkout. The [read-only gate example](examples/github-actions.yml) and [Code Scanning example](examples/github-code-scanning.yml) pin reviewed implementation commits. Update pins only after review. Both build a pinned analyzer separately from the application being checked.

## SARIF and Pull Request annotations

This repository also runs [Code Scanning](.github/workflows/code-scanning.yml) on its own src/ with an explicit GitHub OAuth declaration; the standard CI tests exports for every provider.

Export with `scopetrace scan --format sarif --output report.sarif`. Copy the [Code Scanning workflow](examples/github-code-scanning.yml) into your application's .github/workflows and commit its config. The workflow uploads before enforcing the permission gate and uses a separate, reviewed tool checkout.

All three providers retain confidence, alternatives and App/Google metadata. Possible excess and unknown cases stay review notes; observed/not-applicable findings remain metadata rather than alerts. Operation locations can annotate added/edited PR lines; declaration-only findings use a file-level config anchor. See the [SARIF guide](docs/sarif.md) for mapping, fingerprints, permissions, fork PRs, categories and Code Scanning availability.

## Branch and Pull Request permission changes

Use the new compare command to review committed declaration changes without checking out or executing either version:

~~~sh
scopetrace compare --base origin/main --head HEAD --merge-base --format markdown
scopetrace compare --base origin/main --head HEAD --merge-base --fail-on medium --fail-on-unknown
~~~

The report distinguishes added, expanded, reduced, removed, equivalent and unknown privileges across all three providers. Read → write and documented broader scopes produce access-increase warnings; redundant scopes do not. JSON uses a separate permission-diff 1.0.0 schema. Existing scan formats and gates are unchanged. The [PR workflow](examples/github-permission-diff.yml) attaches the change report to a check summary and requires review for increases/uncertainty with read-only permissions. See the [comparison guide](docs/comparison.md), including the local --pr shortcut, explicit fetch/history requirements and declaration-only limits.

## npm releases

[Trusted Publishing workflow](https://github.com/sinzbtw/scopetrace/blob/main/.github/workflows/npm-publish.yml) uses GitHub OIDC and provenance, with no npm token secret. Tests/build/audit and exact-archive install checks precede publication. Manual runs default to dry-run; stable GitHub Releases trigger guarded automatic publication. See the [maintainer release guide](docs/publishing.md).

## Development and tests

```sh
npm ci --ignore-scripts
npm run check
npm run smoke
npm run package:check
npm audit --audit-level=moderate
```

Check runs typecheck, lint, coverage tests and build. Tests cover aliases, shadowing, route overrides, unusual syntax, privacy, scope hierarchy, reporters, exit codes, traversal limits, ordering and links. Coverage gates: 85% lines/statements/functions and 75% branches. Only the tiny process entrypoint is excluded. Hostile-source parser failures become unknown notices.

## Security and privacy

Scan needs no token, performs no network calls, never loads project modules/scripts and never changes sources. Reports retain relative filenames and normalized operation templates; source snippets, bodies, arbitrary URL segments, query values and headers are omitted. Filenames and known declared scope/permission names remain visible. Google reports retain categorical parameter facts; addresses, resource IDs, queries, auth strings and request bodies are omitted. Sensitivity labels do not establish app-specific verification obligations.

Links/junctions are skipped; real paths, regular-file identity and byte limits are checked. This protects against a stable untrusted repository, not a local process actively racing filesystem changes. Keep the scanned checkout stable. See [SECURITY.md](SECURITY.md) for the threat model and private reporting.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md), [architecture](docs/architecture.md) and [rule maintenance](docs/rules.md). New mappings require official OAuth evidence and regression tests. Participation follows our [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE).
