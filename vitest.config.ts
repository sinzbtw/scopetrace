import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], coverage: {
 provider: 'v8', include: ['src/**/*.ts'], exclude: ['src/cli/main.ts'],
 reporter: ['text', 'json-summary', 'html'], thresholds: { lines: 85, functions: 85, statements: 85, branches: 75 }
} } });
