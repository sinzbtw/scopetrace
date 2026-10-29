import { Octokit as GitHub } from '@octokit/rest';
const api = new GitHub();
api.rest.users.listEmailsForAuthenticatedUser();
api.request('DELETE /repos/{owner}/{repo}', { owner: 'example', repo: 'sample' });
fetch('https://api.github.com/repos/example/sample');
