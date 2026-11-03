# Related work

ScopeTrace compares declared OAuth permissions with supported API operations in JavaScript and TypeScript. Its catalogs use official provider documentation; related tools do not establish permission requirements for this analyzer.

- [Cerberus](https://arxiv.org/abs/2110.01005) studies logical vulnerabilities in OAuth provider implementations.
- [IAM Privilege Guard](https://github.com/Alongiti2/iam-privilege-guard) compares AWS permissions against observed usage.

These projects address different authorization models. ScopeTrace's rule sources, verification dates and unsupported cases are documented in [Rule catalogs](rules.md).
