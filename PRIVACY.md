# Privacy Policy

**Yacht** ("the Extension") is a self-custodial cryptocurrency wallet for
**ApeChain** (chain id 33139). This policy explains what data the Extension
handles and what it does *not* do.

_Last updated: 2026-05-04_

## Summary

- **No personal data is collected.** No analytics, no telemetry, no tracking.
- **No accounts. No sign-up.** The Extension does not communicate with any
  backend operated by us — there is no "us" backend.
- **Your keys never leave your device.** Your recovery phrase and private
  keys are encrypted on your computer with a password you choose and stored
  only in your browser's local storage (`chrome.storage.local`).

## Data the Extension stores locally

The following are written to `chrome.storage.local` on your device:

| Data | Purpose |
| --- | --- |
| Encrypted vault — Argon2id (m=64 MB, t=3, p=1) + AES-256-GCM | Holds your ApeChain recovery phrase and private keys |
| Public account metadata (name, address) | Display while the wallet is locked |
| Settings (network, auto-lock minutes, display currency) | Your preferences |
| Approved dApp origins | Sites you've authorized to see your address |
| Tracked tokens, cached prices, cached DexScreener data | Render the dashboard without re-fetching every open |

Additionally, while the wallet is unlocked, the unlocked vault is mirrored
into `chrome.storage.session` (a Chrome MV3 in-memory store that is **never
written to disk** and is wiped on browser restart). This is what allows the
wallet to remain unlocked across MV3 service-worker restarts within your
session, without re-deriving the password key on every restart.

This data is never transmitted anywhere. Uninstalling the Extension removes
it.

## Network requests the Extension makes

The Extension only contacts the following endpoints, and only when needed:

| Endpoint | When | Purpose |
| --- | --- | --- |
| `https://rpc.apechain.com` and `https://apechain.calderachain.xyz/http` | Whenever balances, history, swaps, or transactions are needed | ApeChain JSON-RPC (the wallet falls over to the second endpoint if the first is unreachable) |
| `https://api.etherscan.io/v2/api?chainid=33139` | Loading transaction history and NFT ownership | ApeChain transaction / ERC-721 transfer indexing via Etherscan V2 |
| `https://api.dexscreener.com` | Token discovery, prices, 24h change | Public DEX data |
| `https://api.coingecko.com` | Periodic APE price fetch | Display fiat conversions |
| Public IPFS gateways (`ipfs.io`, `gateway.pinata.cloud`, `cloudflare-ipfs.com`, `nftstorage.link`) and `arweave.net` | When loading NFT metadata | Resolve NFT image / name from `tokenURI` |

These services may log your IP address per their own policies. The Extension
sends no identifying information beyond what your browser sends to any HTTPS
endpoint.

## Permissions the Extension requests, and why

| Permission | Why it's needed |
| --- | --- |
| `storage` | Save your encrypted vault and settings locally; mirror unlocked state into `chrome.storage.session` so the wallet stays unlocked across MV3 service-worker restarts |
| `alarms` | Auto-lock the wallet after a period of inactivity |
| `sidePanel` | Optional Chrome side-panel layout — toggle from the Dashboard to pin the wallet to the side of the browser instead of opening as a floating popup. No data leaves the wallet in either mode. |
| `clipboardRead` | Powers the "paste recipient address" button on the Send screen, and reads the clipboard back after a sensitive copy (recovery phrase / private key) so the wallet can clear it. The wallet never reads the clipboard without a direct user action. |
| `host_permissions: <all_urls>` | Inject the `window.yacht` / `window.ethereum` provider so any website you visit can request to connect to your wallet (you must approve each site, and approval is per-origin and revocable) |

## What the Extension does *not* do

- It does not read or modify any web page content beyond injecting the
  wallet provider object on page load.
- It does not collect, store, transmit, or sell any personal data.
- It does not load or execute any code from a remote server. All code runs
  from the package shipped via the Chrome Web Store. Strict Content Security
  Policy enforces this at the browser level.
- It does not include third-party analytics, advertising SDKs, or
  fingerprinting scripts.

## Your responsibility

The Extension is **self-custodial**. This means you — and only you — control
the recovery phrase that grants access to your funds. If you lose your
password and your recovery-phrase backup, **no one can recover your funds**,
including the Extension's authors.

Always:
- Back up your recovery phrase in a safe place (paper or hardware backup).
- Use a strong, unique password for the Extension.
- Verify any transaction details (recipient address, amount, token, swap
  output) before approving.

## Contact

This Extension is open source. Issues and suggestions: see the project
repository.
