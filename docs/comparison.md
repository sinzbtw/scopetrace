# Compare permissions between branches and pull requests

ScopeTrace 0.5.0 adds a separate compare command to report changes to committed **ScopeTrace permission declarations**, for github-oauth, github-app and google-oauth. It does not scan API-call changes, arbitrary OAuth strings or provider manifests; use scan to analyze supported source calls.

## Commands

~~~sh
# Direct comparison of branch tips; head defaults to HEAD.
scopetrace compare --base main --head feature
scopetrace compare --base v0.4.2 --head HEAD --format json --output changes.json
# PR-style changes relative to the unique common ancestor.
scopetrace compare --base origin/main --head feature --merge-base --format markdown
# Review policy: block known increases and unreviewable comparisons.
scopetrace compare --base origin/main --head HEAD --merge-base --fail-on medium --fail-on-unknown
~~~

Select a single JSON file with --config config/permissions.json. The path is relative to the current application directory; source.configPath is relative to the Git worktree root. Both snapshots use that same path. Dirty/staged files are ignored. To compare multiple configs, run separately and keep distinct output paths.

For a GitHub PR number, fetch its data explicitly and use the local ref shortcut:

~~~sh
git fetch origin pull/123/head:refs/pull/123/head
scopetrace compare --base origin/main --pr 123 --format markdown
~~~

--pr always uses merge-base semantics and cannot be combined with --head. It does not call GitHub or fetch anything. Refs, commits and the required history must already exist locally; shallow/partial clones with missing objects fail with code 2. Multiple equally good merge bases are rejected instead of choosing one silently. Git must support --no-lazy-fetch; older Git installations fail safely and need an upgrade. scan itself still does not require Git.

## Meaning of changes

| Kind | Interpretation |
| --- | --- |
| added | A new documented declared privilege not covered by the old modeled grants |
| expanded | A broader grant covers previously narrower grants, including App read → write |
| reduced | A broader declaration was replaced by narrower documented grants |
| removed | An old declaration is absent and not covered by a new documented broader grant |
| equivalent | Only redundant declarations changed; the modeled privilege set is equivalent |
| unknown | Unsupported scopes, changed models/context or missing declarations need review |

The report also lists exact recognized declaration additions/removals, so normalizing redundant scopes does not hide edits. Reordering and duplicates do not create changes. Incomparable replacements can add and remove privileges together; no net reduction is guessed. Scope removal does not prove token revocation, and additions/expansions describe declarations rather than successful runtime authorization.

GitHub OAuth uses the existing catalog hierarchy: user:email → user is an expansion; adding user:email while retaining user is equivalent. GitHub App levels compare only the same domain and permission key. Changing provider or App token kind is not ranked as an increase/decrease.

Google uses the separate [explicit relation catalog](../rules/google-scope-relations.json), checked against official Gmail/Drive/Calendar scope descriptions on 2026-11-04. It contains whole-scope inclusions; operation-conditioned narrowing candidates do not define this hierarchy. URI prefixes never imply coverage. Every inclusion is also checked against the official Discovery method/scope matrix. Calendar events does not globally cover events.owned (colors.get is a counterexample), so that replacement remains a mixed addition/removal. The documented drive → drive.file and calendar → calendar.app.created directions describe strict reductions in resource reach, not equivalence or proof that a particular resource is authorized. drive.appdata remains separate. Sensitive/restricted/unknown classifications are preserved independently from change confidence; they do not determine app verification obligations.

Known increases have high confidence, or medium when a config file is newly introduced. Expanded grants, new App write permissions and new restricted Google scopes are high severity; ordinary additions are medium. App metadata read changes remain review notes because that access can be implicit. Reductions/removals/equivalence are informational. Unsupported declarations make semantic access changes unknown/low confidence, with unrecognized values redacted. Changed selectors/resource assertions also create review notes, without suppressing independently known scope increases.

## Reports, gates and API

Formats are text, JSON and Markdown. The separate JSON contract is kind=permission-diff, schemaVersion=1.0.0 ([schema](../schemas/comparison-report.schema.json)), with base/head snapshots, declaration edits, semantic changes, confidence, escalation warnings, summary, limits and resolved commit identities. Existing scan provider schemas 1.0.0/2.0.0/3.0.0 and scan SARIF 2.1.0 remain unchanged. compare does not emit SARIF in this release.

Output creation is exclusive, as for scan. Exit 0 means successful comparison; exit 1 means a requested review gate was met; exit 2 means invalid config/ref, incomplete Git history, unsupported Git or another execution error. The complete report is written before exit 1.

--fail-on severity blocks only known added/expanded privileges at or above the threshold with medium/high confidence. --fail-on-unknown independently blocks analysis.complete=false, even without --fail-on. The PR example enables both so adding an unsupported declaration or changing the provider cannot bypass review. Neither gate is enabled by default; existing scan thresholds retain their old behavior.

~~~ts
import { configSchema, comparePermissions, compareGit, renderComparison, shouldFailComparison } from '@nesinz/scopetrace';
const before = configSchema.parse({ provider: 'github-oauth', declaredScopes: ['user:email'] });
const after = configSchema.parse({ provider: 'github-oauth', declaredScopes: ['user'] });
const report = comparePermissions(before, after);
const markdown = renderComparison(report, 'markdown');
const gate = shouldFailComparison(report, 'medium', true);
const committed = await compareGit(process.cwd(), { base: 'origin/main', head: 'HEAD', mergeBase: true });
~~~

null configurations represent an absent tracked declaration file, not empty runtime permissions. Both absent is an error. A deleted head config always requires review and does not silently prove privilege reduction.

## Pull Request integration

Copy [github-permission-diff.yml](../examples/github-permission-diff.yml) into the application's .github/workflows. The read-only pull_request workflow checks out application data with complete history, builds a separately pinned reviewed analyzer, compares the event's actual base/head SHAs using their merge base, attaches Markdown to the check's job summary, and emits a review warning/failing check for increases or unknown cases. It installs no application dependencies and runs no application scripts. The merge checkout supplies Git objects; its files are not the baseline/head inputs.

Use permissions contents: read; no PR write token, custom npm token, pull_request_target or bot comment is needed. Fork PRs use the same read-only event subject to repository approval settings. Missing/outdated event objects fail safely; fetch/retry the correct history rather than falling back to a different ref. Review full analyzer SHA updates before changing the pin. ScopeTrace itself runs the [same workflow](https://github.com/sinzbtw/scopetrace/blob/main/.github/workflows/permission-diff.yml) against its explicit .github config and supports a manual comparison for verification.

## Local safety and boundaries

Git runs via an absolute executable resolved outside the project, with argument arrays, time/output bounds, no lazy fetch, no replacement refs, no paging/fsmonitor, and inherited GIT_* overrides removed. Only selected regular JSON blobs of at most 64 KiB are read. Links, submodules, tree entries and invalid JSON/configs are rejected. No checkout, worktree creation, hook, filter, extraction, network operation or project execution is performed by compare. Reports contain recognized declarations and relative config paths, not raw JSON/source snippets, unknown scope values, absolute checkout roots or arbitrary Git stderr. A stable checkout/object database and a trusted installed Git are required.

Official references: [Git diff/merge-base](https://git-scm.com/docs/git-diff), [Git merge-base ambiguity](https://git-scm.com/docs/git-merge-base), [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth), [GitHub PR events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).
