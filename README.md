# Yacht

A self-custodial browser-extension wallet for **ApeChain** (chain id `33139`).
Send and receive APE, hold any ERC-20, swap tokens, view your NFTs, and connect
to ApeChain dApps. Your keys never leave your device.

## Features

- Send and receive native APE plus any ApeChain ERC-20
- In-wallet swaps routed through Camelot V2
- Token discovery via DexScreener (trending + search by symbol or address)
- NFT gallery for ERC-721s held on ApeChain
- Multi-account: create new accounts from your recovery phrase or import a private key
- dApp connectivity via injected `window.yacht` / EIP-1193 `window.ethereum` + EIP-6963 announcement
- Per-origin connection management; revoke at any time
- Live APE price + 24h change via DexScreener / CoinGecko

## Security

- Argon2id password KDF (m=64 MB, t=3, p=1) + AES-256-GCM vault encryption
- Encrypted vault stored in `chrome.storage.local`; unlocked vault mirrored to
  `chrome.storage.session` so the MV3 service worker can sleep without
  appearing to lock the wallet, but never written to disk
- Auto-lock after a configurable inactivity window (default 15 min)
- Strict Content Security Policy: no remote scripts, no inline JS, no `eval`
- dApp transactions are parsed and explained before signing, with explicit
  warnings on high-risk patterns (drainer permits, max approvals, contract
  interactions)
- `tx.from` is always forced to the active account — a dApp cannot trick you
  into signing for a different one
- No analytics, no telemetry, no remote code

See [`SECURITY.md`](SECURITY.md) for the full threat model.

## Install (developer mode)

1. `npm install`
2. `npm run build`
3. Open `chrome://extensions`, toggle **Developer mode** on, click
   **Load unpacked**, select the `dist/` folder.

## Develop

```bash
npm install
npm run dev       # vite dev server with HMR; reload the extension to pick up changes
npm run build     # production build into dist/
npm run package   # production build + zip into dist-zip/
npm run validate  # pre-flight check on dist/ before submission
```

## Project layout

```
src/
  background/   service worker — message router, vault, signing, RPC handlers
  content/      content script — bridges page postMessage to background RPC
  inpage/       injected provider — exposes window.yacht + window.ethereum
  popup/        React UI (Tailwind)
  lib/          shared modules — vault, evm client, networks, swap, etc.
public/         icons, nav assets, action icons
manifest.config.ts  CRX-friendly MV3 manifest source (compiled by vite)
```

## Network

Yacht ships configured for ApeChain mainnet only:

| | |
|---|---|
| Chain id | `33139` (`0x8173`) |
| RPC | `https://rpc.apechain.com` |
| Explorer | `https://apescan.io` |
| History API | Etherscan V2 (`api.etherscan.io/v2/api?chainid=33139`) |

## License

MIT — see [`LICENSE`](LICENSE).
