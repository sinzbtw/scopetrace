# npm publishing

Registry identity: **@nesinz/scopetrace**. The CLI is still **scopetrace**. The unscoped npm name belongs to an unrelated publisher and must never be used by this repository.

## Current activation boundary

The owner registered @nesinz/scopetrace with the checked 0.4.1 bootstrap archive and configured GitHub trust for npm-publish.yml/environment npm. Package settings require 2FA and disallow ordinary tokens. Version 0.4.2 exercises the automated OIDC path. The existing v0.4.0 GitHub tag is unchanged. A successful dry run is not a registry publish; registry metadata and the publish job determine the final result. NPM_PUBLISH_ENABLED is the explicit activation switch and can be set false to stop future publishes.

## What the workflow does

[npm-publish.yml](https://github.com/sinzbtw/scopetrace/blob/main/.github/workflows/npm-publish.yml) runs after a stable GitHub Release is published, or via a manual dispatch. A manual dispatch defaults to a dry run, with no publication or OIDC job. Stable vX.Y.Z must match package.json, the lockfile and the checked-out tag. The source must be on main history. Real publication additionally requires an existing stable GitHub Release, the expected repository and NPM_PUBLISH_ENABLED=true.

Six validation jobs check Windows/Linux with Node.js 22/24/26, without OIDC permissions. A separate package job uses npm 12.2.1, runs a full audit, builds, packs with lifecycle scripts disabled, installs the exact tarball into an isolated prefix, checks all three providers and JSON/SARIF confidence metadata, exercises CLI gates and public exports/types, validates package paths/docs, and performs an npm publish dry run. It uploads only that tarball and its manifest/checksums as an immutable Actions artifact.

Only the final publish job has id-token: write, in GitHub environment npm. It installs no project dependencies, runs no project test/build lifecycle, downloads only the artifact from its own run, verifies source identity and SHA-256/SHA-512, rechecks the release/registry, and publishes the exact archive with --ignore-scripts and --provenance. Registry failures block publication; a missing package is recognized only on HTTP 404. Different contents for an existing immutable version fail; identical contents allow a safe retry. npm 12 also rejects duplicate-version dry runs, so that final network dry run is skipped only after exact registry integrity equality; consumer checks still run. Older stable versions cannot move latest backwards. Release jobs are serialized and are not cancelled mid-publish.

No NPM_TOKEN, NODE_AUTH_TOKEN, personal access token or npm authentication secret belongs in Actions. There is no pull_request_target, workflow_call or self-hosted publishing runner. Release build caches are disabled. GitHub environment npm admits main and v* tags; ordinary source CI remains read-only. The actual environment/trust are configured outside YAML as described below.

## One-time owner setup

1. Create the free npm account nesinz, verify its email and enable WebAuthn/passkey 2FA. Keep recovery codes privately. Public scoped packages are free; do not enable a paid plan.
2. An unpublished package has no package settings yet. First register it by publishing the fully checked archive through an interactive browser-authenticated npm session. Do not create an automation token. With Node.js 22.22.2+ or a current supported 24/26, run from this repository:

~~~powershell
npx --yes npm@12.2.1 login --auth-type=web --registry=https://registry.npmjs.org/
npx --yes npm@12.2.1 whoami --registry=https://registry.npmjs.org/
# The account must be nesinz. Use the exact archive produced by package:check.
npx --yes npm@12.2.1 publish ./work/npm/nesinz-scopetrace-0.4.1.tgz --access public --ignore-scripts --registry=https://registry.npmjs.org/
~~~

Run npm run check and npm run package:check before bootstrap if the checked archive is not already prepared. Match work/npm/CHECKSUMS.sha256. Bootstrap is an interactive owner publish, not an OIDC/provenance claim. Subsequent versions use the workflow. A staged first publish is another npm-supported registration route, but the same version cannot be simultaneously staged and directly published; do not improvise a bypass or publish an empty analyzer package.

3. Immediately before the next stable release, open the package's Settings → Trusted publishing and add GitHub Actions with exactly:

| Field | Value |
| --- | --- |
| Organization or user | sinzbtw |
| Repository | scopetrace |
| Workflow filename | npm-publish.yml |
| Environment name | npm |
| Allowed action | Allow npm publish |

Enter only the filename, not .github/workflows/npm-publish.yml. Enable direct npm publish; stage-only permission cannot run this automatic pipeline. The GitHub username and npm username intentionally differ. If preferred, npm 12.2.1 can configure the same trust with an interactive owner session:

~~~sh
npx --yes npm@12.2.1 trust github @nesinz/scopetrace --file npm-publish.yml --repo sinzbtw/scopetrace --env npm --allow-publish
~~~

4. In npm package Settings → Publishing access, select **Require two-factor authentication and disallow tokens**. This still permits Trusted Publishing. Do not paste login/session tokens into GitHub. Log out locally when the one-time setup is complete.
5. Confirm the trust configuration. Set the GitHub repository variable NPM_PUBLISH_ENABLED to true. This is a non-secret opt-in, not a credential. Before that, real publishing fails closed. The first successful OIDC publish must occur within npm's current two-day activation window; if the connection expires, recreate it immediately before publishing a new version.

## New versions

Update package.json/package-lock.json, src/engine/shared.ts, version assertions, README RU/EN and CHANGELOG together. Run npm run check, npm audit --audit-level=moderate and npm run package:check. Commit directly to main under this project's policy. Create matching stable vX.Y.Z on that checked main commit, then publish its GitHub Release. The workflow independently repeats all required checks before npm receives any package.

Do not move old version tags or reuse an npm version. A bootstrap version already in npm is immutable; the next automatic publish must use a new version. If a run fails after publication, retry the same release workflow only when the archive matches; never unpublish to bypass the version guard. GitHub Release publication alone is not proof that npm publication succeeded: check the npm workflow, registry version/integrity and provenance on the package page.

For a dry run without a tag, run the workflow on main with publish=false. A manual real publish requires publish=true, an existing stable matching release tag, and the workflow itself must be dispatched on that tag (not main). GITHUB_SHA must equal the built commit so provenance cannot name another source. It uses the same guards. Prerelease channels are not enabled by this workflow.

## References (checked 2026-11-03)

- [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)
- [npm provenance](https://docs.npmjs.com/generating-provenance-statements/)
- [npm trust CLI](https://docs.npmjs.com/cli/v12/commands/npm-trust/)
- [npm staged publishing](https://docs.npmjs.com/staged-publishing/)
- [npm 2FA](https://docs.npmjs.com/configuring-two-factor-authentication/)
