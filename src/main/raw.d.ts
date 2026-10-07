/** Vite's `?raw` import: the file's text, used by the smoke to carry `fake-claude.cjs` into the packaged build. */
declare module '*?raw' {
  const text: string;
  export default text;
}
