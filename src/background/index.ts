// Background service worker — message router and orchestrator.
// Security-critical surface. Patterns:
//
// • Origin validation:
//     Vault / popup-only RPCs require sender.id === chrome.runtime.id.
//     dApp RPCs derive origin EXCLUSIVELY from sender.origin / sender.tab.url.
//     We never trust an origin string supplied in the request body.
//
// • Brute-force protection: vault.unlock has exponential backoff.
//
// • Tx tampering: dApp signTx is forced to from = active account; risk-
//   assessed; user must approve in a popup before signing.
//
// • Concurrency: per-account submission queue serialises sign+submit.
//
// • Pending dApp request limits: per-origin cap to prevent popup-spam.

import {
  createVault,
  destroyVault,
  isInitialized,
  readMeta,
  rewriteVaultWithKey,
  unlockVault,
  changePassword,
  VaultAccount,
  UnlockMaterial,
} from '@/lib/vault';
import { fromB64, toB64 } from '@/lib/crypto';
import {
  getAccountSummary,
  getErc20Balance,
  getErc20Balances,
  getErc20Info,
  getHistory,
  getOwnedNfts,
  dappRpc,
  personalSign,
  sendErc20,
  sendNative,
  sendNft,
  signGenericTransaction,
  signTypedDataV4,
  simulateTransaction,
} from '@/lib/evm';
import { analyzePersonalSign, analyzeTxData, analyzeTypedData } from '@/lib/signing-detect';
import {
  ensureAllowance,
  executeSwap,
  isNativeAddress,
  quoteSwap,
} from '@/lib/camelot';
import { formatUnits, parseUnits } from 'ethers';
import {
  deriveAccount,
  generateMnemonic,
  isValidMnemonic,
  walletFromPrivateKey,
} from '@/lib/wallet-utils';
import { NETWORKS, readSettings, writeSettings } from '@/lib/networks';
import { getApePrice } from '@/lib/price';
import { getApeChainPair, getTrendingApeChainTokens } from '@/lib/dexscreener';
import {
  getRecentMessages,
  getTipsForMessages,
  releaseTipBudget,
  reserveTipBudget,
  sendChatMessage,
  sendTip,
} from '@/lib/chat';
import { castVote, getVoteTalliesForWeek, VOTE_AMOUNTS } from '@/lib/voting';
import { setOnChainPfp, clearOnChainPfp, getOnChainPfp } from '@/lib/pfp';
import { getRecentTrades } from '@/lib/trades';
import { getTopNftCollections, TOP_NFT_REGISTRY } from '@/lib/topnfts';
import { getCollectionListings, getCollectionTraits, getFulfillmentTx, getCollectionFloorByContract, getNftDetailByContract, OPENSEA_APECHAIN } from '@/lib/opensea';
import { TRADING_FEE_TREASURY } from '@/lib/constants';
import { getTopUsers } from '@/lib/topusers';
import {
  evaluateRankForAddress,
  readAchievementSnapshot,
  recordOpenseaConnect,
  recordOpenseaNftPurchase,
  recordRevokedSite,
  syncAchievements,
} from '@/lib/achievements';
import { getOrCreateUsername, setUsername } from '@/lib/usernames';
import { friendlyError } from '@/lib/errors';
import { assessTxRisk, hostFromOrigin } from '@/lib/security';
import {
  PendingRequest,
  RpcEnvelope,
  RpcReply,
  RpcRequest,
  TypedDataPayload,
  UnsignedEvmTx,
} from '@/lib/messaging';
import {
  getActiveAccount,
  isUnlocked,
  loadApprovedOrigins,
  lock,
  persistApprovedOrigins,
  state,
} from './state';

const AUTO_LOCK_ALARM = 'yacht.autolock';
const MAX_PENDING_PER_ORIGIN = 3;
const MAX_UNLOCK_FAILURES = 5;
const UNLOCK_LOCKOUT_MS = 30_000;
const MAX_SLIPPAGE_BPS = 500;      // 5% — limits MEV sandwich blast radius
// Per-origin RPC rate limit: leaky bucket capping a dApp at this many
// background-served calls per minute. Defends against fingerprinting loops
// (calling getAddress in a tight while(true)) and popup spam.
const ORIGIN_RPC_BUDGET_PER_MIN = 120;

// Surface stray promise rejections / uncaught errors in the SW console so a
// silent failure in a top-level `void someAsync()` is visible during dev and
// debuggable in prod. Without this they're swallowed and only show up as red
// "Unhandled promise rejection" spam in chrome://extensions.
self.addEventListener('unhandledrejection', (e) => {
  console.error('[Yacht SW] unhandled promise rejection:', (e as PromiseRejectionEvent).reason);
});
self.addEventListener('error', (e) => {
  console.error('[Yacht SW] uncaught error:', (e as ErrorEvent).error ?? (e as ErrorEvent).message);
});

function uuid(): string {
  return crypto.randomUUID();
}

async function setAutoLockAlarm(): Promise<void> {
  // On mobile we lock-on-background instead (see src/lib/mobile-rpc.ts).
  // Running the timer-based alarm in the foreground would lock the wallet
  // mid-session, which broke swap flows for active users.
  if ((import.meta as any).env?.YACHT_PLATFORM === 'mobile') return;
  const settings = await readSettings();
  await chrome.alarms.clear(AUTO_LOCK_ALARM);
  if (settings.autoLockMinutes > 0) {
    await chrome.alarms.create(AUTO_LOCK_ALARM, { delayInMinutes: settings.autoLockMinutes });
  }
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === AUTO_LOCK_ALARM) {
    lock();
    clearCachedKey();
    submissionQueues.clear();
    void clearSession();
  }
});

// Audit H3: force-lock on every install / update event. The Trust
// Wallet extension breach (Dec 2025, ~$7M) used the auto-update
// channel to push code that ran against an already-unlocked vault.
// We forbid that pattern by design: any extension reload — install,
// reinstall, browser update, our own version bump — drops the
// in-memory and chrome.storage.session unlocked state, requiring the
// user to re-enter the password. The Argon2id cost is the user's
// only line of defense if the publish channel is ever compromised.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install' || details.reason === 'update' || details.reason === 'chrome_update') {
    lock();
    clearCachedKey();
    submissionQueues.clear();
    void clearSession();
  }
});

// `onUpdateAvailable` fires when Chrome has a pending update for our
// extension; calling reload would apply it immediately. We don't
// reload here (we let Chrome do it on its own schedule) but we DO
// drop the unlocked state proactively so the moment the update lands
// the new code starts from "locked".
if (chrome.runtime.onUpdateAvailable) {
  chrome.runtime.onUpdateAvailable.addListener(() => {
    lock();
    clearCachedKey();
    submissionQueues.clear();
    void clearSession();
  });
}

void loadApprovedOrigins();

// ───────────────────── popup vs side-panel layout ───────────────────────
const LAYOUT_KEY = 'yacht.layoutMode.v1';
type LayoutMode = 'popup' | 'sidepanel';

async function readLayoutMode(): Promise<LayoutMode> {
  try {
    const r = await chrome.storage.local.get(LAYOUT_KEY);
    const v = r[LAYOUT_KEY];
    return v === 'sidepanel' || v === 'popup' ? v : 'popup';
  } catch {
    return 'popup';
  }
}

async function applyLayoutMode(mode: LayoutMode): Promise<void> {
  try {
    if (mode === 'sidepanel') {
      // Empty popup string makes the toolbar icon click route to onClicked
      // and (because of setPanelBehavior below) Chrome opens the side panel.
      await chrome.action.setPopup({ popup: '' });
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    } else {
      await chrome.action.setPopup({ popup: 'index.html' });
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
    }
  } catch { /* sidePanel may be unavailable on older Chrome */ }
}

// Apply persisted layout on every SW startup so the user's choice survives
// browser restarts.
void readLayoutMode().then(applyLayoutMode);


// ───────────────────── unlock brute-force protection ─────────────────────
// Persisted to chrome.storage.local so an attacker can't reset the lockout by
// killing the MV3 service worker (which it does itself after ~30s idle).
const UNLOCK_GATE_KEY = 'yacht.unlockGate.v1';
let unlockFailures = 0;
let unlockLockedUntil = 0;
let unlockGateLoaded: Promise<void> | null = null;

function loadUnlockGate(): Promise<void> {
  return (unlockGateLoaded ??= (async () => {
    try {
      const r = await chrome.storage.local.get(UNLOCK_GATE_KEY);
      const v = r[UNLOCK_GATE_KEY];
      if (v && typeof v === 'object') {
        const f = (v as { failures?: unknown }).failures;
        const u = (v as { lockedUntil?: unknown }).lockedUntil;
        if (typeof f === 'number' && Number.isFinite(f) && f >= 0) unlockFailures = f;
        if (typeof u === 'number' && Number.isFinite(u) && u >= 0) unlockLockedUntil = u;
      }
    } catch { /* fail open — in-memory defaults still apply */ }
  })());
}

async function persistUnlockGate(): Promise<void> {
  try {
    await chrome.storage.local.set({
      [UNLOCK_GATE_KEY]: { failures: unlockFailures, lockedUntil: unlockLockedUntil },
    });
  } catch { /* best effort */ }
}

async function unlockTryAllowed(): Promise<{ allowed: true } | { allowed: false; waitMs: number }> {
  await loadUnlockGate();
  if (Date.now() < unlockLockedUntil) {
    return { allowed: false, waitMs: unlockLockedUntil - Date.now() };
  }
  return { allowed: true };
}

function unlockSucceeded(): void {
  unlockFailures = 0;
  unlockLockedUntil = 0;
  void persistUnlockGate();
}

function unlockFailed(): void {
  unlockFailures++;
  if (unlockFailures >= MAX_UNLOCK_FAILURES) {
    const factor = Math.pow(2, Math.min(6, unlockFailures - MAX_UNLOCK_FAILURES));
    unlockLockedUntil = Date.now() + UNLOCK_LOCKOUT_MS * factor;
  }
  void persistUnlockGate();
}

// ───────────────────── per-origin RPC rate limit ─────────────────────────
const originBuckets = new Map<string, { tokens: number; lastRefill: number }>();

function rateLimitOrigin(origin: string): void {
  if (!origin) return;
  const now = Date.now();
  let b = originBuckets.get(origin);
  if (!b) {
    b = { tokens: ORIGIN_RPC_BUDGET_PER_MIN, lastRefill: now };
    originBuckets.set(origin, b);
  } else {
    const elapsed = now - b.lastRefill;
    const refill = (elapsed / 60_000) * ORIGIN_RPC_BUDGET_PER_MIN;
    b.tokens = Math.min(ORIGIN_RPC_BUDGET_PER_MIN, b.tokens + refill);
    b.lastRefill = now;
  }
  if (b.tokens < 1) {
    throw new Error(`Rate limit: ${hostFromOrigin(origin)} is making too many wallet calls.`);
  }
  b.tokens -= 1;
}

// ───────────────────── PFP set/clear cooldown ───────────────────────────
// One PFP publish every 60 s per account. Blocks a popup-XSS from
// spam-publishing PFP changes (gas drain only — the on-chain
// ownership check in pfp.ts already prevents impersonation).
const PFP_COOLDOWN_MS = 60_000;
const lastPfpAtByAccount = new Map<string, number>();
function enforcePfpCooldown(account: string): void {
  const lc = account.toLowerCase();
  const last = lastPfpAtByAccount.get(lc) ?? 0;
  const elapsed = Date.now() - last;
  if (elapsed < PFP_COOLDOWN_MS) {
    const wait = Math.ceil((PFP_COOLDOWN_MS - elapsed) / 1000);
    throw new Error(`PFP changes are rate-limited; try again in ${wait}s.`);
  }
  lastPfpAtByAccount.set(lc, Date.now());
}

// ───────────────────── per-account submission mutex ──────────────────────
const submissionQueues = new Map<string, Promise<unknown>>();

async function submitSerialized<T>(account: string, fn: () => Promise<T>): Promise<T> {
  const prev = submissionQueues.get(account) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const next = new Promise<void>((r) => { release = r; });
  submissionQueues.set(account, prev.then(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (submissionQueues.get(account) === next) submissionQueues.delete(account);
  }
}

// ───────────────────── helpers ───────────────────────────────────────────
async function requireUnlocked(): Promise<void> {
  if (!isUnlocked()) throw new Error('Wallet is locked');
}

function isFromExtension(sender: chrome.runtime.MessageSender | undefined): boolean {
  return !!sender && sender.id === chrome.runtime.id;
}

function senderOrigin(sender: chrome.runtime.MessageSender | undefined): string {
  if (!sender) return '';
  if (sender.origin) return sender.origin;
  if (sender.url) {
    try { return new URL(sender.url).origin; } catch { return ''; }
  }
  return '';
}

function ensureFiniteNumber(s: string | undefined, label: string): number {
  const n = parseFloat(s ?? '');
  if (!Number.isFinite(n)) throw new Error(`Invalid ${label}: not a number`);
  return n;
}

function findAccount(addressOrId: string): VaultAccount {
  if (!state.unlocked) throw new Error('Wallet is locked');
  const lower = addressOrId.toLowerCase();
  const found = state.unlocked.accounts.find(
    (a) => a.id === addressOrId || a.address.toLowerCase() === lower,
  );
  if (!found) throw new Error('Account not in vault');
  return found;
}

function safeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** True for opensea.io and any of its subdomains (testnets.opensea.io,
 * pro.opensea.io, etc.). Used to drive the opensea-* achievements. */
function isOpenseaHost(host: string): boolean {
  if (!host) return false;
  const h = host.toLowerCase();
  return h === 'opensea.io' || h.endsWith('.opensea.io');
}

// Mirror unlocked vault into chrome.storage.session so MV3 service-worker
// terminations don't appear to "lock" the wallet every minute. session storage
// lives in browser-process RAM; it never touches disk and is wiped on browser
// restart. The same auto-lock alarm still tears down the session on schedule.
//
// SECURITY: we persist the *derived AES key bytes* and salt, NOT the user's
// password. The key bytes are sufficient to re-encrypt the vault (with the
// same salt → same KDF result → same key) without ever holding the password
// in memory after unlock. The password is needed only for changePassword,
// which the user re-enters as input.
const SESSION_KEY = 'yacht.session.v1';
const SESSION_GRACE_MS = 20 * 60 * 1000; // 20m hard cap regardless of alarm fate

interface SessionBlob {
  v: 2;                 // schema version (v1 is the legacy password-bearing format)
  unlocked: typeof state.unlocked;
  unlockedAt: number;
  keyB64: string;       // AES-256 key bytes (32 B, base64)
  saltB64: string;      // KDF salt that produced keyBytes (16 B, base64)
  expiresAt: number;
}

let cachedKey: { bytes: Uint8Array; salt: Uint8Array } | null = null;

/**
 * Zero the cached AES key + salt bytes in place before clearing the
 * reference. JS doesn't guarantee garbage-collected memory is wiped,
 * so a heap dump after lock could otherwise still recover the key
 * bytes from the freed Uint8Array's backing buffer.
 *
 * .fill(0) is required by every modern wallet's threat model
 * (MetaMask, Phantom both do this); skipping it would weaken the
 * post-lock memory hygiene we advertise in SECURITY.md.
 */
function clearCachedKey(): void {
  if (cachedKey) {
    try {
      cachedKey.bytes.fill(0);
      cachedKey.salt.fill(0);
    } catch { /* defensive — bytes/salt should always be writable */ }
  }
  cachedKey = null;
}

async function writeSession(): Promise<void> {
  if (!state.unlocked || !cachedKey) return;
  const blob: SessionBlob = {
    v: 2,
    unlocked: state.unlocked,
    unlockedAt: state.unlockedAt,
    keyB64: toB64(cachedKey.bytes),
    saltB64: toB64(cachedKey.salt),
    expiresAt: Date.now() + SESSION_GRACE_MS,
  };
  try {
    await chrome.storage.session.set({ [SESSION_KEY]: blob });
  } catch { /* session API unavailable — skip */ }
}

async function clearSession(): Promise<void> {
  try { await chrome.storage.session.remove(SESSION_KEY); } catch { /* ignore */ }
}

// Validate the on-the-wire shape. We can't authenticate the writer (anything
// with chrome.storage permission can write), but we can refuse anything that
// doesn't match the exact schema we expect — which limits what a malformed or
// poisoned blob can do (can't pin an "unlocked" boolean past expiry, can't
// inject extra fields that future code paths might trust).
function isValidSessionBlob(b: unknown): b is SessionBlob {
  if (!b || typeof b !== 'object') return false;
  const x = b as Record<string, unknown>;
  if (x.v !== 2) return false;
  if (typeof x.keyB64 !== 'string' || typeof x.saltB64 !== 'string') return false;
  if (typeof x.unlockedAt !== 'number' || !Number.isFinite(x.unlockedAt)) return false;
  if (typeof x.expiresAt !== 'number' || !Number.isFinite(x.expiresAt)) return false;
  if (!x.unlocked || typeof x.unlocked !== 'object') return false;
  const u = x.unlocked as Record<string, unknown>;
  if (!Array.isArray(u.accounts)) return false;
  if (typeof u.nextDerivationIndex !== 'number') return false;
  if (u.activeAccountId !== null && typeof u.activeAccountId !== 'string') return false;
  if (u.mnemonic !== null && typeof u.mnemonic !== 'string') return false;
  for (const a of u.accounts as unknown[]) {
    if (!a || typeof a !== 'object') return false;
    const ac = a as Record<string, unknown>;
    if (typeof ac.id !== 'string' || typeof ac.name !== 'string') return false;
    if (typeof ac.address !== 'string' || typeof ac.privateKey !== 'string') return false;
    if (ac.origin !== 'mnemonic' && ac.origin !== 'privateKey') return false;
  }
  return true;
}

let rehydratePromise: Promise<void> | null = null;
async function rehydrateFromSession(): Promise<void> {
  if (state.unlocked) return;
  try {
    const r = await chrome.storage.session.get(SESSION_KEY);
    const raw = r[SESSION_KEY];
    if (!raw) return;
    if (!isValidSessionBlob(raw)) {
      // Malformed or legacy v1 (password-bearing) blob — nuke it; user
      // re-unlocks once. This is by design after the H1/H2 hardening.
      await clearSession();
      return;
    }
    const blob = raw as SessionBlob;
    // Independent expiry check using a server-side cap, in addition to the
    // attacker-controlled expiresAt field on the blob.
    const hardCap = blob.unlockedAt + SESSION_GRACE_MS;
    if (Date.now() > Math.min(blob.expiresAt, hardCap)) {
      await clearSession();
      return;
    }
    state.unlocked = blob.unlocked;
    state.unlockedAt = blob.unlockedAt;
    // Wipe any stale key bytes from a previous unlock cycle before we
    // overwrite the reference with fresh material.
    clearCachedKey();
    cachedKey = {
      bytes: fromB64(blob.keyB64),
      salt: fromB64(blob.saltB64),
    };
    // Re-arm the auto-lock alarm. The previous SW instance's alarm survives a
    // restart only if it hadn't fired yet; if we got here via an event after
    // the alarm fired (which auto-deletes), the user's configured
    // autoLockMinutes would otherwise be ignored and the wallet would stay
    // unlocked up to the SESSION_GRACE_MS hard cap.
    void setAutoLockAlarm();
  } catch {
    // If anything throws, fail closed (treat as locked).
    state.unlocked = null;
    state.unlockedAt = 0;
    clearCachedKey();
  }
}
function ensureRehydrated(): Promise<void> {
  return (rehydratePromise ??= rehydrateFromSession());
}

async function rememberUnlockedAndLoad(material: UnlockMaterial) {
  state.unlocked = material.data;
  state.unlockedAt = Date.now();
  clearCachedKey();
  cachedKey = { bytes: material.keyBytes, salt: material.salt };
  await writeSession();
  void setAutoLockAlarm();
}

async function persistUnlocked() {
  if (!state.unlocked) throw new Error('Vault not unlocked');
  if (!cachedKey) throw new Error('Session expired — please unlock again');
  await rewriteVaultWithKey(cachedKey.bytes, cachedKey.salt, state.unlocked);
  await writeSession();
}

function stripCallbacks(p: PendingRequest & { resolve: any; reject: any }): PendingRequest {
  const { resolve: _r, reject: _j, ...rest } = p;
  return rest;
}

// Track the OS popup window currently displaying an approval request, so we
// can focus it instead of opening a second one. Caps concurrent popup
// windows globally at 1 — multiple coordinated origins can't open stacked
// popups to confuse the user about which "Approve" goes with which dApp.
let activeApprovalWindowId: number | null = null;

async function openApprovalPopup(opts: {
  type: 'connect' | 'signTx' | 'personalSign' | 'signTypedData';
  origin: string;
  payload: unknown;
  /** Audit H2: the account this request is bound to, captured at
   * dispatch time. The approval flow signs with EXACTLY this account
   * — never with whatever's "currently active". Prevents the
   * account-confusion drain where a user reviews a tx for Account A
   * and then (accidentally or maliciously) has the active account
   * flipped to Account B before clicking Approve, sending Account
   * B's key against Account A's payload. */
  accountId?: string;
  /** Window ID of the dApp tab that initiated the request, used to anchor
   * the popup. Avoids the chrome.windows.getLastFocused TOCTOU where a
   * malicious site could grab focus to position the real popup over a
   * spoofed Approve button. */
  sourceWindowId?: number;
}): Promise<unknown> {
  const pendingForOrigin = [...state.pending.values()].filter((p) => p.origin === opts.origin).length;
  if (pendingForOrigin >= MAX_PENDING_PER_ORIGIN) {
    throw new Error(`Too many pending requests from ${hostFromOrigin(opts.origin)}.`);
  }

  const id = uuid();
  return new Promise((resolve, reject) => {
    state.pending.set(id, {
      id,
      type: opts.type,
      origin: opts.origin,
      createdAt: Date.now(),
      payload: opts.payload,
      accountId: opts.accountId,
      resolve: async (v) => {
        if (opts.type === 'connect') {
          state.approvedOrigins.add(opts.origin);
          // Await the persist BEFORE resolving the dApp's pending Promise.
          // This closes the race where the dApp's follow-up call (e.g. SIWE
          // personal_sign) reads from disk faster than we wrote, and finds
          // the origin missing → "Origin not connected" → SIWE 401.
          try { await persistApprovedOrigins(); } catch { /* best effort */ }
          // Achievement signal: connect-opensea fires on the first
          // approved connect to opensea.io (or any *.opensea.io
          // subdomain). The recording is per-account.
          if (isOpenseaHost(hostFromOrigin(opts.origin))) {
            const a = getActiveAccount();
            if (a) void recordOpenseaConnect(a.address);
          }
        }
        resolve(v);
      },
      reject,
    });
    // If a popup is already open, focus it. The popup's pending-request list
    // shows every queued request so the user can see all of them; new
    // requests join the existing list instead of spawning a new window.
    if (activeApprovalWindowId != null) {
      chrome.windows.update(activeApprovalWindowId, { focused: true }).catch(() => {
        activeApprovalWindowId = null;
        spawnPopup(id, opts.sourceWindowId);
      });
    } else {
      spawnPopup(id, opts.sourceWindowId);
    }
  });
}

function spawnPopup(requestId: string, sourceWindowId?: number): void {
  // Anchor the approval popup to the dApp's *originating* window. Reading
  // chrome.windows.getLastFocused (the previous behaviour) was a TOCTOU
  // vector: between request and resolve, an attacker site could focus its
  // own window and have the real popup positioned over a spoofed Approve
  // button. windowId is captured at request time from sender.tab.windowId
  // and is stable for the lifetime of the dApp tab.
  const POPUP_W = 380;
  const POPUP_H = 620;
  const lookup: Promise<chrome.windows.Window | null | undefined> =
    sourceWindowId != null
      ? chrome.windows.get(sourceWindowId).catch(() => null)
      : chrome.windows.getLastFocused({ populate: false }).catch(() => null);

  lookup.then((focused) => {
    const isUsable = focused && focused.type === 'normal' && typeof focused.left === 'number';
    if (!isUsable) {
      chrome.windows.create({
        url: chrome.runtime.getURL(`index.html#/request/${requestId}`),
        type: 'popup',
        width: POPUP_W,
        height: POPUP_H,
      }, (win) => {
        if (win?.id != null) activeApprovalWindowId = win.id;
      });
      return;
    }
    const wLeft = focused!.left ?? 0;
    const wTop = focused!.top ?? 0;
    const wWidth = focused!.width ?? 1280;
    const left = Math.max(0, wLeft + wWidth - POPUP_W - 16);
    const top = Math.max(0, wTop + 60);
    chrome.windows.create({
      url: chrome.runtime.getURL(`index.html#/request/${requestId}`),
      type: 'popup',
      width: POPUP_W,
      height: POPUP_H,
      left,
      top,
    }, (win) => {
      if (win?.id != null) activeApprovalWindowId = win.id;
    });
  });
}

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === activeApprovalWindowId) activeApprovalWindowId = null;
});

function nextDerivationIndex(): number {
  if (!state.unlocked) throw new Error('Vault not unlocked');
  return state.unlocked.nextDerivationIndex;
}

function newDerivedAccount(name?: string): VaultAccount {
  if (!state.unlocked || !state.unlocked.mnemonic) {
    throw new Error('No HD wallet available — only imported accounts exist');
  }
  const idx = nextDerivationIndex();
  const d = deriveAccount(state.unlocked.mnemonic, idx);
  state.unlocked.nextDerivationIndex = idx + 1;
  return {
    id: uuid(),
    name: name ?? `Account ${state.unlocked.accounts.length + 1}`,
    address: d.address,
    privateKey: d.privateKey,
    origin: 'mnemonic',
    derivationIndex: idx,
  };
}

// ───────────────────── handlers ──────────────────────────────────────────

// Audit H1: popup-only RPCs must originate from the wallet's own
// extension page (popup or side-panel HTML), not from a content
// script. The base `fromExtension` check passes for both — content
// scripts of *our* extension also report sender.id === runtime.id —
// so without this list a malicious page that gets a content-script
// to forward arbitrary RpcEnvelopes could silently call e.g.
// `request.approve` or `vault.mnemonic.reveal`. The expected sender
// URL is the popup HTML; everything else is dApp-bridge traffic.
const POPUP_ONLY_RPCS = new Set<RpcRequest['type']>([
  'vault.create.new',
  'vault.create.mnemonic',
  'vault.create.privateKey',
  'vault.unlock',
  'vault.lock',
  'vault.account.add.derived',
  'vault.account.add.privateKey',
  'vault.account.rename',
  'vault.account.remove',
  'vault.account.activate',
  'vault.account.reveal',
  'vault.mnemonic.reveal',
  'vault.changePassword',
  'vault.destroy',
  'request.approve',
  'request.reject',
  'request.list',
  'request.get',
  'origins.list',
  'origins.revoke',
  'layout.set',
  'layout.get',
  // Popup-only outbound flows that move funds. dApp-side equivalents
  // run through dapp.signTx (which opens the approval popup); these
  // RPCs are the popup's own Send / Swap / Chat / Tip path and must
  // never be reachable from a content-script context.
  'evm.send.native',
  'evm.send.erc20',
  'evm.send.nft',
  'evm.sign.tx',
  'evm.sign.message',
  'evm.sign.typedData',
  'swap.execute',
  'chat.send',
  'chat.tip',
  'username.set',
  // nft.vote moves user funds (APE → treasury) on a popup-side
  // gesture; gate it the same way as chat.tip.
  'nft.vote',
  // nft.buy fans through OpenSea + signs a Seaport tx. Popup-only —
  // never reachable from a content-script context.
  'nft.buy',
  // pfp.set / pfp.clear publish on-chain. Popup-only — same model
  // as chat.send / chat.tip.
  'pfp.set',
  'pfp.clear',
]);

function isFromPopupSurface(sender: chrome.runtime.MessageSender | undefined): boolean {
  const url = sender?.url ?? '';
  if (!url) return false;
  const expected = chrome.runtime.getURL('index.html');
  return url.startsWith(expected);
}

export async function handle(req: RpcRequest, sender: chrome.runtime.MessageSender | undefined): Promise<unknown> {
  // After an MV3 service-worker restart, in-memory unlocked state is gone but
  // we may still have a valid session blob — rehydrate before any handler runs.
  await ensureRehydrated();

  const isDappRequest = req.type.startsWith('dapp.');
  const fromExtension = isFromExtension(sender);

  if (!fromExtension) {
    throw new Error('Unauthorized sender');
  }

  // Audit H1: popup-only RPCs must originate from the popup/sidepanel
  // HTML. dApp RPCs (req.type starts with 'dapp.') are exempt — those
  // come through the content script.
  if (POPUP_ONLY_RPCS.has(req.type)) {
    if (!isFromPopupSurface(sender)) {
      throw new Error('Unauthorized sender for popup-only RPC');
    }
  }

  switch (req.type) {
    case 'vault.status': {
      await loadApprovedOrigins();
      const initialized = await isInitialized();
      const meta = await readMeta();
      return { initialized, unlocked: isUnlocked(), meta };
    }

    case 'vault.create.new': {
      const mnemonic = generateMnemonic();
      const first = deriveAccount(mnemonic, 0);
      const account: VaultAccount = {
        id: uuid(),
        name: req.name ?? 'Account 1',
        address: first.address,
        privateKey: first.privateKey,
        origin: 'mnemonic',
        derivationIndex: 0,
      };
      const matNew = await createVault(req.password, {
        mnemonic,
        nextDerivationIndex: 1,
        accounts: [account],
        activeAccountId: account.id,
      });
      await rememberUnlockedAndLoad(matNew);
      return { mnemonic, address: account.address };
    }

    case 'vault.create.mnemonic': {
      if (!isValidMnemonic(req.mnemonic)) throw new Error('Invalid recovery phrase');
      const first = deriveAccount(req.mnemonic, 0);
      const account: VaultAccount = {
        id: uuid(),
        name: req.name ?? 'Account 1',
        address: first.address,
        privateKey: first.privateKey,
        origin: 'mnemonic',
        derivationIndex: 0,
      };
      const matMnem = await createVault(req.password, {
        mnemonic: req.mnemonic.trim(),
        nextDerivationIndex: 1,
        accounts: [account],
        activeAccountId: account.id,
      });
      await rememberUnlockedAndLoad(matMnem);
      return { address: account.address };
    }

    case 'vault.create.privateKey': {
      const w = walletFromPrivateKey(req.privateKey);
      const account: VaultAccount = {
        id: uuid(),
        name: req.name ?? 'Account 1',
        address: w.address,
        privateKey: w.privateKey,
        origin: 'privateKey',
      };
      const matPk = await createVault(req.password, {
        mnemonic: null,
        nextDerivationIndex: 0,
        accounts: [account],
        activeAccountId: account.id,
      });
      await rememberUnlockedAndLoad(matPk);
      return { address: account.address };
    }

    case 'vault.unlock': {
      const gate = await unlockTryAllowed();
      if (!gate.allowed) {
        throw new Error(`Too many failed attempts. Try again in ${Math.ceil(gate.waitMs / 1000)}s.`);
      }
      try {
        const material = await unlockVault(req.password);
        await rememberUnlockedAndLoad(material);
        unlockSucceeded();
      } catch {
        unlockFailed();
        throw new Error('Incorrect password');
      }
      return { ok: true };
    }

    case 'vault.lock': {
      lock();
      clearCachedKey();
      submissionQueues.clear();
      await clearSession();
      return { ok: true };
    }

    case 'vault.account.add.derived': {
      await requireUnlocked();
      const account = newDerivedAccount(req.name);
      state.unlocked!.accounts.push(account);
      await persistUnlocked();
      return { account };
    }

    case 'vault.account.add.privateKey': {
      await requireUnlocked();
      const w = walletFromPrivateKey(req.privateKey);
      if (state.unlocked!.accounts.some((a) => a.address.toLowerCase() === w.address.toLowerCase())) {
        throw new Error('Account already exists');
      }
      const account: VaultAccount = {
        id: uuid(),
        name: req.name ?? `Imported ${state.unlocked!.accounts.length + 1}`,
        address: w.address,
        privateKey: w.privateKey,
        origin: 'privateKey',
      };
      state.unlocked!.accounts.push(account);
      await persistUnlocked();
      return { account };
    }

    case 'vault.account.rename': {
      await requireUnlocked();
      const a = state.unlocked!.accounts.find((x) => x.id === req.id);
      if (!a) throw new Error('Account not found');
      a.name = req.name;
      await persistUnlocked();
      return { ok: true };
    }

    case 'vault.account.remove': {
      await requireUnlocked();
      const idx = state.unlocked!.accounts.findIndex((x) => x.id === req.id);
      if (idx < 0) throw new Error('Account not found');
      state.unlocked!.accounts.splice(idx, 1);
      if (state.unlocked!.activeAccountId === req.id) {
        state.unlocked!.activeAccountId = state.unlocked!.accounts[0]?.id ?? null;
      }
      await persistUnlocked();
      return { ok: true };
    }

    case 'vault.account.activate': {
      await requireUnlocked();
      state.unlocked!.activeAccountId = req.id;
      await persistUnlocked();
      return { ok: true };
    }

    case 'vault.account.reveal': {
      // Audit M4: gate reveal flows behind the same brute-force
      // counter as `vault.unlock`. Without this, a popup-XSS could
      // grind the password against the reveal RPC at full Argon2id
      // cost forever, since the unlock-screen lockout never fires
      // for this code path.
      const gateAR = await unlockTryAllowed();
      if (!gateAR.allowed) {
        throw new Error(`Too many failed attempts. Try again in ${Math.ceil(gateAR.waitMs / 1000)}s.`);
      }
      let data;
      try {
        ({ data } = await unlockVault(req.password));
        unlockSucceeded();
      } catch {
        unlockFailed();
        throw new Error('Incorrect password');
      }
      const a = data.accounts.find((x) => x.id === req.id);
      if (!a) throw new Error('Account not found');
      return { privateKey: a.privateKey };
    }

    case 'vault.mnemonic.reveal': {
      // Audit M4: gate behind the brute-force counter — see
      // vault.account.reveal above for the same reason.
      const gateMR = await unlockTryAllowed();
      if (!gateMR.allowed) {
        throw new Error(`Too many failed attempts. Try again in ${Math.ceil(gateMR.waitMs / 1000)}s.`);
      }
      let data;
      try {
        ({ data } = await unlockVault(req.password));
        unlockSucceeded();
      } catch {
        unlockFailed();
        throw new Error('Incorrect password');
      }
      return { mnemonic: data.mnemonic };
    }

    case 'vault.changePassword': {
      const fresh = await changePassword(req.oldPw, req.newPw);
      // Atomically swap in the new key material so the next persist uses it.
      clearCachedKey();
      cachedKey = { bytes: fresh.keyBytes, salt: fresh.salt };
      state.unlocked = fresh.data;
      await writeSession();
      return { ok: true };
    }

    case 'vault.destroy': {
      // Audit M4: same brute-force gate. Destroying the vault is
      // not in itself a fund-loss path (the user's mnemonic on
      // paper still recovers it), but routing reveal/destroy
      // password checks through the same counter prevents an
      // attacker from using THIS endpoint as an oracle to learn
      // whether a candidate password is correct.
      const gateD = await unlockTryAllowed();
      if (!gateD.allowed) {
        throw new Error(`Too many failed attempts. Try again in ${Math.ceil(gateD.waitMs / 1000)}s.`);
      }
      try {
        await unlockVault(req.password);
        unlockSucceeded();
      } catch {
        unlockFailed();
        throw new Error('Incorrect password');
      }
      // Wipe session FIRST so the in-memory key material is gone before the
      // user-visible destroy completes; otherwise a SW kill in this window
      // leaves a vault-less state with key material still in session.
      await clearSession();
      clearCachedKey();
      lock();
      await destroyVault();
      state.approvedOrigins.clear();
      await persistApprovedOrigins();
      submissionQueues.clear();
      return { ok: true };
    }

    case 'settings.get': return await readSettings();
    case 'settings.set': {
      const cur = await readSettings();
      const next = { ...cur, ...req.settings };
      await writeSettings(next);
      if (req.settings.autoLockMinutes !== undefined) await setAutoLockAlarm();
      return next;
    }

    case 'evm.account': return await getAccountSummary((await readSettings()).network, req.address);
    case 'evm.history': return await getHistory((await readSettings()).network, req.address);
    case 'evm.nfts': return await getOwnedNfts((await readSettings()).network, req.address);
    case 'evm.erc20.info': return await getErc20Info((await readSettings()).network, req.token);
    case 'evm.erc20.balance':
      return await getErc20Balance((await readSettings()).network, req.token, req.address);
    case 'evm.erc20.balances':
      return await getErc20Balances((await readSettings()).network, req.tokens, req.address);

    case 'evm.send.native': {
      await requireUnlocked();
      const settings = await readSettings();
      const acct = findAccount(req.from);
      const n = ensureFiniteNumber(req.amount, 'amount');
      if (n <= 0) throw new Error('Amount must be positive');
      try {
        return await submitSerialized(acct.address, () =>
          sendNative(settings.network, acct.privateKey, req.to, req.amount),
        );
      } catch (e) {
        throw new Error(friendlyError(e));
      }
    }

    case 'evm.send.erc20': {
      await requireUnlocked();
      const settings = await readSettings();
      const acct = findAccount(req.from);
      const n = ensureFiniteNumber(req.amount, 'amount');
      if (n <= 0) throw new Error('Amount must be positive');
      try {
        return await submitSerialized(acct.address, () =>
          sendErc20(settings.network, acct.privateKey, req.token, req.to, req.amount),
        );
      } catch (e) {
        throw new Error(friendlyError(e));
      }
    }

    case 'evm.send.nft': {
      await requireUnlocked();
      const settings = await readSettings();
      const acct = findAccount(req.from);
      // Basic shape validation. Full address validity is enforced
      // again in evm.ts, but failing fast here gives a friendlier
      // error before we even hit the queue.
      if (!/^0x[0-9a-fA-F]{40}$/.test(req.contract)) throw new Error('Invalid NFT contract');
      if (!/^0x[0-9a-fA-F]{40}$/.test(req.to)) throw new Error('Invalid recipient address');
      try {
        return await submitSerialized(acct.address, () =>
          sendNft(settings.network, acct.privateKey, req.contract, req.tokenId, req.to),
        );
      } catch (e) {
        throw new Error(friendlyError(e));
      }
    }

    case 'swap.quote': {
      const settings = await readSettings();
      ensureFiniteNumber(req.amountIn, 'amountIn');
      return await quoteSwap({
        network: settings.network,
        tokenIn: req.tokenIn,
        tokenOut: req.tokenOut,
        amountIn: req.amountIn,
      });
    }

    case 'swap.execute': {
      await requireUnlocked();
      const settings = await readSettings();
      const acct = findAccount(req.account);
      const inN = ensureFiniteNumber(req.amountIn, 'amountIn');
      const outN = ensureFiniteNumber(req.expectedOut, 'expectedOut');
      if (inN <= 0 || outN <= 0) throw new Error('Amounts must be positive');
      if (!Number.isFinite(req.slippageBps) || req.slippageBps < 0 || req.slippageBps > MAX_SLIPPAGE_BPS) {
        throw new Error(`Slippage must be 0–${MAX_SLIPPAGE_BPS / 100}%`);
      }
      try {
        return await submitSerialized(acct.address, async () => {
          let approval: { hash: string } | null = null;
          if (!isNativeAddress(req.tokenIn.address)) {
            const need = parseUnits(req.amountIn, req.tokenIn.decimals);
            const r = await ensureAllowance(settings.network, acct.privateKey, req.tokenIn.address, need);
            if (r) {
              if (r.status !== 'success') throw new Error('Token approval failed');
              approval = { hash: r.hash };
            }
          }
          const swap = await executeSwap({
            network: settings.network,
            privateKey: acct.privateKey,
            tokenIn: req.tokenIn,
            tokenOut: req.tokenOut,
            amountIn: req.amountIn,
            expectedOut: req.expectedOut,
            slippageBps: req.slippageBps,
            recipient: acct.address,
          });
          if (swap.status !== 'success') throw new Error('Swap reverted on-chain');
          return { approval, swap };
        });
      } catch (e) {
        throw new Error(friendlyError(e));
      }
    }

    case 'evm.sign.tx': {
      await requireUnlocked();
      const settings = await readSettings();
      const acct = findAccount(req.account);
      const tx = { ...req.tx, from: acct.address };
      try {
        return await submitSerialized(acct.address, () =>
          signGenericTransaction(settings.network, acct.privateKey, normalizeTxRequest(tx)),
        );
      } catch (e) {
        throw new Error(friendlyError(e));
      }
    }

    case 'evm.sign.message': {
      await requireUnlocked();
      const acct = findAccount(req.account);
      const signature = await personalSign(acct.privateKey, req.message);
      return { signature };
    }

    case 'evm.sign.typedData': {
      await requireUnlocked();
      const acct = findAccount(req.account);
      const signature = await signTypedDataV4(acct.privateKey, req.payload);
      return { signature };
    }

    case 'price.get': {
      const p = await getApePrice();
      return { usd: p.usd, eur: p.eur, gbp: p.gbp, ts: p.ts };
    }
    case 'dex.token': return await getApeChainPair(req.query);
    case 'dex.trending': return await getTrendingApeChainTokens(req.limit ?? 10);

    // ───────────────────── on-chain chat ─────────────────────
    case 'chat.list': {
      const settings = await readSettings();
      return await getRecentMessages(settings.network, req.limit ?? 15);
    }
    case 'chat.send': {
      await requireUnlocked();
      const acct = findAccount(req.account);
      // Hard-bind to the active account: any caller-supplied address that
      // isn't the currently-active wallet is rejected. Blocks a
      // hypothetical popup-XSS from posting/tipping out of dormant
      // accounts the user isn't looking at.
      const active = getActiveAccount();
      if (!active || active.address.toLowerCase() !== acct.address.toLowerCase()) {
        throw new Error('Chat actions are limited to the active account');
      }
      const settings = await readSettings();
      // Embed the sender's Yacht username so other Yacht clients can render
      // it in place of the raw EOA address.
      const username = await getOrCreateUsername(acct.id).catch(() => undefined);
      return await submitSerialized(acct.address, () =>
        sendChatMessage(settings.network, acct.privateKey, req.text, username),
      );
    }
    case 'chat.tip': {
      await requireUnlocked();
      const acct = findAccount(req.account);
      // See chat.send — same restriction. Defends against caller-supplied
      // dormant-account abuse if the popup-side gets compromised.
      const active = getActiveAccount();
      if (!active || active.address.toLowerCase() !== acct.address.toLowerCase()) {
        throw new Error('Chat actions are limited to the active account');
      }
      const settings = await readSettings();
      // Refuse to tip yourself — silly, wastes gas, and would inflate own
      // message totals on display.
      if (acct.address.toLowerCase() === req.toAuthor.toLowerCase()) {
        throw new Error('Cannot tip your own message');
      }
      // Reserve against the wallet's daily tip budget BEFORE submitting the
      // tx. If the on-chain transfer reverts we refund the budget so a
      // failed attempt doesn't burn the user's tip allowance for the day.
      const acctLc = acct.address.toLowerCase();
      const apeWei = parseUnits(req.apeAmount, 18);
      await reserveTipBudget(acctLc, apeWei);
      try {
        return await submitSerialized(acct.address, () =>
          sendTip(settings.network, acct.privateKey, req.toAuthor, req.messageHash, req.apeAmount),
        );
      } catch (e) {
        await releaseTipBudget(acctLc, apeWei);
        throw e;
      }
    }
    case 'chat.tips': {
      const settings = await readSettings();
      return await getTipsForMessages(settings.network, req.entries);
    }

    // ───────────────────── ranks / achievements ─────────────────────
    case 'achievements.snapshot': {
      return await readAchievementSnapshot(req.address);
    }
    case 'achievements.sync': {
      const settings = await readSettings();
      return await syncAchievements(settings.network, req.address, { force: req.force });
    }

    case 'username.get': {
      const u = await getOrCreateUsername(req.accountId);
      return { username: u };
    }
    case 'username.set': {
      const u = await setUsername(req.accountId, req.username);
      return { username: u };
    }
    case 'rank.get': {
      const settings = await readSettings();
      return await evaluateRankForAddress(settings.network, req.address, { force: req.force });
    }

    // ───────────────────── NFT discovery / voting ─────────────────────
    case 'nft.topcollections': {
      const settings = await readSettings();
      return await getTopNftCollections(settings.network);
    }
    case 'nft.listings': {
      const lc = req.contract.toLowerCase();
      const entry = TOP_NFT_REGISTRY.find((e) => e.contract.toLowerCase() === lc);
      if (!entry) throw new Error('Collection is not in the Top NFTs list');
      const price = await getApePrice().catch(() => null);
      const limit = Math.min(50, Math.max(1, req.limit ?? 30));
      return await getCollectionListings(entry.slug, {
        limit,
        apeUsd: price?.usd ?? 0,
        cursor: req.cursor,
      });
    }

    case 'nft.collectionFloor': {
      if (!/^0x[0-9a-fA-F]{40}$/.test(req.contract)) throw new Error('Invalid contract');
      return await getCollectionFloorByContract(OPENSEA_APECHAIN, req.contract);
    }
    case 'nft.detail': {
      if (!/^0x[0-9a-fA-F]{40}$/.test(req.contract)) throw new Error('Invalid contract');
      return await getNftDetailByContract(OPENSEA_APECHAIN, req.contract, req.tokenId);
    }

    case 'pfp.set': {
      await requireUnlocked();
      const acct = findAccount(req.account);
      const active = getActiveAccount();
      if (!active || active.address.toLowerCase() !== acct.address.toLowerCase()) {
        throw new Error('PFP changes are limited to the active account');
      }
      // Audit M14: rate-limit PFP publishes to one per 60 s per
      // account. Defends against a popup-XSS spam-publishing PFP
      // changes to drain the user's gas.
      enforcePfpCooldown(acct.address);
      const settings = await readSettings();
      try {
        return await submitSerialized(acct.address, () =>
          setOnChainPfp(settings.network, acct.privateKey, req.contract, req.tokenId),
        );
      } catch (e) {
        throw new Error(friendlyError(e));
      }
    }

    case 'pfp.clear': {
      await requireUnlocked();
      const acct = findAccount(req.account);
      const active = getActiveAccount();
      if (!active || active.address.toLowerCase() !== acct.address.toLowerCase()) {
        throw new Error('PFP changes are limited to the active account');
      }
      enforcePfpCooldown(acct.address);
      const settings = await readSettings();
      try {
        return await submitSerialized(acct.address, () =>
          clearOnChainPfp(settings.network, acct.privateKey),
        );
      } catch (e) {
        throw new Error(friendlyError(e));
      }
    }

    case 'pfp.get': {
      const settings = await readSettings();
      return await getOnChainPfp(settings.network, req.address, { force: req.force });
    }

    case 'dex.recentTrades': {
      const settings = await readSettings();
      if (!/^0x[0-9a-fA-F]{40}$/.test(req.pairAddress)) throw new Error('Invalid pair address');
      if (!/^0x[0-9a-fA-F]{40}$/.test(req.baseTokenAddress)) throw new Error('Invalid base token');
      return await getRecentTrades(
        settings.network,
        req.pairAddress,
        req.baseTokenAddress,
        req.baseDecimals ?? 18,
        req.quoteDecimals ?? 18,
        { limit: req.limit ?? 30 },
      );
    }

    case 'nft.collectionTraits': {
      const lc = req.contract.toLowerCase();
      const entry = TOP_NFT_REGISTRY.find((e) => e.contract.toLowerCase() === lc);
      if (!entry) throw new Error('Collection is not in the Top NFTs list');
      return await getCollectionTraits(entry.slug);
    }

    case 'users.top': {
      const settings = await readSettings();
      return await getTopUsers(settings.network, { force: req.force });
    }

    case 'tokens.top': {
      const settings = await readSettings();
      const limit = Math.min(50, Math.max(1, req.limit ?? 30));
      const [trending, tallies] = await Promise.all([
        getTrendingApeChainTokens(limit),
        getVoteTalliesForWeek(settings.network),
      ]);
      const merged = trending.map((p) => {
        const lc = (p.baseToken?.address ?? '').toLowerCase();
        const t = lc ? tallies[lc] : undefined;
        return { ...p, apeVoted: t?.apeTotal ?? 0, voteCount: t?.voteCount ?? 0 };
      });
      // Rank by APE voted desc; FDV (mcap proxy) breaks ties so the
      // chunky tokens settle above the long tail of zero-vote rows.
      merged.sort((a, b) => {
        if (b.apeVoted !== a.apeVoted) return b.apeVoted - a.apeVoted;
        return (b.fdv ?? b.marketCap ?? 0) - (a.fdv ?? a.marketCap ?? 0);
      });
      return merged;
    }

    case 'nft.buy': {
      await requireUnlocked();
      const acct = findAccount(req.account);
      const active = getActiveAccount();
      if (!active || active.address.toLowerCase() !== acct.address.toLowerCase()) {
        throw new Error('Buy is limited to the active account');
      }
      // Validate the listing's contract is in this wallet's allowed
      // collection list. Any contract not in the Top NFTs registry
      // is rejected — defence against the popup tricking us into
      // buying from an attacker collection.
      const lc = String(req.contract ?? '').toLowerCase();
      const entry = TOP_NFT_REGISTRY.find((e) => e.contract.toLowerCase() === lc);
      if (!entry) throw new Error('Buy refused: collection is not in the Top NFTs list');
      if (!/^0x[0-9a-fA-F]{64}$/.test(req.orderHash)) throw new Error('Invalid order hash');
      if (!/^0x[0-9a-fA-F]{40}$/.test(req.protocolAddress)) throw new Error('Invalid Seaport address');

      // Always round-trip to OpenSea's /listings/fulfillment_data so
      // we know which Seaport function this listing wants. Most
      // single-NFT fixed-price listings use the gas-optimized
      // `fulfillBasicOrder_efficient_6GL6yc`; encoding `fulfillOrder`
      // for those (what previous builds did) revert at simulation.
      // getFulfillmentTx maps the function name to the right
      // encoder per-listing AND surfaces the parsed offer so we
      // can verify it matches what the user clicked.
      const ful = await getFulfillmentTx(
        req.orderHash,
        req.protocolAddress,
        req.chain,
        acct.address,
      );
      // Audit H6: the offer extracted from the Seaport order MUST
      // match the contract+tokenId the popup confirmed. A poisoned
      // OpenSea fulfillment response could otherwise quietly route
      // the user's APE to a different NFT.
      const expectedContract = String(req.contract ?? '').toLowerCase();
      const expectedTokenId = String(req.tokenId ?? '');
      if (
        ful.offerContract.toLowerCase() !== expectedContract
        || ful.offerTokenId !== expectedTokenId
      ) {
        throw new Error(
          `Order mismatch: server returned ${ful.offerContract}:${ful.offerTokenId} but user clicked ${expectedContract}:${expectedTokenId}.`,
        );
      }
      const valueWei = (() => { try { return BigInt(ful.valueWei); } catch { return 0n; } })();
      const maxWei = parseUnits(req.maxApe, 18);
      // Slippage / drift guard: reject if the encoded native value
      // exceeds the cap the user confirmed at click-time.
      if (valueWei > maxWei) {
        throw new Error(
          `Listing requires ${formatUnits(valueWei, 18)} APE but you confirmed ${req.maxApe} APE.`,
        );
      }
      if (valueWei <= 0n) throw new Error('Listing has zero price — refusing');
      if (valueWei > parseUnits('100000', 18)) throw new Error('Listing price exceeds wallet cap');

      const settings = await readSettings();

      // Pre-flight simulation — ADVISORY ONLY. Seaport reverts use
      // custom errors that ethers doesn't auto-decode, so a "reverted"
      // simulation can mean any of: expired order, conduit edge case,
      // RPC simulation environment differing from real execution. We
      // log the suspect reason and proceed; the real submission gives
      // the user a faithful answer if it really does revert.
      const sim = await simulateTransaction(settings.network, {
        from: acct.address,
        to: ful.to,
        value: ful.valueWei,
        data: ful.data,
      }).catch(() => ({ ok: false, revertReason: undefined } as const));
      if (!sim.ok) {
        console.warn(
          '[Yacht] NFT buy pre-flight returned a revert; submitting anyway.',
          sim.revertReason ?? '(no decoded reason)',
        );
      }

      const result = await submitSerialized(acct.address, () =>
        signGenericTransaction(settings.network, acct.privateKey, normalizeTxRequest({
          from: acct.address,
          to: ful.to,
          data: ful.data,
          value: ful.valueWei,
        })),
      ).catch((e) => { throw new Error(friendlyError(e)); });

      // Yacht 0.5% fee — fire-and-forget AFTER a successful buy.
      // If the fee tx fails for any reason (gas spike, RPC blip),
      // the user still has the NFT. The buy is the user's primary
      // intent; the fee is Yacht's revenue and is intentionally
      // never allowed to block or revert it.
      if (result.status === 'success') {
        try {
          const feeWei = (valueWei * 50n) / 10000n; // 0.5% (50 bps)
          if (feeWei > 0n) {
            // Don't await — let it run in the background.
            void submitSerialized(acct.address, () =>
              sendNative(settings.network, acct.privateKey, TRADING_FEE_TREASURY, formatUnits(feeWei, 18)),
            ).catch((e) => {
              console.warn('[Yacht] NFT fee tx failed (best-effort):', e);
            });
          }
        } catch { /* never block on fee path */ }
      }
      return result;
    }

    case 'nft.vote': {
      await requireUnlocked();
      const acct = findAccount(req.account);
      // Hard-bind to active account, same model as chat.send / chat.tip:
      // a popup-XSS can't drain a dormant account through this RPC.
      const active = getActiveAccount();
      if (!active || active.address.toLowerCase() !== acct.address.toLowerCase()) {
        throw new Error('Voting is limited to the active account');
      }
      // Voting accepts any contract — the on-chain vote tx is a
      // tiny APE transfer to the treasury, and the display lists
      // (Top NFTs, Top Tokens) only render votes for contracts in
      // their respective registries. Spam votes on random contracts
      // are invisible — they just contribute to the treasury.
      if (!/^0x[0-9a-fA-F]{40}$/.test(req.collection)) {
        throw new Error('Invalid contract address');
      }
      if (!(VOTE_AMOUNTS as readonly string[]).includes(req.apeAmount)) {
        throw new Error('Invalid vote amount');
      }
      // Reuse the chat-tip daily budget for vote spend. Both flows
      // auto-confirm without a separate approval popup; combining the
      // budget keeps the day's total auto-confirmed APE outflow capped
      // regardless of mix between tips and votes.
      const settings = await readSettings();
      const acctLc = acct.address.toLowerCase();
      const apeWei = parseUnits(req.apeAmount, 18);
      await reserveTipBudget(acctLc, apeWei);
      try {
        return await submitSerialized(acct.address, () =>
          castVote(settings.network, acct.privateKey, req.collection, req.apeAmount),
        );
      } catch (e) {
        await releaseTipBudget(acctLc, apeWei);
        throw e;
      }
    }

    // ───────────────────── dApp-originated ─────────────────────
    case 'dapp.connect': {
      if (!isDappRequest) throw new Error('Bad routing');
      await loadApprovedOrigins();
      const origin = senderOrigin(sender);
      if (!origin) throw new Error('Could not determine origin');
      rateLimitOrigin(origin);
      const settings = await readSettings();
      const cfg = NETWORKS[settings.network];
      if (state.approvedOrigins.has(origin) && isUnlocked()) {
        const a = getActiveAccount();
        if (a) return { address: a.address, chainId: cfg.chainIdHex };
      }
      const r = await openApprovalPopup({
        type: 'connect',
        origin,
        payload: { origin },
        // connect doesn't sign, so no accountId binding is required.
        sourceWindowId: sender?.tab?.windowId,
      });
      return r;
    }

    case 'dapp.getAddress': {
      if (!isDappRequest) throw new Error('Bad routing');
      await loadApprovedOrigins();
      const origin = senderOrigin(sender);
      rateLimitOrigin(origin);
      if (!state.approvedOrigins.has(origin)) throw new Error('Origin not connected');
      if (!isUnlocked()) throw new Error('Wallet locked');
      const a = getActiveAccount();
      if (!a) throw new Error('No active account');
      const settings = await readSettings();
      const cfg = NETWORKS[settings.network];
      return { address: a.address, chainId: cfg.chainIdHex, network: settings.network };
    }

    case 'dapp.signTx': {
      if (!isDappRequest) throw new Error('Bad routing');
      await loadApprovedOrigins();
      const origin = senderOrigin(sender);
      rateLimitOrigin(origin);
      if (!state.approvedOrigins.has(origin)) throw new Error('Origin not connected');

      const active = getActiveAccount();
      if (!active) throw new Error('Wallet locked');
      // SECURITY: only forward semantic fields the dApp must specify. Strip
      // gas / fee / nonce / chainId — the wallet derives those itself. This
      // blocks the "0 value, 30M gas, infinite fee → drain user's APE in
      // fees" attack class.
      const tx: UnsignedEvmTx = {
        from: active.address,
        to: req.tx.to,
        value: req.tx.value,
        data: req.tx.data,
      };

      const risk = assessTxRisk(tx);
      const settings = await readSettings();
      const dataAnalysis = analyzeTxData(typeof tx.data === 'string' ? tx.data : '0x', toBigint(tx.value));
      const sim = await simulateTransaction(settings.network, {
        from: active.address,
        to: tx.to,
        value: tx.value,
        data: typeof tx.data === 'string' ? tx.data : undefined,
      });

      const warnings = [
        ...(risk.warnings ?? []),
        ...(dataAnalysis.warnings ?? []),
      ];
      if (!sim.ok) {
        warnings.push(
          sim.revertReason
            ? `Simulation reverted: "${sim.revertReason}". The transaction will fail and you will lose gas.`
            : 'Simulation failed to confirm the transaction would succeed. Proceed with caution.',
        );
      }

      return await openApprovalPopup({
        type: 'signTx',
        origin,
        payload: {
          tx,
          origin,
          warnings,
          dataAnalysis,
          simulation: sim,
        },
        accountId: active.id,
        sourceWindowId: sender?.tab?.windowId,
      });
    }

    case 'dapp.personalSign': {
      if (!isDappRequest) throw new Error('Bad routing');
      await loadApprovedOrigins();
      const origin = senderOrigin(sender);
      rateLimitOrigin(origin);
      if (!state.approvedOrigins.has(origin)) throw new Error('Origin not connected');
      const active = getActiveAccount();
      if (!active) throw new Error('Wallet locked');
      // SECURITY: refuse to sign anything that looks like a raw 32-byte hash.
      // Even with EIP-191's prefix, signing an opaque digest the user cannot
      // read is the canonical phishing pattern. A legitimate dApp can always
      // wrap the digest in a human-readable string. Reject at the gateway.
      const a = analyzePersonalSign(req.message, origin);
      if (a.isRawHash) {
        throw new Error(
          'Refused to sign a raw 32-byte hash. Yacht only signs human-readable messages.',
        );
      }
      return await openApprovalPopup({
        type: 'personalSign',
        origin,
        payload: { message: req.message, origin, warnings: a.warnings, isRawHash: a.isRawHash },
        accountId: active.id,
        sourceWindowId: sender?.tab?.windowId,
      });
    }

    case 'dapp.signTypedData': {
      if (!isDappRequest) throw new Error('Bad routing');
      await loadApprovedOrigins();
      const origin = senderOrigin(sender);
      rateLimitOrigin(origin);
      if (!state.approvedOrigins.has(origin)) throw new Error('Origin not connected');
      const active = getActiveAccount();
      if (!active) throw new Error('Wallet locked');
      const cfg = NETWORKS[(await readSettings()).network];
      const analysis = analyzeTypedData(req.payload, cfg.chainId);
      return await openApprovalPopup({
        type: 'signTypedData',
        origin,
        payload: { typedData: req.payload, origin, analysis },
        accountId: active.id,
        sourceWindowId: sender?.tab?.windowId,
      });
    }

    case 'dapp.rpc': {
      // Read-only chain queries (eth_getBalance, eth_estimateGas, eth_call,
      // eth_getLogs, eth_blockNumber, etc). Forwarded to ApeChain RPC. The
      // method whitelist lives in lib/evm.ts (SAFE_PASSTHROUGH_METHODS).
      // Approval-requiring methods (sign / send) are NOT routed here — they
      // have their own dedicated handlers above.
      if (!isDappRequest) throw new Error('Bad routing');
      await loadApprovedOrigins();
      const origin = senderOrigin(sender);
      rateLimitOrigin(origin);
      if (!state.approvedOrigins.has(origin)) throw new Error('Origin not connected');
      // Lock = silence. While the wallet is locked, even approved origins
      // cannot use the wallet's RPC for fingerprinting / chain monitoring.
      if (!isUnlocked()) throw new Error('Wallet locked');
      const settings = await readSettings();
      return await dappRpc(settings.network, req.method, req.params);
    }

    // ───────────────────── popup → background (request UI) ─────
    case 'request.list': return [...state.pending.values()].map(stripCallbacks);
    case 'request.get': {
      const r = state.pending.get(req.id);
      return r ? stripCallbacks(r) : null;
    }
    case 'request.approve': {
      // SECURITY: the popup signals "user approved request <id>" with NO
      // payload. The background re-reads its own copy of the pending payload
      // and performs the action server-side, so a compromised popup cannot
      // substitute the tx body between display and signing. The popup's only
      // authority is yes/no on a request the background already minted.
      const pending = state.pending.get(req.id);
      if (!pending) throw new Error('Request not found');
      await requireUnlocked();
      const settings = await readSettings();
      const cfg = NETWORKS[settings.network];
      // Audit H2: sign with EXACTLY the account that was bound to this
      // pending request at dispatch time. If the active account changed
      // between dispatch and click (e.g. user switched accounts in the
      // side panel), we still sign as the originally-displayed account
      // — never let the "from" the user reviewed diverge from the key
      // we sign with. For request types that don't need a key (connect)
      // accountId may be undefined, so we fall back to active.
      const acct = pending.accountId
        ? state.unlocked!.accounts.find((a) => a.id === pending.accountId)
        : (() => {
            const a = getActiveAccount();
            return a ? state.unlocked!.accounts.find((x) => x.id === a.id) : undefined;
          })();
      if (!acct) throw new Error('Account from this request is no longer available');

      try {
        // TOCTOU guard: re-check unlock state immediately before each sign.
        // If the auto-lock alarm fired between approval-start and now, fail
        // safe rather than completing a sign post-lock.
        const assertStillUnlocked = () => {
          if (!isUnlocked()) throw new Error('Wallet locked during approval');
        };
        let result: unknown;
        if (pending.type === 'connect') {
          result = { address: acct.address, chainId: cfg.chainIdHex };
        } else if (pending.type === 'signTx') {
          const p = pending.payload as { tx: UnsignedEvmTx };
          // Re-strip dangerous fields defensively. tx.from was forced at
          // dispatch time but a future code path could mutate the pending
          // entry — never trust pending.payload.tx fields beyond to/value/data.
          const safe: UnsignedEvmTx = {
            from: acct.address,
            to: p.tx.to,
            value: p.tx.value,
            data: p.tx.data,
          };
          assertStillUnlocked();
          result = await submitSerialized(acct.address, () => {
            assertStillUnlocked();
            return signGenericTransaction(settings.network, acct.privateKey, normalizeTxRequest(safe));
          });
          // Achievement signal: a successful signTx from opensea.io
          // is treated as "bought an NFT on OpenSea". Buys go through
          // Seaport's fulfillBasicOrder / fulfillOrder; listings use
          // signTypedData (no signTx needed). A successful tx from
          // opensea.io.* is a strong proxy for a Seaport buy.
          const r = result as { status?: string } | undefined;
          if (r?.status === 'success' && isOpenseaHost(hostFromOrigin(pending.origin))) {
            void recordOpenseaNftPurchase(acct.address);
          }
        } else if (pending.type === 'personalSign') {
          const p = pending.payload as { message: string };
          assertStillUnlocked();
          const signature = await personalSign(acct.privateKey, p.message);
          result = { signature };
        } else if (pending.type === 'signTypedData') {
          const p = pending.payload as { typedData: TypedDataPayload };
          assertStillUnlocked();
          const signature = await signTypedDataV4(acct.privateKey, p.typedData);
          result = { signature };
        } else {
          throw new Error('Unknown approval type');
        }
        pending.resolve(result);
        state.pending.delete(req.id);
        return { ok: true };
      } catch (e) {
        // Don't leak the dApp's pending Promise — reject it too so the dApp
        // sees an error instead of hanging.
        pending.reject(new Error(safeError(e)));
        state.pending.delete(req.id);
        throw new Error(friendlyError(e));
      }
    }
    case 'request.reject': {
      const r = state.pending.get(req.id);
      if (!r) throw new Error('Request not found');
      r.reject(new Error(req.error || 'User rejected'));
      state.pending.delete(req.id);
      return { ok: true };
    }

    // Origin management (popup-only)
    case 'origins.list': return [...state.approvedOrigins];
    case 'origins.revoke': {
      state.approvedOrigins.delete(req.origin);
      await persistApprovedOrigins();
      // Mark the active account as having revoked at least one site so the
      // corresponding achievement unlocks. Revocation isn't observable on
      // chain, so this signal is stored locally per address.
      const activeForRevoke = getActiveAccount();
      if (activeForRevoke) {
        void recordRevokedSite(activeForRevoke.address);
      }
      return { ok: true };
    }

    // Layout (popup vs side panel)
    case 'layout.get': return { mode: await readLayoutMode() };
    case 'layout.set': {
      // Only accept the layout flip from the wallet's own popup / side panel
      // — not from arbitrary extension pages. Even though `fromExtension` is
      // already enforced above, this hardens against an XSS in some other
      // extension page being able to flip the user's UI surface to disorient
      // them right before an approval. sender.url for our popup is the
      // chrome-extension origin + index.html (with optional query / hash).
      const url = sender?.url ?? '';
      const expected = chrome.runtime.getURL('index.html');
      if (!url.startsWith(expected)) {
        throw new Error('layout.set: unexpected sender');
      }
      if (req.mode !== 'popup' && req.mode !== 'sidepanel') {
        throw new Error('layout.set: invalid mode');
      }
      await chrome.storage.local.set({ [LAYOUT_KEY]: req.mode });
      await applyLayoutMode(req.mode);
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (req.mode === 'sidepanel' && tab?.id != null) {
        // Open it on the active tab so the user sees the wallet move
        // there immediately. (Best-effort — Chrome may require the call to
        // come from a user-gesture context; the popup also tries directly.)
        try { await chrome.sidePanel.open({ tabId: tab.id }); } catch { /* ignore */ }
      }
      if (req.mode === 'popup' && tab?.id != null) {
        // Open the popup synchronously (still in user-gesture window) so it
        // shows up before the side panel is dismissed.
        try { await chrome.action.openPopup(); } catch { /* ignore */ }
        // Disable the side panel on the active tab so it disappears.
        try { await chrome.sidePanel.setOptions({ tabId: tab.id, enabled: false }); } catch { /* ignore */ }
        // Re-enable for next toggle, restoring the sidepanel-mode default path.
        try {
          await chrome.sidePanel.setOptions({
            tabId: tab.id,
            enabled: true,
            path: 'index.html?sidepanel=1',
          });
        } catch { /* ignore */ }
      }
      return { ok: true };
    }
  }
}

function toBigint(v: unknown): bigint {
  if (v == null) return 0n;
  if (typeof v === 'bigint') return v;
  try {
    if (typeof v === 'string') return v.startsWith('0x') ? BigInt(v) : BigInt(v);
    if (typeof v === 'number') return BigInt(v);
  } catch { /* ignore */ }
  return 0n;
}

function normalizeTxRequest(tx: UnsignedEvmTx) {
  const out: any = { ...tx };
  for (const k of ['value', 'gas', 'gasLimit', 'gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas', 'nonce', 'chainId']) {
    const v = (out as any)[k];
    if (v == null) continue;
    if (typeof v === 'string') {
      try {
        (out as any)[k] = v.startsWith('0x') ? BigInt(v) : BigInt(v);
      } catch { /* leave as-is */ }
    }
  }
  if (out.gas != null && out.gasLimit == null) {
    out.gasLimit = out.gas;
    delete out.gas;
  }
  return out;
}

// ───────────────────── message listener ──────────────────────────────────

chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
  const env = msg as RpcEnvelope | undefined;
  if (!env || env.rpc !== 'yacht') return false;

  (async () => {
    try {
      const result = await handle(env.request, sender);
      const reply: RpcReply = { ok: true, result };
      sendResponse(reply);
    } catch (e) {
      const reply: RpcReply = { ok: false, error: safeError(e) };
      sendResponse(reply);
    }
  })();
  return true;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes['yacht.settings.v1']) void setAutoLockAlarm();
});
