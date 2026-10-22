// Bundles the block editor (entry.js) into public/vendor/editor.js + editor.css. Fonts stay files: the page's CSP
// allows 'self' only, so nothing is inlined as a data: URI.
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root: here,
  base: '/vendor/',
  logLevel: 'warn',
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: path.resolve(here, '../public/vendor'), emptyOutDir: true, assetsInlineLimit: 0, cssCodeSplit: false, sourcemap: false, minify: true,
    lib: { entry: path.resolve(here, 'entry.js'), formats: ['es'], fileName: () => 'editor.js', cssFileName: 'editor' },
  },
});
