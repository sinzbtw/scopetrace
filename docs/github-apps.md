# GitHub App permissions

ScopeTrace 0.2 adds a separate provider, `github-app`, for GitHub App read/write permissions. This is not an OAuth-scope or fine-grained-PAT conversion.

## Configuration

```json
{
  "provider": "github-app",
  "tokenType": "installation",
  "declaredPermissions": {
    "repository": {
      "contents": "write",
      "issues": "read",
      "metadata": "read"
    },
    "organization": {},
    "account": {}
  },
  "repositoryVisibility": "private",
  "include": ["src/**/*.{js,jsx,ts,tsx}"],
  "exclude": ["**/*.test.*", "**/*.spec.*"]
}
```

Create a starter with `scopetrace init --provider github-app`. Token type is explicitly required: installation or user. Scan selects its model from JSON; there is no scan-time provider override. `declaredScopes` is rejected for App configs, and `declaredPermissions` is rejected for OAuth configs.

Permission names are normalized ScopeTrace keys grouped by domain, not a GitHub manifest import format. Supported keys: repository contents, issues, pull_requests, administration, metadata, workflows; organization members; account emails, followers, gists. Other names are rejected rather than silently assumed. Levels are read/write; workflows accepts only write because its documented API grant is write-only. Domains omitted inside declaredPermissions default to empty objects. An omitted permission is an undeclared grant, not a lookup of actual credentials.

## Evaluation

- Write covers read only for the same name in the same domain.
- Missing permissions or read where write is required produce insufficient findings with required/declared levels and rule evidence.
- Covered operations produce observed findings. Unused grants and write grants with only observed read use produce possibly_excessive findings, always low confidence.
- Alternatives are OR-of-AND sets. The analyzer considers every documented alternative before suggesting a downgrade; it does not claim to compute a globally minimal permission set.
- Installation tokens cannot be fixed by adding account permissions when the endpoint requires a GitHub App user token. Such operations produce insufficient findings explaining the token-kind mismatch.
- Public modeled repository reads need no permission. Private reads use the documented alternatives with medium confidence, since visibility is supplied by the user. Unknown visibility remains unknown.
- Metadata omission remains unknown because effective metadata access may be implicit. Metadata read is never suggested for removal solely because no use was found.
- Organization membership detail reads/writes are modeled. Listing organization members stays unknown because public/private membership intent is not inferred.
- File writes require Contents write. Their extra Workflows write requirement can depend on the target path. If Contents write is covered but Workflows write is absent, the result stays unknown; no workflow grant is demanded without path evidence. Declaring both covers the modeled permission combinations, without proving both are necessary.

The example config and fixture yield both insufficient repository.issues=read for issue creation and a low-confidence suggestion to review repository.contents=write for a read-only content call.

## Commands and reports

```sh
scopetrace init --provider github-app
scopetrace rules --provider github-app
scopetrace scan --format json
scopetrace scan --fail-on high
```

App JSON reports use schemaVersion 2.0.0 and [their own schema](../schemas/github-app-report.schema.json). They expose declaredPermissions and tokenType, not declaredScopes or normalizedScopes. Findings include permissionAlternatives, optional permission identity, declaredLevel, requiredLevel and suggestedLevel. OAuth JSON remains schemaVersion 1.0.0 with its original fields.

Text and Markdown identify the provider and explain permission levels. CI thresholds still block only sufficiently confident insufficient findings; potential excess and unknown results do not automatically block CI.

## Boundaries and sources

No token is read, no GitHub request is made, and no code is executed during scans. All calls are compared with one declaration/token kind. Effective grants, installation repository selection, approvals, user roles, webhook subscriptions, dynamically acquired clients and credential identity are not verified. Webhooks can justify a permission even without an API call.

Rules use the official [GitHub App permission matrix](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps) and endpoint docs. See [catalog](../rules/github-app.json) for per-rule sources and dates. No GitHub Actions YAML or PAT permission model is inferred.
