**English** | [Русский](README.ru.md)

# ScopeTrace

[![CI](https://github.com/sinzbtw/scopetrace/actions/workflows/ci.yml/badge.svg)](https://github.com/sinzbtw/scopetrace/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Local static analysis of **GitHub OAuth App scopes** and **GitHub App read/write permissions** in JavaScript and TypeScript. Compare declarations with supported API operations, with source locations, rationale and official documentation.

[MIT license](LICENSE) · Node.js 22+ · Version 0.2.0

## Why ScopeTrace

OAuth declarations often outlive the features that needed them. ScopeTrace gives reviewers reproducible evidence for investigating broad grants and missing scopes without uploading source code or requesting a token. It does not prove a scope can safely be removed.

This independent project is not affiliated with other products using the name ScopeTrace.

## Features

- TypeScript Compiler API AST analysis of JS/JSX/TS/TSX.
- Imported Octokit constructors, aliases, CommonJS destructuring, REST methods and literal request routes.
- Global fetch with static GitHub URLs and HTTP methods.
- Separate catalogs: 13 OAuth rules and 26 GitHub App rules; scope normalization and domain-specific read/write evaluation.
- File/line/column evidence, stable finding IDs, rationale, confidence and documentation.
- Terminal, JSON and Markdown reports; CI thresholds.
- Local bounded traversal, secret-file exclusions and symlink/junction skipping.

## Analysis limits

Select **github-oauth** for OAuth App scopes or **github-app** for GitHub App permissions. These are separate models. Fine-grained PATs and GitHub Actions YAML declarations are not modeled or translated.

Resolution is intrafile and limited to supported const aliases/literals. Wrappers, cross-file dataflow, dynamic templates, GraphQL, custom transports, other HTTP clients, pagination helpers, default imports, constructor factories and exported clients are outside the supported forms. Some unsupported forms cannot be recognized at all. Dynamic fetch targets are reported as candidates that may use another provider.

Every detected call is compared with one declared authorization model and grant set. The analyzer does not track token identity, validate reachability, inspect responses, verify actual grants or check user access, SSO and organization policies. Recognizable custom Octokit transports/base URLs become unknown. Repository visibility is never guessed.

Potential excess always has low confidence. Review exclusions, unknown calls and runtime behavior before reducing permissions. Traversal completeness means selected files were processed within limits, not that all application behavior was analyzed.

## Install

The package is **not published on npm**. Build the public source:

```sh
git clone https://github.com/sinzbtw/scopetrace.git
cd scopetrace
npm ci --ignore-scripts
npm run build
node dist/cli/main.js --help
```

CLI runtime: Node.js 22+. Development checks: Node.js 22.13+ or a current 24/26 release. Optionally install the built checkout as a command with `npm install --global . --ignore-scripts`. This does not imply npm registry publication.

## Quick start

Run in your application's root after installing the built command:

```sh
scopetrace init
# Edit scopetrace.config.json: declare scopes and select source files.
scopetrace scan
scopetrace scan --format json --output report.json
scopetrace scan --format markdown --output report.md
scopetrace scan --fail-on high
```

Without global installation, replace `scopetrace` with `node /absolute/path/to/scopetrace/dist/cli/main.js`, staying in the application's root. Use the actual Windows absolute path on Windows.

For a new GitHub App config, use `scopetrace init --provider github-app` instead of the default init. See the [GitHub Apps guide](docs/github-apps.md) for configuration, read/write semantics and limitations.

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

Visibility accepts unknown (default), public or private. An explicit value is your assertion about **all modeled repository reads** in this scan. Use separate scans for mixed visibility. Public reads establish no scope need; modeled private reads require repo with medium confidence because visibility is user-supplied. Without that assertion they remain unknown.

Without include/exclude, all supported extensions are selected except test/spec files. The starter config narrows selection to src/. Dependencies, VCS data, build outputs, environment files and private-key names remain excluded regardless of include patterns.

## Commands

| Command | Purpose |
| --- | --- |
| `scopetrace init` | Create starter JSON config |
| `scopetrace scan` | Analyze current working directory |
| `scopetrace scan --config custom.json` | Another JSON config inside root |
| `scopetrace scan --format text\|json\|markdown` | Choose reporter |
| `scopetrace scan --output report.json` | Create a new output file |
| `scopetrace scan --fail-on high` | Gate sufficiently confident insufficient grants |
| `scopetrace rules` | OAuth rules, alternatives, conditions and sources |
| `scopetrace init --provider github-app` | Create an App permission config |
| `scopetrace rules --provider github-app` | App permission rules and sources |
| `scopetrace --help / --version` | Usage/version |

Outputs must not exist; parent directories must exist and must not resolve through symbolic links. JSON stdout contains only the report; errors go to stderr.

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

The ID is illustrative; actual IDs derive from location and operation identity. OAuth JSON schemaVersion remains 1.0.0 ([schema](schemas/report.schema.json)); App reports use 2.0.0 ([schema](schemas/github-app-report.schema.json)). Both expose analysis, operations and findings, including alternatives, docs and confidence. App findings include declared/required/suggested levels. Markdown exports the same findings for review.

Categories: observed, possibly_excessive, insufficient, unknown, not_applicable.

## CI/CD

[CI](.github/workflows/ci.yml) checks Windows/Linux on Node.js 22/24/26: typecheck, ESLint, unit/integration coverage tests, build and built CLI smoke/gate tests for both models. Permissions are read-only and Actions are pinned.

For another repository, build this source at a reviewed **full commit SHA** and run its CLI against your checkout. Copy [the CI example](examples/github-actions.yml) and commit your app config. It pins a reviewed implementation commit; update that SHA only after review. This uses available source, not an unpublished registry package.

## Development and tests

```sh
npm ci --ignore-scripts
npm run check
npm run smoke
npm audit --audit-level=moderate
```

Check runs typecheck, lint, coverage tests and build. Tests cover aliases, shadowing, route overrides, unusual syntax, privacy, scope hierarchy, reporters, exit codes, traversal limits, ordering and links. Coverage gates: 85% lines/statements/functions and 75% branches. Only the tiny process entrypoint is excluded. Hostile-source parser failures become unknown notices.

## Security and privacy

Scan needs no token, performs no network calls, never loads project modules/scripts and never changes sources. Reports retain relative filenames and normalized operation templates; source snippets, bodies, arbitrary URL segments, query values and headers are omitted. Filenames and known declared scope/permission names remain visible.

Links/junctions are skipped; real paths, regular-file identity and byte limits are checked. This protects against a stable untrusted repository, not a local process actively racing filesystem changes. Keep the scanned checkout stable. See [SECURITY.md](SECURITY.md) for the threat model and private reporting.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md), [architecture](docs/architecture.md) and [rule maintenance](docs/rules.md). New mappings require official OAuth evidence and regression tests. Participation follows our [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE).
