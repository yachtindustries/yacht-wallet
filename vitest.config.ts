import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
    // Prefer .ts source over the stale compiled .js siblings that live next
    // to each module in src/lib/ (artefacts of an earlier setup). Without
    // this, vitest resolves the .js files first and tests run against an
    // out-of-date snapshot of the codebase.
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
  },
});
