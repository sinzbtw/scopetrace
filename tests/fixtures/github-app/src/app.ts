import { github as api } from './github.js';
api.rest.repos.getContent({ owner: 'example', repo: 'sample', path: 'README.md' });
api.rest.issues.create({ owner: 'example', repo: 'sample', title: 'Synthetic example' });
