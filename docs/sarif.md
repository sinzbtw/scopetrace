# SARIF 2.1.0 and GitHub Code Scanning

ScopeTrace 0.4.0 exports SARIF 2.1.0 for github-oauth, github-app and google-oauth. Export is local and offline. Uploading to GitHub is a separate, explicit workflow step.

## Export

Run from the application's root:

~~~sh
scopetrace scan --format sarif --output report.sarif
scopetrace scan --config config/permissions.json --format sarif --output gated.sarif --fail-on high
~~~

Without --output, stdout contains only the SARIF JSON document. Existing output files are never overwritten. A complete export is written before exit 1 when the gate is met; execution/configuration failures return 2 and must not upload a stale report. The gate still considers only insufficient findings with medium/high confidence. Changing format does not change authorization analysis or provider JSON schema versions 1.0.0/2.0.0/3.0.0.

Programmatic use:

~~~ts
import { render, toSarif } from '@nesinz/scopetrace';
const document = toSarif(report, { configFile: 'config/permissions.json' });
const serialized = render(report, 'sarif', { configFile: 'config/permissions.json' });
~~~

Pass the actual relative config path when it differs from scopetrace.config.json. The CLI does this automatically, including for an absolute --config inside the scan root.

## Findings, confidence and locations

| ScopeTrace finding | SARIF result |
| --- | --- |
| insufficient | error for high severity, warning for medium, note for low/info |
| possibly_excessive | note with low confidence; review advice |
| unknown | note with original confidence and explanation |
| observed / not_applicable | Preserved in run.properties.scopetrace.nonAlertFindings, without creating alerts |

Every result keeps confidence, category and original severity in properties and in its visible message. properties.scopetrace preserves the original structured finding: catalog rule ID, alternatives, evidence, documentation, App read/write levels and Google sensitivity/narrowing details. Run properties preserve report metadata, analysis limits, notices, operations, declarations and Google scope classifications. Unknown classifications stay unknown.

Rule IDs combine provider, catalog rule (or declaration), category, severity and confidence. They remain independent of finding-instance hashes. Separate confidence variants allow GitHub's rule precision to match the result without upgrading another result's certainty. No CVSS/security-severity score is invented: these are authorization review findings, not verified vulnerabilities.

Operation results use the actual 1-based file/line/UTF-16 column. Relative paths use forward slashes and percent-encode URI characters, including spaces, #, ?, % and non-ASCII names. Absolute/traversing paths and invalid positions are rejected. No source snippets, tokens, URL resource IDs, bodies, query values or checkout root are added.

Declaration-only findings and scan notices use the actual config file as a file-level review anchor with no fabricated line number. They may appear in Code Scanning, but do not promise an inline PR comment at a scope declaration. Incomplete traversal is retained in run metadata and tool execution warnings; successful export does not claim whole-application coverage.

Fingerprints hash provider, normalized operation/declaration identity, relative path and source-order occurrence. Line/column and the version are excluded, so inserting unrelated lines does not churn every alert. Reordering/inserting identical calls or changing rule/category/confidence can still change alert identity. Reports do not read source text again to compute hashes. The upload action may add its own source-line fingerprint.

## GitHub integration

Copy [github-code-scanning.yml](../examples/github-code-scanning.yml) into the application's .github/workflows directory and commit its ScopeTrace config. It builds a reviewed full commit of ScopeTrace, checks out the application separately, and uploads with a pinned github/codeql-action/upload-sarif v4. It never installs or executes the analyzed application's dependencies/scripts.

The workflow uses pull_request and push to main so the default branch has a baseline. It relies on GitHub's merge-ref defaults for PRs; do not override the checked-out PR with an unrelated ref. checkout_path: app makes locations relative to the analyzed repository. Use a unique, stable category for each authorization config or monorepo slice. By default the exporter omits automationDetails so the upload action can assign that category. For direct API uploads, toSarif accepts an optional category; an explicitly set automationDetails.id takes precedence over the upload action category. Keep paths and categories consistent between default-branch and PR scans. For nested application roots, adjust reported paths/checkout layout so they remain repository-relative.

The scan captures exit 1, uploads the report, then enforces the permission gate. Exit 2 immediately fails without attempting an upload. Both the local threshold and GitHub's own Code Scanning check configuration can influence PR checks; they are separate policies.

Required workflow permissions are contents: read and security-events: write; actions: read also supports private repositories. No pull-requests: write permission or custom token is required. Use the built-in GITHUB_TOKEN. Fork/Dependabot PRs use pull_request with GitHub's restricted-token upload support, subject to repository approval and Actions settings. Do not switch to pull_request_target or provide a write-capable personal token to run untrusted PR code.

Code Scanning must be available and enabled for the target repository. It is available for public GitHub.com repositories; private/organization availability depends on the plan and GitHub Code Security settings. This workflow does not purchase or enable a paid feature.

GitHub shows inline PR annotations only when the reported location belongs to added/edited lines in the PR diff. File-level anchors, unchanged lines, excluded files and unsupported operations cannot guarantee inline annotations. View the Code Scanning checks and Security tab for the broader analysis. GitHub also imposes SARIF size/result limits; narrow include patterns or split large applications into stable categories if needed.

## Verification and sources

Offline tests validate all three providers against the unmodified official OASIS schema, plus confidence, privacy, URI encoding, fingerprints, CLI output/gates and workflow contracts. CI exercises built SARIF exports on Windows/Linux and Node.js 22/24/26. This is not a claim that every supported repository setting or PR display condition was exercised live.

- [OASIS SARIF 2.1.0 plus Errata 01](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html)
- [GitHub SARIF support, locations, fingerprints and limits](https://docs.github.com/en/code-security/reference/code-scanning/sarif-files/sarif-support)
- [Uploading third-party SARIF to GitHub](https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/integrate-with-existing-tools/upload-sarif-file)
- [Pinned upload-sarif action](https://github.com/github/codeql-action/tree/9b3254085494b55a0f7c4c2b3d2d52cc712ce370/upload-sarif)
