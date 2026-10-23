// Bundles the block editor (entry.js) into public/vendor/editor.js + editor.css. Fonts stay files: the page's CSP
// allows 'self' only, so nothing is inlined as a data: URI. Excalidraw is loaded on demand (a chunk of its own), and its
// fonts are copied to public/vendor/excalidraw/fonts so it never reaches for a CDN (the CJK fallback is left out).
import { defineConfig } from 'vite';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../public/vendor');
const excalidrawFonts = () => ({
  name: 'excalidraw-fonts',
  closeBundle() {
    const entry = createRequire(import.meta.url).resolve('@excalidraw/excalidraw');   // …/dist/prod/index.js
    fs.cpSync(path.join(path.dirname(entry), 'fonts'), path.join(out, 'excalidraw', 'fonts'), { recursive: true, filter: src => !/Xiaolai/.test(src) });
  },
});

export default defineConfig({
  root: here,
  base: '/vendor/',
  logLevel: 'warn',
  plugins: [excalidrawFonts()],
  define: { 'process.env.NODE_ENV': '"production"', 'process.env.IS_PREACT': '"false"' },
  resolve: { dedupe: ['react', 'react-dom'] },
  build: {
    outDir: out, emptyOutDir: true, assetsInlineLimit: 0, cssCodeSplit: false, sourcemap: false, minify: true,
    lib: { entry: path.resolve(here, 'entry.js'), formats: ['es'], fileName: () => 'editor.js', cssFileName: 'editor' },
  },
});
