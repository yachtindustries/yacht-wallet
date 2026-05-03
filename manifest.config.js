import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json';
export default defineManifest({
    manifest_version: 3,
    name: 'Yacht',
    description: 'Yacht — self-custody wallet for ApeChain. Send, receive, swap APE & ERC-20 tokens.',
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
            resources: ['public/logo.png', 'public/nav/*.png', 'public/actions/*.png'],
            matches: ['<all_urls>'],
        },
    ],
    permissions: ['storage', 'alarms'],
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
            "connect-src 'self' https://rpc.apechain.com https://apechain.calderachain.xyz https://apechain.calderaexplorer.xyz https://apechain-mainnet.g.alchemy.com https://api.apescan.io https://api.etherscan.io https://api.dexscreener.com https://api.coingecko.com https://ipfs.io https://gateway.pinata.cloud https://cloudflare-ipfs.com https://nftstorage.link https://arweave.net",
            "frame-src https://dexscreener.com",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'none'",
        ].join('; '),
    },
});
