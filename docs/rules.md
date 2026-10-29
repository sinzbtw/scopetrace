# Rule catalogs

## GitHub OAuth

Catalog 2026-10-29.2, verified on 2026-10-29: [catalog JSON](../rules/github-oauth.json).

Applies only to **GitHub OAuth Apps**. Fine-grained permission tables on an endpoint page do not establish OAuth scope requirements. Evidence is explicit OAuth wording, or the scope reference combined with documented endpoint behavior.

| Rule | Operation | Requirement |
| --- | --- | --- |
| gh.email.list | GET /user/emails | user:email, included by user |
| gh.email.add | POST /user/emails | user |
| gh.email.delete | DELETE /user/emails | user |
| gh.user.follow | PUT /user/following/{username} | user:follow |
| gh.user.unfollow | DELETE /user/following/{username} | user:follow |
| gh.gist.create | POST /gists | gist |
| gh.gist.update | PATCH /gists/{gist_id} | gist |
| gh.gist.delete | DELETE /gists/{gist_id} | gist |
| gh.repo.delete | DELETE /repos/{owner}/{repo} | delete_repo |
| gh.repo.read | GET /repos/{owner}/{repo} | public: no scope; private: repo; else unknown |
| gh.contents.read | GET /repos/{owner}/{repo}/contents/{path} | public: no scope; private: repo; else unknown |
| gh.user.public | GET /users/{username} | public profile: no scope |
| gh.gist.public | GET /gists/{gist_id} | public gist read: no scope |

Account access, resource restrictions, rate limits and policies still apply. A no-scope rule does not mean authentication is unnecessary in every context.

## Format

Each rule contains a unique id, uppercase method, template endpoint, Octokit method paths, alternatives, condition, confidence, rationale, official docs and ISO verification date.

Alternatives are OR sets of AND scopes: [[a,b],[c]] means (a AND b) OR c. [[]] models no scope. Condition is always or repository-read; the engine selects the public/private branch for repository reads. Unknown visibility blocks inference.

Implication edges represent verified coverage. Repo covers repository subscopes, but never delete_repo or workflow. User includes read:user, user:email and user:follow. Other nested families support normalization; recognizing a scope name does not imply endpoint coverage. We do not infer unrelated notifications/package scope relationships. Public_repo does not globally imply admin:repo_hook: public-only hook access cannot cover private-repository hooks.

## Evidence and exclusions

Sources: [OAuth scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps), [emails](https://docs.github.com/en/rest/users/emails), [follow](https://docs.github.com/en/rest/users/followers), [gists](https://docs.github.com/en/rest/gists/gists), [repositories](https://docs.github.com/en/rest/repos/repos), [contents](https://docs.github.com/en/rest/repos/contents), [users](https://docs.github.com/en/rest/users/users).

We reviewed [App differences](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps), [App permissions](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps) and [fine-grained PAT permissions](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens) to keep these models separate.

Notifications remain unknown: current [endpoint docs](https://docs.github.com/en/rest/activity/notifications) explicitly restrict authentication to classic PATs. GET /user remains unknown because response fields depend on scopes and response use is not analyzed. Workflow content writes need path/content conditions and exception handling; they remain outside the catalog.

## Extending

Recheck current official OAuth and endpoint docs. Preserve conditions; add positive/negative, alternative, hierarchy and unknown tests; bump the catalog version and update both READMEs. Uncertain evidence yields unknown. New providers need a separate model/adapter, config discriminator, normalization and tests. See [architecture](architecture.md).

## GitHub Apps

Catalog 2026-10-29.1: [JSON](../rules/github-app.json), checked on 2026-10-29. The 26 App rules use permissions rather than OAuth scopes. Levels are compared only within one domain/name.

| Rule | Operation | Alternatives | Condition | Token types |
| --- | --- | --- | --- | --- |
| gha.repo.read | GET /repos/{owner}/{repo} | repository.metadata=read | repository-read | installation, user |
| gha.repo.delete | DELETE /repos/{owner}/{repo} | repository.administration=write | always | installation, user |
| gha.contents.read | GET /repos/{owner}/{repo}/contents/{path} | repository.contents=read | repository-read | installation, user |
| gha.issues.read | GET /repos/{owner}/{repo}/issues/{issue_number} | repository.issues=read | repository-read | installation, user |
| gha.issues.create | POST /repos/{owner}/{repo}/issues | repository.issues=write | always | installation, user |
| gha.issues.update | PATCH /repos/{owner}/{repo}/issues/{issue_number} | repository.issues=write OR repository.pull_requests=write | always | installation, user |
| gha.pulls.read | GET /repos/{owner}/{repo}/pulls/{pull_number} | repository.pull_requests=read OR repository.contents=read | repository-read | installation, user |
| gha.pulls.create | POST /repos/{owner}/{repo}/pulls | repository.pull_requests=write | always | installation, user |
| gha.pulls.update | PATCH /repos/{owner}/{repo}/pulls/{pull_number} | repository.pull_requests=write | always | installation, user |
| gha.pulls.merge | PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge | repository.contents=write | always | installation, user |
| gha.email.list | GET /user/emails | account.emails=read | always | user |
| gha.email.add | POST /user/emails | account.emails=write | always | user |
| gha.email.delete | DELETE /user/emails | account.emails=write | always | user |
| gha.user.follow | PUT /user/following/{username} | account.followers=write | always | user |
| gha.user.unfollow | DELETE /user/following/{username} | account.followers=write | always | user |
| gha.gist.create | POST /gists | account.gists=write | always | user |
| gha.gist.update | PATCH /gists/{gist_id} | account.gists=write | always | user |
| gha.gist.delete | DELETE /gists/{gist_id} | account.gists=write | always | user |
| gha.user.public | GET /users/{username} | none | always | installation, user |
| gha.gist.public | GET /gists/{gist_id} | none | always | installation, user |
| gha.org.members | GET /orgs/{org}/members | organization.members=read | organization-members | installation, user |
| gha.org.membership.read | GET /orgs/{org}/memberships/{username} | organization.members=read | always | installation, user |
| gha.org.membership.set | PUT /orgs/{org}/memberships/{username} | organization.members=write | always | installation, user |
| gha.org.membership.remove | DELETE /orgs/{org}/memberships/{username} | organization.members=write | always | installation, user |
| gha.contents.write | PUT /repos/{owner}/{repo}/contents/{path} | repository.contents=write OR repository.contents=write AND repository.workflows=write | content-write | installation, user |
| gha.contents.delete | DELETE /repos/{owner}/{repo}/contents/{path} | repository.contents=write OR repository.contents=write AND repository.workflows=write | content-write | installation, user |

Repository-read conditions require explicit visibility; public reads can need no permission. Organization-members remains unknown without membership visibility intent. Content-write requirements are conditional: Contents write is mandatory, but the extra Workflows write grant may depend on an unresolved target path. Metadata omissions are unknown and Metadata read is not suggested for removal merely because it is unused.

Per-rule official sources and verification dates are in the catalog. Domain/level checks, OR/AND alternatives, public reads, token types and unknown cases are covered by tests. See [the App guide](github-apps.md).
