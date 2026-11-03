# npm releases

ScopeTrace is published as **@nesinz/scopetrace**. The installed command is **scopetrace**. This guide describes the maintainer release process; installation is covered in the [README](../README.md#install).

## Release process

1. Update the package version, lockfile, tool version constants and version assertions. Update CHANGELOG and both READMEs for the release.
2. Run the checks from the repository root:

~~~sh
npm ci --ignore-scripts
npm run check
npm run smoke
npm audit --audit-level=moderate
npm run package:check
~~~

3. Commit the validated changes. Create a stable vX.Y.Z tag on that commit in main history and publish the matching GitHub Release.
4. Check the [npm publishing workflow](https://github.com/sinzbtw/scopetrace/actions/workflows/npm-publish.yml), the registry version and latest tag, archive integrity and provenance.

The tag, package.json, package-lock.json and source commit must agree. Prerelease publication is not enabled. Existing tags and npm versions are immutable release identities.

## Automated checks and publication

[npm-publish.yml](https://github.com/sinzbtw/scopetrace/blob/main/.github/workflows/npm-publish.yml) runs on published GitHub Releases and manual dispatches. Publication requires the expected repository, an existing stable release and NPM_PUBLISH_ENABLED=true.

Six validation jobs run on Windows/Linux with Node.js 22, 24 and 26. The package job audits dependencies, builds the CLI, and verifies the exact tarball through an isolated installation. Checks cover providers, report schemas, SARIF, comparison, CLI gates, public API/types, package contents and documentation links. The tarball, source manifest and checksums are uploaded as one Actions artifact.

Only the final publish job has id-token: write in the npm environment. It installs no project dependencies, verifies the artifact's source identity and SHA-256/SHA-512, and publishes that archive using GitHub OIDC with --ignore-scripts and --provenance. No npm token secret is required. Jobs are serialized and publishing is not cancelled mid-run.

## Publisher configuration

The repository's Trusted Publisher uses these values:

| Setting | Value |
| --- | --- |
| npm package | @nesinz/scopetrace |
| GitHub repository | sinzbtw/scopetrace |
| Workflow filename | npm-publish.yml |
| GitHub environment | npm |
| Allowed action | Allow npm publish |
| Repository variable | NPM_PUBLISH_ENABLED=true |

The npm package requires two-factor authentication and disallows token-based publishing. Trusted Publishing authenticates the workflow through OIDC. The GitHub environment admits main and v* tags; test/build jobs have no OIDC permission. Publisher and environment settings are maintained outside the workflow file. Setting NPM_PUBLISH_ENABLED=false disables future registry publication.

## Dry runs and retries

A manual run on main with publish=false and an empty tag validates the package without publishing. A manual publication requires publish=true, a matching existing stable release, and dispatching the workflow on that release tag so provenance identifies the built commit.

Registry processing may take several minutes. The workflow waits for the published version, verifies its integrity and checks latest. A failed post-publication check can be retried with the same release and identical archive. A different archive for an existing version is rejected; npm 12's duplicate-version dry run is skipped only after exact registry integrity equality. Older versions cannot move latest backwards.

A GitHub Release or successful dry run alone does not confirm registry publication. The publish job and registry metadata provide that result.

## References

- [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)
- [npm provenance](https://docs.npmjs.com/generating-provenance-statements/)
- [npm 2FA](https://docs.npmjs.com/configuring-two-factor-authentication/)
