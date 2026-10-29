# GitHub OAuth rule catalog

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
