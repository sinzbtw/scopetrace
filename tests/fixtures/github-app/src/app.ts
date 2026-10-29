import { Octokit } from '@octokit/rest';
const api = new Octokit();
api.rest.repos.getContent({ owner: 'example', repo: 'sample', path: 'README.md' });
api.rest.issues.create({ owner: 'example', repo: 'sample', title: 'Synthetic example' });
