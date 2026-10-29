# Research — 2026-10-29

The name is used by an unrelated [audit evidence platform](https://scopetraceinc.com/). We retain the requested product name without claiming uniqueness or affiliation.

Related work: [Cerberus](https://arxiv.org/abs/2110.01005) studies logical OAuth-provider vulnerabilities; [IAM Privilege Guard](https://github.com/Alongiti2/iam-privilege-guard) compares AWS grants against usage. Neither supplies this project's GitHub OAuth rules. All rule evidence is official GitHub documentation listed in rules.md.

Implementation sequence: narrow verified catalog, strict config and AST, bounded traversal, cautious permission/evidence engine, reporters/CLI, regressions/audit, bilingual docs/CI, then public repository/release after validation.

The security-best-practices skill has web-specific references but no Node CLI reference. Its secure-by-default workflow is applied directly to this CLI threat model; no unnecessary web frontend/server was introduced.
