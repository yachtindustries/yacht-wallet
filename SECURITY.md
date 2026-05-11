# Yacht Security

This document describes Yacht's threat model — what the wallet defends
against, what it does **not** defend against, and what users and operators
must do to use it safely.

_Last updated: 2026-05-10_

## TL;DR for users

- Use a strong password (≥ 12 characters, mixed character classes).
- **Back up your recovery phrase** in Accounts → Reveal recovery phrase. If
  you lose your password and your phrase backup, your funds are
  unrecoverable.
- Treat your computer as part of your wallet. Malware on your machine can
  read Yacht's memory.
- For balances above what you'd be comfortable losing, **use a hardware
  wallet**. Software-only wallets cannot protect against a fully compromised
  machine.
- Verify every dApp transaction in the popup before approving — especially
  `to`, `value`, the parsed call data, and any warnings.

## TL;DR for operators

If you intend to ship Yacht to "real users with real money," **do not
skip**:

1. A professional security audit (Trail of Bits / OpenZeppelin / ConsenSys
   Diligence). Budget $30k–$200k and 4–8 weeks.
2. A live bug bounty program (Immunefi or similar) running for at least
   3 months at meaningful payout tiers before mainnet promotion.
3. Hardware-wallet integration (Ledger). A software-only wallet has a
   ceiling on the value it can safely hold.
4. A maintained dependency security pipeline (`npm audit`, Dependabot,
   signed releases).
5. Operational security plan including key rotation, incident response, and
   compliance review for your jurisdiction.

This document covers the code-level defences in the current codebase. Code
can only do so much; the items above are non-negotiable for production.

---

## Threat model

### In scope (we defend against these)

| Threat | Defence |
| --- | --- |
| Offline brute-force of vault | AES-256-GCM with **Argon2id** (m=64 MiB, t=3, p=1 — OWASP 2024). Memory-hard KDF; a $1k GPU drops from ~2,000 PBKDF2 guesses/sec to ~30 Argon2id guesses/sec. Per-encryption random salt. Strong password required. Legacy v1 PBKDF2 vaults still decrypt and are transparently re-encrypted with Argon2id on next unlock. |
| Online brute-force of unlock | Exponential backoff after 5 failed attempts. |
| Unauthorized RPC sender | Background only honours messages where `sender.id === chrome.runtime.id`. External extensions and web pages cannot reach vault RPCs directly. |
| dApp origin spoofing | dApp `origin` is derived **only** from `sender.origin` / `sender.url` in the background. The request body's `origin` field is ignored. |
| Cross-account dApp signing | The background overwrites `tx.from` with the active account before signing. A malicious dApp cannot trick you into signing for a different account. |
| Wrong-chain transactions | `wallet_switchEthereumChain` and `wallet_addEthereumChain` only succeed for ApeChain (`0x8173`); other chain ids are refused. |
| Slippage abuse | Swap execute path validates `slippageBps ∈ [0, 2000]` (max 20%) in the background. |
| In-page provider response forgery | Inpage provider uses 128-bit cryptographically random message IDs. A page script that doesn't see the request cannot forge a matching reply. |
| Cross-frame postMessage | Content script rejects messages whose `source !== window` or `origin !== window.location.origin`. |
| Plaintext password leak | The user's password is **never** mirrored. Only the derived AES-256 key bytes + KDF salt are kept in `chrome.storage.session` (in-memory, never disk-flushed). MV3 service-worker restarts rehydrate from this, re-arm the auto-lock alarm against the user's configured `autoLockMinutes`, and have an independent 1 h hard cap. Auto-lock alarm clears in-memory key, session blob, and pending submission queues. |
| Atomic password change | Cached password is updated **after** vault rewrite succeeds. A wrong-password attempt cannot poison the cache. |
| Per-origin popup spam | Maximum 3 pending dApp requests per origin. |
| Per-origin RPC fingerprinting | Leaky-bucket RPC budget per origin (120 calls / minute). |
| `eth_getLogs` / `eth_call` payload abuse | dApp passthrough validates parameters: `eth_getLogs` ranges over 10 000 blocks are rejected; `eth_call` calldata over 256 KB is rejected. Stateful filter methods (`eth_newFilter`, `eth_*FilterChanges`, etc.) are not in the passthrough whitelist. |
| Single-RPC outage taking the wallet offline | `getProvider` wraps a primary + ordered fallback list of ApeChain RPCs and fails over on transport-layer error (network, timeout, 5xx). Application errors like `execution reverted` are passed through unchanged. |
| White-screen mid-signing | The popup tree is wrapped in a React `ErrorBoundary` that surfaces a recovery card (with a Reload button) instead of a blank window. Stray async rejections in popup and SW are logged via `unhandledrejection` listeners. |
| Generic error leakage | Errors returned to dApps are sanitised — no stack traces, no internal field names. |
| Remote code execution via CSP | Strict `extension_pages` CSP: `script-src 'self'` only, no `unsafe-eval`, no `unsafe-inline`. `object-src 'none'`. `base-uri 'self'`. `form-action 'none'`. `connect-src 'self' https: wss:` is intentionally broader than the read-only allowlist would be — NFT contracts return arbitrary `tokenURI` hosts, and pinning a fixed list breaks images for any future token. The wallet never POSTs vault material outbound; the only outbound traffic is the JSON-RPC and metadata reads listed in PRIVACY.md. We document this trade-off here so the broader `connect-src` is not mistaken for an oversight. |
| Third-party script supply chain | Roboto font is bundled (`@fontsource/roboto`); no Google Fonts CDN. No remote scripts at runtime. |
| IDN homograph dApps | Connect popup flags non-ASCII / punycode hostnames. |

### Out of scope (we cannot defend against these — accept or layer)

| Threat | Mitigation outside this code |
| --- | --- |
| Malware on the user's machine reading service-worker memory or scraping the keyboard | Use a hardware wallet for high-value accounts. |
| Browser zero-days that bypass extension isolation | Keep Chrome up to date. Run sensitive accounts in a dedicated browser profile. |
| Compromised RPC endpoint | Use your own ApeChain RPC. Verify large transactions on Apescan. |
| Compromised npm dependency (ethers, react, etc.) | Pin lockfile, `npm audit`, Dependabot, signed releases. |
| User installs a malicious extension that interacts with Yacht | Chrome's extension model isolates extensions, but a side-channel attacker can in theory inspect message traffic. Run as few extensions as possible. |
| Phishing dApp the user explicitly approves | We surface domain + warnings, but the user can override. Education is the real defence. |
| Lost recovery phrase / lost password | There is no recovery. This is the cost of self-custody. |

## Concrete defences in code

| Defence | File |
| --- | --- |
| AES-GCM + Argon2id (v2) / PBKDF2 600k legacy decrypt (v1) | `src/lib/crypto.ts` |
| Vault encryption / re-write | `src/lib/vault.ts` |
| Sender + origin validation | `src/background/index.ts` (`isFromExtension`) |
| Forced `tx.from = active` | `src/background/index.ts` `dapp.signTx` handler |
| Unlock backoff | `src/background/index.ts` (`unlockTryAllowed`) |
| Per-origin RPC budget | `src/background/index.ts` (`originRpcBudget`) |
| Slippage cap | `src/background/index.ts` `swap.execute` |
| Random message IDs | `src/inpage/index.ts` (`randomId`) |
| postMessage source/origin checks | `src/content/index.ts`, `src/inpage/index.ts` |
| CSP | `manifest.config.ts` `content_security_policy.extension_pages` |
| Connected sites revoke UI | `src/popup/screens/ConnectedSites.tsx` |
| Tx parsing + warnings | `src/lib/signing-detect.ts`, `src/popup/screens/RequestApproval.tsx` |
| Generic error sanitisation | `src/content/index.ts` (`sanitizeErr`), `src/background/index.ts` (`safeError`) |

## Known limitations and roadmap

| Limitation | Plan / mitigation |
| --- | --- |
| No hardware-wallet integration | Add Ledger Ethereum app support. **Required before high-value mainnet use.** |
| `host_permissions: <all_urls>` injects on every page | Move to user-triggered injection (`activeTab` + click) once dApp ecosystem matures. |
| In-page provider can be inspected by page scripts | Inherent to postMessage providers. We make replies unforgeable but not unobservable. |
| No LavaMoat / SES bundle isolation | Adds significant build complexity — defer until after first audit. Strict CSP closes the most important runtime holes. |
| No encrypted backup/sync | Add optional encrypted seed-vault export to a user-controlled file. |
| Phishing list is small, hard-coded | Replace with a maintained signed feed fetched periodically. |
| No automatic dependency vulnerability monitoring | Add Dependabot + scheduled `npm audit` in CI. |
| No CI / signed releases | Set up GitHub Actions signing the build with cosign or similar. |

## Mobile (Capacitor / Android) threat model

The mobile app reuses the same TypeScript core (vault, signing, dApp RPC
validation) as the extension; everything in the table above applies.
What's different on mobile:

### At-rest defences

| Layer | Defence |
| --- | --- |
| **Inner vault encryption** | Same AES-256-GCM + Argon2id (m=64 MiB, t=3, p=1) as the extension — the encrypted blob is identical bytes-on-disk to the desktop version. |
| **Outer Keystore wrap** *(Android only)* | Before the encrypted blob is written to `SharedPreferences`, it is wrapped a SECOND time with an AES-256-GCM key generated and held inside the Android Keystore. StrongBox-backed on devices that have it (Pixel 3+, Galaxy S20+); TEE-backed on every other Android. The Keystore key never leaves the secure hardware — the app receives `Cipher` handles only. **Result**: an attacker who copies the vault file off the device cannot even *start* a brute-force on the password, because they can't strip the outer wrap without running code inside this app on this same device. |
| **No Android backup** | `android:allowBackup="false"`, `android:fullBackupContent="false"`, and `data_extraction_rules.xml` exclude every storage domain (`root`, `file`, `database`, `sharedpref`) from cloud backup AND device-to-device transfer. The vault is intentionally not portable across devices — users must use the recovery phrase. |
| **Backups disabled at app level too** | `chrome.storage.session` (cached AES key + decrypted vault) maps to an in-memory Map on mobile, never written to disk. |

### In-transit defences

| Defence | Detail |
| --- | --- |
| **Cleartext traffic blocked at OS level** | `network_security_config.xml` sets `cleartextTrafficPermitted="false"` and `<trust-anchors><certificates src="system" /></trust-anchors>` only — user-installed CAs (e.g. corporate MITM profiles) are NOT trusted. |
| **TLS for every endpoint** | RPC, dexscreener, opensea, IPFS gateways all served over HTTPS. |

### In-use defences

| Defence | Detail |
| --- | --- |
| **FLAG_SECURE** | `MainActivity.onCreate` sets `WindowManager.LayoutParams.FLAG_SECURE` before `super.onCreate`, so the wallet **cannot** be screenshotted, screen-recorded, or appear in the Recent Apps thumbnail. The seed-phrase reveal screen, address bar, balances — none of it leaks via system snapshots. |
| **Lock-on-background** | When the app loses foreground (`appStateChange.isActive=false` from `@capacitor/app`), the vault locks immediately. The user must re-enter their password to use the wallet again. This is stricter than the desktop auto-lock alarm. |
| **Memory hygiene** | Cached AES key bytes are `Uint8Array.fill(0)`-zeroed before the reference is cleared, so a JS heap dump after lock cannot recover the key. |
| **R8 minification & obfuscation** | Release builds run R8 with `proguard-android-optimize.txt`, stripping field/method names and removing dead code from the Java/Kotlin layer. The JS bundle is separately minified by Vite/esbuild with `drop: ['console','debugger']`. |
| **Debuggable disabled in release** | `debuggable false` on the release build type, so a stolen device can't be `adb`-attached without re-signing the APK. |
| **Portrait-locked Activity** | Avoids landscape-only quirks; reduces UI surface area for rendering bugs that could expose secret data. |

### Mobile-specific out-of-scope items

| Threat | Plan |
| --- | --- |
| Rooted device + active malware running as root | Effectively no defence is possible. Users running a rooted phone should be assumed to have weakened security boundaries; recommend a hardware wallet. |
| Biometric unlock | Not yet wired up. v0.2 will add an optional second Keystore key gated on `setUserAuthenticationRequired(true)` so users can unlock with fingerprint/face after the first password setup, without ever skipping the underlying password. |
| iOS port | Capacitor project exists; the SecureStorage plugin currently has only an Android implementation. iOS implementation will use Keychain Services with `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` + `SecAccessControl` (biometric optional). |
| Hardware-wallet integration | Same as desktop — Ledger via WebHID isn't supported on mobile WebView. Plan: Bluetooth Ledger via a custom Capacitor plugin. |

## Reporting a vulnerability

If you find a security issue, please report it privately. Do **not** open a
public GitHub issue. Email the maintainer or use the project's security
advisory channel. We will acknowledge within 72 hours.
