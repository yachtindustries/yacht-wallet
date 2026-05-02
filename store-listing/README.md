# Chrome Web Store Listing Assets

Drop the screenshots and promo art for your store submission here. The Web Store
requires:

| Asset | Spec | Required? |
| --- | --- | --- |
| **Icon** | 128×128 PNG | already shipped (`public/icon-128.png`) |
| **Screenshots** | 1280×800 or 640×400 PNG/JPEG, up to 5 | **required** (at least 1) |
| **Small promo tile** | 440×280 PNG/JPEG | optional (recommended) |
| **Marquee promo tile** | 1400×560 PNG/JPEG | optional |

Suggested screenshot flow:
1. Dashboard with XRP balance + tokens list
2. Swap screen with a quote loaded
3. Token picker open
4. Send confirmation
5. dApp connection approval

## Listing copy (paste into Web Store Dev Console)

**Name (max 45 chars):**
> Xrpurse — XRPL wallet & swaps

**Summary (max 132 chars):**
> Self-custody wallet for the XRP Ledger. Send, receive, swap, hold tokens & NFTs, connect to XRPL dApps. Keys stay on your device.

**Detailed description:**
```
Xrpurse is a non-custodial browser extension for the XRP Ledger.

Features
• Send and receive XRP, with destination tag support
• Hold XRPL-issued tokens — add trustlines, see balances inline
• In-wallet token swaps routed through XRPL DEX + AMM (live on mainnet)
• View and transfer NFTs (XLS-20)
• Multi-account support (create new or import family seed)
• Mainnet, Testnet, Devnet network switcher
• dApp connector — websites can request to connect via window.xrpl
• Live XRP price (USD / EUR / GBP)

Security
• Your keys are encrypted with AES-GCM via a password you choose, derived through PBKDF2-SHA256 (310,000 iterations)
• Plaintext keys exist only in extension memory while unlocked
• Auto-lock after a period of inactivity
• Open source — code is auditable
• No analytics, no telemetry, no remote code execution

This is a self-custodial wallet: you alone hold your keys. Always back up your secret seed.
```

**Category:** Productivity (or Tools)
**Language:** English

**Privacy practices form:**
- Single purpose: "Self-custodial wallet for the XRP Ledger."
- Permissions justification:
  - `storage`: persist encrypted vault and settings
  - `alarms`: auto-lock timer
  - `notifications`: reserved for future tx confirmations
  - `<all_urls>` host permission: inject the `window.xrpl` provider so any site can request connection (user-approved per site)
- Data usage disclosures: **No** to all categories (we collect nothing). Reference `PRIVACY.md`.

**Privacy policy URL:** host `PRIVACY.md` somewhere public (GitHub Pages, etc.) and paste the URL.
