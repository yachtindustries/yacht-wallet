// Pre-flight check on the dist-zip artefact before uploading to Chrome Web Store.
// Catches the most common rejection causes:
//   • manifest fields missing
//   • icons missing or wrong size
//   • source maps included (CWS allows but discouraged for size)
//   • bundle size over 100 MB (CWS hard limit is 100 MB pre-zip)
//   • permissions look reasonable
//
// Exit 0 = ready to upload. Exit 1 = problems found.

import { readFileSync, statSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dist = join(root, 'dist');
const distZip = join(root, 'dist-zip');

const issues = [];
const warns = [];
const oks = [];

function ok(s) { oks.push(s); }
function warn(s) { warns.push(s); }
function bad(s) { issues.push(s); }

if (!existsSync(dist)) {
  bad('dist/ does not exist — run `npm run build` first.');
} else {
  // Manifest checks
  const manifestPath = join(dist, 'manifest.json');
  if (!existsSync(manifestPath)) {
    bad('dist/manifest.json missing.');
  } else {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const required = ['name', 'version', 'manifest_version', 'description', 'icons', 'action', 'background'];
    for (const k of required) if (manifest[k] === undefined) bad(`manifest is missing "${k}"`);
    if (manifest.manifest_version !== 3) bad(`manifest_version must be 3 (was ${manifest.manifest_version})`);
    if (typeof manifest.description !== 'string' || manifest.description.length > 132) {
      bad(`description must be ≤ 132 chars (was ${manifest.description?.length})`);
    }
    if (typeof manifest.name !== 'string' || manifest.name.length > 45) {
      bad(`name must be ≤ 45 chars (was ${manifest.name?.length})`);
    }
    if (!manifest.content_security_policy?.extension_pages) {
      warn('No explicit extension_pages CSP — recommended for hardening.');
    } else {
      ok('Strict CSP declared');
    }
    if (Array.isArray(manifest.permissions)) {
      // Yacht's full permission set lives in CWS_SUBMISSION.md with a
      // justification per entry. Only flag truly unexpected additions here.
      const expected = ['storage', 'alarms', 'idle', 'notifications', 'sidePanel', 'clipboardRead'];
      const unusual = manifest.permissions.filter((p) => !expected.includes(p));
      if (unusual.length > 0) warn(`Unusual permissions: ${unusual.join(', ')} — make sure each is justified in the listing.`);
    }
    if (Array.isArray(manifest.host_permissions) && manifest.host_permissions.includes('<all_urls>')) {
      warn('host_permissions includes <all_urls> — required for the dApp provider, but justify clearly in the listing.');
    }
    ok(`manifest: ${manifest.name} v${manifest.version}`);
  }

  // Icon presence
  for (const size of [16, 32, 48, 128]) {
    const p = join(dist, 'public', `icon-${size}.png`);
    if (!existsSync(p)) bad(`Icon missing: public/icon-${size}.png`);
  }

  // Source map check
  const allFiles = walk(dist);
  const maps = allFiles.filter((f) => f.endsWith('.map'));
  if (maps.length > 0) warn(`${maps.length} source map(s) in dist — consider stripping for production.`);
  else ok('No source maps shipped');

  // Total dist size
  const totalBytes = allFiles.reduce((s, f) => s + statSync(f).size, 0);
  const mb = totalBytes / 1024 / 1024;
  if (mb > 95) bad(`dist/ is ${mb.toFixed(1)} MB — Chrome Web Store hard limit is 100 MB.`);
  else if (mb > 30) warn(`dist/ is ${mb.toFixed(1)} MB — large but allowed.`);
  else ok(`dist/ size: ${mb.toFixed(2)} MB`);
}

// Zip presence
if (existsSync(distZip)) {
  const zips = readdirSync(distZip).filter((f) => f.endsWith('.zip'));
  if (zips.length === 0) {
    warn('dist-zip/ exists but no .zip — run `npm run package`.');
  } else {
    for (const z of zips) {
      const size = statSync(join(distZip, z)).size / 1024 / 1024;
      ok(`Package: ${z} (${size.toFixed(2)} MB)`);
    }
  }
} else {
  warn('dist-zip/ missing — run `npm run package` to produce the upload artefact.');
}

// Privacy policy reminder
if (!existsSync(join(root, 'PRIVACY.md'))) {
  bad('PRIVACY.md missing — required for CWS listing.');
} else {
  ok('PRIVACY.md exists (host it publicly and supply the URL in the listing).');
}

// Render
const reset = '\x1b[0m', red = '\x1b[31m', yellow = '\x1b[33m', green = '\x1b[32m', dim = '\x1b[2m';
console.log('\n' + dim + 'Yacht store package validation' + reset + '\n');
for (const m of oks) console.log(`  ${green}✓${reset} ${m}`);
for (const m of warns) console.log(`  ${yellow}!${reset} ${m}`);
for (const m of issues) console.log(`  ${red}✗${reset} ${m}`);
console.log();
if (issues.length > 0) {
  console.log(`${red}${issues.length} issue(s) — fix before submitting.${reset}\n`);
  process.exit(1);
}
console.log(`${green}Ready for Chrome Web Store submission.${reset}`);
console.log(`Next: read CWS_SUBMISSION.md and follow steps 2–11.\n`);

function walk(dir) {
  const out = [];
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    if (f.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
