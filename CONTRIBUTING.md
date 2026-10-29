# Contributing

Participation follows our [Code of Conduct](CODE_OF_CONDUCT.md). Use the issue templates for bugs, feature proposals and OAuth rule corrections, and the PR template to describe changes and validation.

Use Node.js 22.13+ or current 24/26, then `npm ci --ignore-scripts` and `npm run check`. Runtime: Node.js 22+. No token is needed for development or scanning.

Keep PRs focused. Describe the problem, a reproduction, resulting behavior, limitations and relevant validation. All checks must pass on Windows/Linux. Never add real credentials, private source excerpts or generated dependencies.

## Rules

Edit `rules/github-oauth.json` or `rules/github-app.json`, keeping their authorization models separate. Each rule needs a unique ID, HTTP method, normalized endpoint, Octokit mapping, alternatives (OR of AND scope sets), applicability condition, confidence, rationale, official documentation and verification date. Do not translate GitHub App permission tables into OAuth scopes. App rules need documented permission domains, levels, token types and applicability conditions. See [the App guide](docs/github-apps.md).

Add positive, insufficient, public/private/unknown and hierarchy tests as appropriate. Uncertain behavior stays unknown. Implication edges require separate evidence; similar names are insufficient. Bump the catalog version and update docs.

## Tests and scanner

Scanner changes belong in `src/scanner/`; route/scope rules belong in the catalog. Add regression tests and small synthetic fixtures to `tests/fixtures/`. Fixtures are parsed, never run. Test aliases, overrides, locations and nonmatches as well as matches. Use sentinels rather than real credentials.

Run `npm run check`, `npm run smoke` and `npm audit --audit-level=moderate`. Synchronize both READMEs. Breaking JSON changes require a schema-version change and updated schema/tests.

## Security

Use [SECURITY.md](SECURITY.md) for private reports; do not put secret-bearing reproductions in public issues.
