# Chrome Web Store submission checklist

Step-by-step path from a working build to a live listing. Follow top to
bottom. The validator at `npm run validate` will flag the most common
rejection causes before you upload.

## 1. Build the production ZIP

```bash
cd ~/Documents/YachtWallet
npm install            # if you haven't recently
npm run package
npm run validate
```

You should end up with `dist-zip/yacht-v0.1.44.zip` (the version comes from
`package.json`). The validator checks for: missing manifest fields, oversized
bundle, missing icons, source-map leaks, and a present privacy policy.

## 2. Privacy policy must be hosted publicly

Chrome Web Store **requires** a privacy policy URL for any extension
requesting permissions like `storage` or `host_permissions: <all_urls>`.

Easiest paths:

- **Option A — GitHub (raw file URL works)**: push the repo to GitHub, then
  paste `https://github.com/<user>/yacht-wallet/blob/main/PRIVACY.md` into
  the "Privacy policy URL" field. Chrome accepts plain GitHub URLs.
- **Option B — GitHub Pages**: enable Pages on the repo
  (`Settings → Pages → Source: main / root`). Convert `PRIVACY.md` to
  `privacy.html` (or commit a tiny `index.html` that redirects) and use
  `https://<user>.github.io/yacht-wallet/privacy.html`.
- **Option C — your own site**: any publicly reachable URL is fine.

Note the URL — you'll paste it into the Dev Console.

## 3. Screenshots

Required: at least 1, max 5. Spec: **1280×800** or **640×400** PNG/JPG.

Suggested set:

1. Dashboard with a non-trivial portfolio (APE balance + a couple of tokens
   with USD values and 24 h change visible)
2. Swap screen with a quote loaded
3. NFT tab populated with a few collections
4. Discover tab with trending tokens
5. dApp connect / sign popup

How to capture:

1. Open the popup (380×600).
2. Take a window screenshot of just the popup.
3. Composite the 380×600 popup onto a 1280×800 canvas (centered, with a
   light background — `#f6c87e` deck colour or white). Optional caption.
4. Save as PNG into `store-listing/screenshots/`.

A simple Preview / Photoshop / Figma file is enough. Keep them visually
consistent (same browser chrome, same time of day, same account name).

## 4. Promo tile (optional but recommended)

- **Small promo tile**: 440×280 PNG/JPG.
- **Marquee tile**: 1400×560 PNG/JPG.

Brand colours: water `#5eccfa`, deck `#f6c87e`. Logo at `public/logo.png`.

## 5. Developer account

- One-time **$5** registration fee at
  https://chrome.google.com/webstore/devconsole.
- Use a Google account you'll keep around — losing access to the account
  loses access to the listing.
- Strongly recommended: turn on 2FA on the account.

## 6. Create the item

1. Go to https://chrome.google.com/webstore/devconsole
2. **New item** → upload `dist-zip/yacht-v0.1.44.zip`
3. Wait for the upload to verify (a few seconds).
4. Fill in the listing — see fields below.

## 7. Listing fields

Copy/paste-ready:

| Field | Value |
| --- | --- |
| Name | `Yacht — ApeChain wallet & swaps` |
| Summary | `A Luxury Wallet, Your Home for ApeChain.` |
| Category | `Productivity` |
| Language | `English` |
| Privacy policy URL | (your hosted PRIVACY.md URL) |
| Single purpose | `Self-custodial wallet for ApeChain.` |

### Permission justifications

- **`storage`** — "Persist the encrypted vault and user settings on the
  user's device, and mirror the unlocked vault into `chrome.storage.session`
  (in-memory only) so the MV3 service worker can sleep without re-prompting
  for the password every minute. No data is transmitted."
- **`alarms`** — "Auto-lock the wallet after a configurable period of
  inactivity (default 15 minutes)."
- **`sidePanel`** — "Optional Chrome side-panel mode so users who prefer the
  wallet pinned to the side of the browser (instead of a floating popup)
  can toggle into that layout. Toggle is fully user-controlled from the
  Dashboard; no behaviour changes when in side-panel mode."
- **`clipboardRead`** — "Used by the 'paste recipient address' button on the
  Send screen, and to read back the clipboard after the user copies a
  sensitive value (recovery phrase, private key) so the wallet can clear it
  again after a short timeout. The wallet never reads the clipboard without
  a direct user action."
- **`host_permissions: <all_urls>`** — "Required to inject the
  `window.yacht` / `window.ethereum` provider on the dApps the user visits,
  so ApeChain dApps can request a connection (each connection requires
  explicit per-origin user approval and is revocable)."

### Detailed description

```
Yacht is a non-custodial browser-extension wallet for ApeChain (chain id 33139).
Your keys never leave your device.

Features
• Send and receive native APE
• Hold any ApeChain ERC-20 — auto-discovers tokens you receive
• In-wallet swaps routed through Camelot V2 on ApeChain
• NFT gallery for ERC-721s held on ApeChain
• Token discovery via DexScreener (trending + search by symbol or address)
• Multi-account: derive new accounts from your recovery phrase or import any private key
• Connects to ApeChain dApps via injected window.yacht / window.ethereum
  (EIP-1193 + EIP-6963)
• Per-origin connection management; revoke any time
• Live APE price + 24 h change on the dashboard

Security
• Argon2id password key derivation (m=64 MB, t=3, p=1) + AES-256-GCM
• Strict Content Security Policy: no remote scripts, no inline JS, no eval
• Auto-lock with exponential backoff after failed unlock attempts
• dApp transactions are parsed and explained before signing, with explicit
  warnings on high-risk patterns (unlimited approvals, drainer permits,
  contract interactions)
• tx.from is always forced to the connected account — a dApp cannot trick you
  into signing for a different one
• Per-origin RPC rate limit defends against fingerprinting loops
• Unlocked vault state is mirrored only into chrome.storage.session
  (in-memory, never written to disk)
• Open source. No analytics. No telemetry. No remote code.

This wallet is self-custodial: you alone hold your keys. Always back up your
recovery phrase.
```

## 8. Privacy practices form

In the Dev Console privacy practices form:

- For each data category Google lists (personally identifiable info,
  authentication info, financial info, etc.), the answer is **No** for
  "Collected", "Used", and "Sold/shared". Yacht does not collect any data.
- For **"I do not handle any user data"**: do not check this — we *handle*
  the encrypted vault locally, even though we don't transmit it. The
  accurate description is: "Local data only. Encrypted on-device with a
  password the user chooses. Never transmitted to us or any third party."
- Reference `PRIVACY.md` if needed.

## 9. Submit for review

Click **Submit for review**. First review usually takes **1–3 business
days**.

Common rejection reasons (and how Yacht already addresses them):

| Reason | Status |
| --- | --- |
| Excessive permissions | Only `storage` and `alarms`. `<all_urls>` is `host_permissions`, justified by the dApp provider. |
| Missing privacy policy | You'll provide one in step 2. |
| Functionality unclear | Description above is explicit. |
| Single purpose violation | Single purpose declared as "self-custodial ApeChain wallet". |
| Remote code execution | Strict CSP forbids it. No remote scripts loaded. |
| Misleading branding | Yacht does not impersonate any other wallet. |

## 10. Post-publication

- Pin the extension to your toolbar in your daily browser.
- Watch developer email for any review notes from Google.
- Plan version bumps: every release should bump `package.json` version and
  re-upload the new ZIP.

## 11. Updating later

1. Bump `package.json` version (`0.1.0` → `0.1.1` for a fix).
2. `npm run package`
3. `npm run validate`
4. Upload the new ZIP via Dev Console.
5. Submit for review. Subsequent reviews usually approve in <24 h if the
   listing itself isn't changing.
