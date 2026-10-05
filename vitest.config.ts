import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'scripts/**/*.test.mjs'],
    exclude: ['**/node_modules/**'],
    environment: 'node',
  },
});
