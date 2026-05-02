// Bundles dist/ into a Chrome Web Store-ready ZIP.
import { execSync } from 'node:child_process';
import { readFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dist = join(root, 'dist');
const out = join(root, 'dist-zip');

if (!existsSync(dist)) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const zipName = `${pkg.name}-v${pkg.version}.zip`;
const zipPath = join(out, zipName);

if (existsSync(out)) rmSync(out, { recursive: true });
mkdirSync(out, { recursive: true });

// macOS/Linux ship `zip`. We zip the contents of dist/ (not the dir itself)
// so the ZIP root has manifest.json at top level — required by CWS.
execSync(`cd "${dist}" && zip -r "${zipPath}" . -x "*.DS_Store"`, { stdio: 'inherit' });

console.log(`\n✓ Packaged: ${zipPath}`);
console.log('\nUpload this ZIP at https://chrome.google.com/webstore/devconsole');
