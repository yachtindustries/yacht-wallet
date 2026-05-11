import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Mobile (Capacitor) build. Drops the @crxjs/vite-plugin chrome-extension
// pipeline, the background service worker, and the content/inpage scripts —
// none of which exist on iOS / Android. Emits a plain SPA into dist-mobile/
// which `npx cap sync` copies into the native iOS and Android projects.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
    extensions: ['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs', '.cjs', '.json'],
  },
  build: {
    // esnext is required for the top-level `await import('./mobile-rpc')`
    // in src/popup/main.tsx. Capacitor's WKWebView (iOS 16.4+) and
    // Android System WebView (Chromium 89+) both support it.
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: false,
    outDir: 'dist-mobile',
    emptyOutDir: true,
    rollupOptions: {
      input: { popup: 'index.html' },
    },
  },
  esbuild: {
    drop: ['console', 'debugger'],
  },
  define: {
    global: 'globalThis',
    // Lets src/ branch on the platform without runtime detection. Extension
    // builds leave this undefined so the existing chrome.* paths run.
    'import.meta.env.YACHT_PLATFORM': JSON.stringify('mobile'),
  },
  server: { port: 5173, strictPort: true, hmr: { port: 5173 } },
});
