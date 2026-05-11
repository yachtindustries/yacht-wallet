# Yacht

A self-custodial **browser-extension and Android** wallet for **ApeChain**
(chain id `33139`). Send and receive APE, hold any ERC-20, swap tokens, view
your NFTs, and connect to ApeChain dApps. Your keys never leave your device.

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

- **Argon2id** password KDF (m=64 MB, t=3, p=1) + **AES-256-GCM** vault encryption
- **Mobile (Android):** the encrypted vault is wrapped a SECOND time with
  an AES-256-GCM key inside the **Android Keystore** (StrongBox secure
  element when the device has it; TEE-backed otherwise). The Keystore key
  never leaves secure hardware, so an exfiltrated vault file cannot even
  be brute-forced off-device.
- **Mobile (Android):** `FLAG_SECURE` blocks screenshots, screen-recording,
  and Recent-Apps thumbnails of the wallet; lock-on-background;
  `allowBackup="false"` + Android 12+ data-extraction-rules so the vault
  can never appear in cloud backups or device-to-device transfers.
- Cached AES key bytes are explicitly zero-filled before being released
- Auto-lock after a configurable inactivity window (default 15 min)
- Strict Content Security Policy: no remote scripts, no inline JS, no `eval`
- dApp transactions are parsed and explained before signing, with explicit
  warnings on high-risk patterns (drainer permits, max approvals, contract
  interactions)
- `tx.from` is always forced to the active account — a dApp cannot trick you
  into signing for a different one
- No analytics, no telemetry, no remote code

See [`SECURITY.md`](SECURITY.md) for the full threat model and
[`MOBILE_RELEASE.md`](MOBILE_RELEASE.md) for Play Store submission steps.

## Install (developer mode)

1. `npm install`
2. `npm run build`
3. Open `chrome://extensions`, toggle **Developer mode** on, click
   **Load unpacked**, select the `dist/` folder.

## Develop

### Browser extension

```bash
npm install
npm run dev       # vite dev server with HMR; reload the extension to pick up changes
npm run build     # production build into dist/
npm run package   # production build + zip into dist-zip/
npm run validate  # pre-flight check on dist/ before submission
```

### Mobile (Capacitor — Android, iOS scaffolded)

```bash
npm install
npm run build:mobile   # SPA build into dist-mobile/ (no @crxjs)
npm run sync:mobile    # build + cap sync into native shells
npm run android        # sync + open Android Studio (need Android Studio installed)
npm run ios            # sync + open Xcode (need full Xcode installed)
```

To build a debug APK for sideloading without Android Studio:

```bash
export JAVA_HOME=$HOME/.tools/jdk-21.0.11+10/Contents/Home
export ANDROID_HOME=$HOME/Library/Android/sdk
cd android && ./gradlew assembleDebug
# APK at android/app/build/outputs/apk/debug/app-debug.apk
```

For a signed release AAB ready for Play Store: see
[`MOBILE_RELEASE.md`](MOBILE_RELEASE.md).

## Project layout

```
src/
  background/   service worker — message router, vault, signing, RPC handlers
  content/      content script — bridges page postMessage to background RPC (extension only)
  inpage/       injected provider — exposes window.yacht + window.ethereum (extension only)
  popup/        React UI (Tailwind)
  lib/
    crypto.ts        Argon2id + AES-GCM primitives (shared)
    vault.ts         vault read/write (shared)
    mobile-shim.ts   chrome.* polyfill on Capacitor (mobile only)
    mobile-rpc.ts    in-process RPC bridge replacing the extension service worker (mobile only)
    ...              evm client, networks, swap, etc.
public/         icons, nav assets, action icons
android/        Capacitor Android project + custom SecureStorage Keystore plugin
ios/            Capacitor iOS project (scaffolded; not yet shipping)
capacitor.config.ts    Capacitor config (mobile)
manifest.config.ts     CRX-friendly MV3 manifest source (extension)
vite.config.ts         Extension build (with @crxjs)
vite.mobile.config.ts  Mobile SPA build (no @crxjs)
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
