// Builds extension icons from public/logo.png at the sizes Chrome expects.
// Uses macOS `sips` if available; otherwise falls back to copying the source
// (Chrome will downscale at runtime).
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const out = join(root, 'public');
const src = join(out, 'logo.png');

if (!existsSync(out)) mkdirSync(out, { recursive: true });
if (!existsSync(src)) {
  console.error('public/logo.png missing — drop your logo there.');
  process.exit(1);
}

const SIZES = [16, 32, 48, 128];
let useSips = false;
try {
  execSync('which sips', { stdio: 'ignore' });
  useSips = true;
} catch {}

for (const s of SIZES) {
  const dst = join(out, `icon-${s}.png`);
  if (useSips) {
    execSync(`sips -s format png -z ${s} ${s} "${src}" --out "${dst}"`, { stdio: 'ignore' });
  } else {
    copyFileSync(src, dst);
  }
  console.log(`wrote public/icon-${s}.png`);
}
