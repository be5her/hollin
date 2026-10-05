import { defineConfig } from 'electron-vite';

/**
 * Runtime dependencies that stay outside the main bundle and are loaded from node_modules.
 * Keep in sync with the root package.json "dependencies", which electron-builder packages.
 */
const external = ['zod', /^zod\//, /^@modelcontextprotocol\/(server|node)/, /^node:/];

/**
 * Builds the main process and the preload script only. The renderer is an Angular application with its
 * own build (src/renderer: `ng build` into out/renderer); `npm run dev` points Electron at its dev
 * server. electron-vite's "renderer config is missing" note is expected.
 */
export default defineConfig({
  main: {
    build: {
      rollupOptions: { external },
    },
  },
  preload: {},
});
