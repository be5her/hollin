import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'src/main/*.test.ts', 'scripts/**/*.test.mjs'],
    exclude: ['**/node_modules/**'],
    environment: 'node',
  },
});
