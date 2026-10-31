# Google OAuth 2.0: Gmail, Drive and Calendar

ScopeTrace 0.3 adds `provider: "google-oauth"` independently of GitHub OAuth and GitHub App permissions. Scans remain local, offline and token-free. The Google SDK does not need to be installed in the scanned project for AST recognition.

## Start and configuration

```sh
scopetrace init --provider google-oauth
scopetrace rules --provider google-oauth
# Edit the configuration before scanning.
scopetrace scan --format json
scopetrace scan --fail-on high
```

Use a built checkout or archive containing the 0.3 implementation; older release artifacts cannot scan this provider. The npm registry package remains unpublished.

```json
{
  "provider": "google-oauth",
  "declaredScopes": [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/calendar.events.readonly"
  ],
  "include": ["src/**/*.{js,jsx,ts,tsx}"],
  "exclude": ["**/*.test.*", "**/*.spec.*"],
  "googleContext": {
    "driveAccess": "unknown",
    "calendarResources": "unknown",
    "calendarData": "unknown"
  }
}
```

Context values are explicit assertions applying to all relevant calls in this scan:

- driveAccess: unknown, app-authorized (app-created/user-selected files), or app-data.
- calendarResources: unknown, owned, app-created, or public.
- calendarData: unknown, events, or availability.

Split mixed-resource uses into separate scans. Context never grants access or proves ownership. GitHub-specific scopes, permissions, tokenType and repositoryVisibility are not accepted as substitutes.

## Detection

Static global fetch URLs for the documented API roots and proven Node SDK imports are supported:

```ts
import { google as g } from 'googleapis';
const gmail = g.gmail({ version: 'v1', auth: oauthClient });
gmail.users.messages.send({ userId: 'me', requestBody: { raw: message } });
const drive = g.drive('v3');
drive.files.get({ fileId: selectedFile, alt: 'media' });
const calendar = g.calendar('v3');
calendar.events.list({ calendarId: 'primary' });

fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10');
```

ESM aliases, namespace/default module imports, CommonJS destructuring, supported const method aliases and individual @googleapis/gmail, @googleapis/drive and @googleapis/calendar factories are recognized. Supported versions are Gmail v1, Drive v3 and Calendar v3.

Global google.options, unsupported factory/request options, API-key indications, dynamic targets and recognizable custom clients stay unknown. Variable request objects, spreads, computed keys and getters are not executed or assumed safe. Some unrecognized wrappers, browser gapi, Apps Script and cross-file factories cannot be detected at all.

## Rules and conditional access

The [versioned catalog](../rules/google-oauth.json) has 22 methods with HTTP routes, SDK paths, exact scope alternatives, conditions, sources and verification date. Scope lists come from official Discovery revisions checked on 2026-10-31; a contextual scope appearing in Discovery is not an unconditional grant.

Gmail: message list/get/send/modify/trash/permanent-delete, label list/create, profile. Gmail metadata cannot authorize full/raw message bodies or q searches. Dynamic optional q/format values stay uncertain. Gmail modify does not cover immediate permanent deletion; the full mail scope is necessary for that modeled operation.

Drive: file list/get/create/update/delete. Metadata-only scopes cannot authorize content downloads/uploads. Drive file access is resource-limited; it is not globally equivalent to drive or drive.readonly. New-file creation can use drive.file, while existing-file operations need resource evidence. App-data and other constrained scopes preserve their conditions. The appfolder alias is recognized/classified but its authorization equivalence is not inferred.

Calendar: event list/get/insert/update/delete, calendar-list reads, calendar metadata reads and free/busy queries. Readonly cannot authorize event writes. Owned/app-created/public/availability scopes require the corresponding context. Public or API-key access does not become a fabricated missing OAuth permission.

Scope normalization only deduplicates and sorts known URI strings. It does not infer implication from prefixes or merge incomparable scopes. Narrower suggestions are reviewed candidates checked against every relevant modeled operation; candidates are alternatives, not instructions to add all of them. Unknown calls and runtime paths still require review.

## Sensitive and restricted scopes

Every known declared scope has a dated scopeAssessments record. Gmail and Drive classifications are taken from their official service guides, for example:

- gmail.send: sensitive.
- Full mail, gmail.readonly and broad Drive access: restricted.
- gmail.labels and drive.file: non_sensitive.

For Calendar and other URIs whose sensitivity is not established by the checked official guides, the category is unknown. It is never silently treated as non-sensitive. Confirm the current category in your consent configuration.

A sensitive/restricted label is not a vulnerability or a determination that this particular application requires verification/security assessment. Audience, publication status, data handling, exceptions and current policies matter. ScopeTrace does not query consent configuration or make compliance decisions. Classification alone does not fail the CI gate.

## Reports and safety

Google JSON uses [schemaVersion 3.0.0](../schemas/google-oauth-report.schema.json). GitHub schemas 1.0.0/2.0.0 remain unchanged. Reports include exact known declarations, scope assessments, conditional alternatives, stable evidence IDs and low-confidence suggestedScopes.

Unknown scope values are redacted and prevent firm insufficiency conclusions where they might matter. Login scopes such as openid/email/profile are outside this resource model and are not proven unnecessary. Unknown/sensitivity review findings do not block CI; only sufficiently confident insufficient findings meet fail-on thresholds.

No code runs, no token is read and no network request occurs during scan. Only categorical parameter facts are retained: response format, query presence and metadata/content intent. User IDs, addresses, file/calendar IDs, query values, bodies, headers, API keys and auth strings are omitted. Credential identity, actual grants, incremental consent, API-key/public authorization and service-account delegation are not verified.

## Sources

- [Gmail scope categories](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Drive scope categories and per-file access](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth)
- [Gmail response formats](https://developers.google.com/workspace/gmail/api/reference/rest/v1/Format)
- [Official Node SDK](https://github.com/googleapis/google-api-nodejs-client)

Per-method documentation and Discovery URLs/revisions are stored in the catalog. Development downloads of public documentation are separate from the offline scan runtime.
