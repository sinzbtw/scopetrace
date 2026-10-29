# Security policy

## Supported release

Security fixes target 0.1.x. ScopeTrace is a static review aid, not an authorization verifier or a guarantee that reducing scopes is safe.

## Private reporting

Use [GitHub private vulnerability reporting](https://github.com/sinzbtw/scopetrace/security/advisories/new). Share version, impact, expected behavior and a minimal synthetic reproduction. Do not provide tokens, private source code, Authorization values or personal data.

If the private form is unavailable, open a public issue containing only a request for a private reporting channel, without vulnerability details or secrets. No personal contact address is required.

## Threat model

An attacker may control a stable repository's filenames, text, configuration, links and syntax. Scan performs no network calls, module resolution, code execution, package installation, lifecycle scripts, eval or dynamic loading of analyzed code. The CLI and installed dependencies are trusted software.

JSON config is strict and bounded to 64 KiB. Traversal skips environment files, key names, dependencies, VCS metadata and build outputs. Source bytes, entries, file count and depth are bounded. Symlinks and junctions are skipped; real paths are checked against the root; opened regular-file identity is rechecked; reads use bounded buffers. Failures produce sanitized notices without source snippets.

Reports retain relative filenames, positions and known scope names. They omit source fragments, bodies, raw arbitrary endpoints, queries, auth options and headers. Unrecognized scope names are redacted. Markdown and terminal output escape untrusted filename characters.

Scan does not change source files. Explicit report export and init create files exclusively. Resolved directory symlinks in output paths are rejected.

## Boundaries

This is not an OS sandbox against a local process racing filesystem changes. Use a stable checkout with appropriate permissions. Hard links can refer to bytes from another location; the original provenance of those bytes cannot be inferred. No exhaustive behavior or token tracking is claimed. Review incomplete scans and unknown operations.

The runtime needs no GitHub credential. Maintainer publishing is a separate authorized action. Never run scripts from a project merely to scan it.

## Maintainer checks

Before releases: tests, typecheck, lint, build, dependency audit, staged-file and full-history credential review. CI uses read-only contents permissions, pinned Actions and no privileged pull-request workflow.
