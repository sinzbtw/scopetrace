import tseslint from 'typescript-eslint';
export default tseslint.config(
 { ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'tests/fixtures/**', 'examples/**'] },
 ...tseslint.configs.recommended,
 { rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } }
);
