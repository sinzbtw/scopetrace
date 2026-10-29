---
name: Authorization rule or detection correction
about: Request a verified OAuth/App permission rule or report an incorrect finding.
title: "[Rule]: "
labels: enhancement
assignees: ""
---

English and Russian reports are welcome. State whether the report concerns github-oauth scopes or github-app permissions. These models and fine-grained PATs are not equivalent evidence.

For security-sensitive findings, use [private reporting](https://github.com/sinzbtw/scopetrace/security/advisories/new).

## Operation

- HTTP method and endpoint template:
- Octokit method, if applicable:
- Existing rule ID, if applicable:

## Official authorization evidence

Link to the official GitHub endpoint and OAuth scope documentation. Quote only the short relevant requirement; explain whether it is specific to OAuth Apps or GitHub Apps.

## Scope requirements and conditions

Describe alternative scopes or domain-specific read/write permissions, accepted App token types, public/private resource behavior, extra conditions, and unresolved uncertainty. If the requirement cannot be verified, say so.

## Minimal synthetic example

Include a small JS/TS call, sanitized declaration, expected finding, and actual finding if any. Never include real credentials, private repository identifiers, or private source code.

## Checks

- [ ] The cited token model is explicit.
- [ ] I removed secrets and private information.
- [ ] I read the [Code of Conduct](https://github.com/sinzbtw/scopetrace/blob/main/CODE_OF_CONDUCT.md).
