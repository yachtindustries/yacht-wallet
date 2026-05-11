import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import path from 'node:path';
import manifest from './manifest.config';

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
    // Prefer .ts over any committed/leftover .js sibling. Vite's default
    // ordering is .js before .ts, which would silently ship outdated code
    // if a stale compiled .js sits next to a freshly-edited .ts.
    extensions: ['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs', '.cjs', '.json'],
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: false,
    rollupOptions: {
      input: { popup: 'index.html' },
    },
  },
  // Strip console.* and debugger statements from the production bundle so a
  // stray log inside ethers/dependencies can't leak addresses, balances, or
  // request/response shapes to anyone with devtools open. Setting these
  // explicitly (rather than relying on defaults) makes a future regression
  // visible in the diff.
  esbuild: {
    drop: ['console', 'debugger'],
  },
  server: { port: 5173, strictPort: true, hmr: { port: 5173 } },
  define: { global: 'globalThis' },
});
