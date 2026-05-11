import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json';

export default defineManifest({
  manifest_version: 3,
  name: 'Yacht',
  description: 'A Luxury Wallet, Your Home for ApeChain.',
  version: pkg.version,
  action: {
    default_popup: 'index.html',
    default_title: 'Yacht',
    default_icon: {
      '16': 'public/icon-16.png',
      '32': 'public/icon-32.png',
    },
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  content_scripts: [
    // The inpage provider runs in the page's MAIN world so it can attach
    // window.yacht / window.ethereum directly. Declaring it as its own
    // content_scripts entry lets crxjs bundle it correctly and avoids the
    // MIME-type pitfall of injecting a literal .ts URL via DOM <script>.
    {
      matches: ['<all_urls>'],
      js: ['src/inpage/index.ts'],
      run_at: 'document_start',
      all_frames: false,
      world: 'MAIN',
    },
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
      run_at: 'document_start',
      all_frames: false,
    },
  ],
  web_accessible_resources: [
    {
      resources: [
        'public/logo.png',
        'public/nav/*.png',
        'public/actions/*.png',
        // Rank avatars rendered in Accounts and Achievements screens.
        'ranks/*.png',
      ],
      matches: ['<all_urls>'],
    },
  ],
  permissions: ['storage', 'alarms', 'sidePanel', 'clipboardRead'],
  side_panel: { default_path: 'index.html?sidepanel=1' },
  host_permissions: ['<all_urls>'],
  icons: {
    '16': 'public/icon-16.png',
    '32': 'public/icon-32.png',
    '48': 'public/icon-48.png',
    '128': 'public/icon-128.png',
  },
  content_security_policy: {
    extension_pages: [
      "default-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      // Wallet RPC/dex endpoints + an open https:// allowance for NFT
      // metadata. NFT contracts return arbitrary metadata URLs; locking
      // connect-src to a fixed gateway list blocks most NFT image loads.
      // Yacht stores no secrets that can be exfiltrated to a third-party
      // host — every fetch is for a public address or a public token URI.
      "connect-src 'self' https: wss:",
      "frame-src https://dexscreener.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'none'",
    ].join('; '),
  },
});
