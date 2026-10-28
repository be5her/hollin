import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'src/main/*.test.ts', 'scripts/**/*.test.mjs'],
    // `*.manual.test.ts` files write samples for checks outside the app; they run only when asked (see the exchange README).
    exclude: ['**/node_modules/**', ...(process.env.EXCHANGE_SAMPLES_DIR ? [] : ['**/*.manual.test.ts'])],
    environment: 'node',
  },
});
