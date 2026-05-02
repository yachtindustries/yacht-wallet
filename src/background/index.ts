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
  rewriteVault,
  unlockVault,
  changePassword,
  VaultAccount,
} from '@/lib/vault';
import {
  getAccountSummary,
  getErc20Balance,
  getErc20Balances,
  getErc20Info,
  getHistory,
  getOwnedNfts,
  personalSign,
  sendErc20,
  sendNative,
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
import { parseUnits } from 'ethers';
import {
  deriveAccount,
  generateMnemonic,
  isValidMnemonic,
  walletFromPrivateKey,
} from '@/lib/wallet-utils';
import { NETWORKS, readSettings, writeSettings } from '@/lib/networks';
import { getApePrice } from '@/lib/price';
import { getApeChainPair, getTrendingApeChainTokens } from '@/lib/dexscreener';
import { friendlyError } from '@/lib/errors';
import { assessTxRisk, hostFromOrigin } from '@/lib/security';
import {
  PendingRequest,
  RpcEnvelope,
  RpcReply,
  RpcRequest,
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
const MAX_SLIPPAGE_BPS = 2000;     // 20%
// Per-origin RPC rate limit: leaky bucket capping a dApp at this many
// background-served calls per minute. Defends against fingerprinting loops
// (calling getAddress in a tight while(true)) and popup spam.
const ORIGIN_RPC_BUDGET_PER_MIN = 120;

function uuid(): string {
  return crypto.randomUUID();
}

async function setAutoLockAlarm(): Promise<void> {
  const settings = await readSettings();
  await chrome.alarms.clear(AUTO_LOCK_ALARM);
  if (settings.autoLockMinutes > 0) {
    await chrome.alarms.create(AUTO_LOCK_ALARM, { delayInMinutes: settings.autoLockMinutes });
  }
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === AUTO_LOCK_ALARM) {
    lock();
    cachedPassword = null;
    submissionQueues.clear();
    void clearSession();
  }
});

void loadApprovedOrigins();

// ───────────────────── unlock brute-force protection ─────────────────────
let unlockFailures = 0;
let unlockLockedUntil = 0;

function unlockTryAllowed(): { allowed: true } | { allowed: false; waitMs: number } {
  if (Date.now() < unlockLockedUntil) {
    return { allowed: false, waitMs: unlockLockedUntil - Date.now() };
  }
  return { allowed: true };
}

function unlockSucceeded(): void {
  unlockFailures = 0;
  unlockLockedUntil = 0;
}

function unlockFailed(): void {
  unlockFailures++;
  if (unlockFailures >= MAX_UNLOCK_FAILURES) {
    const factor = Math.pow(2, Math.min(6, unlockFailures - MAX_UNLOCK_FAILURES));
    unlockLockedUntil = Date.now() + UNLOCK_LOCKOUT_MS * factor;
  }
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

// Mirror unlocked vault into chrome.storage.session so MV3 service-worker
// terminations don't appear to "lock" the wallet every minute. session storage
// lives in browser-process RAM; it never touches disk and is wiped on browser
// restart. The same auto-lock alarm still tears down the session on schedule.
const SESSION_KEY = 'yacht.session.v1';
const SESSION_GRACE_MS = 60 * 60 * 1000; // 1h hard cap regardless of alarm fate

interface SessionBlob {
  unlocked: typeof state.unlocked;
  unlockedAt: number;
  password: string;
  expiresAt: number;
}

async function writeSession(): Promise<void> {
  if (!state.unlocked || !cachedPassword) return;
  const blob: SessionBlob = {
    unlocked: state.unlocked,
    unlockedAt: state.unlockedAt,
    password: cachedPassword,
    expiresAt: Date.now() + SESSION_GRACE_MS,
  };
  try {
    await chrome.storage.session.set({ [SESSION_KEY]: blob });
  } catch { /* session API unavailable — skip */ }
}

async function clearSession(): Promise<void> {
  try { await chrome.storage.session.remove(SESSION_KEY); } catch { /* ignore */ }
}

let rehydratePromise: Promise<void> | null = null;
async function rehydrateFromSession(): Promise<void> {
  if (state.unlocked) return;
  try {
    const r = await chrome.storage.session.get(SESSION_KEY);
    const blob = r[SESSION_KEY] as SessionBlob | undefined;
    if (!blob) return;
    if (Date.now() > blob.expiresAt) {
      await clearSession();
      return;
    }
    state.unlocked = blob.unlocked;
    state.unlockedAt = blob.unlockedAt;
    cachedPassword = blob.password;
  } catch { /* ignore */ }
}
function ensureRehydrated(): Promise<void> {
  return (rehydratePromise ??= rehydrateFromSession());
}

async function rememberPasswordAndLoad(password: string) {
  state.unlocked = await unlockVault(password);
  state.unlockedAt = Date.now();
  cachedPassword = password;
  await writeSession();
  void setAutoLockAlarm();
}

async function persistUnlocked() {
  if (!state.unlocked) throw new Error('Vault not unlocked');
  if (!cachedPassword) throw new Error('Session expired — please unlock again');
  await rewriteVault(cachedPassword, state.unlocked);
  await writeSession();
}

let cachedPassword: string | null = null;

function stripCallbacks(p: PendingRequest & { resolve: any; reject: any }): PendingRequest {
  const { resolve: _r, reject: _j, ...rest } = p;
  return rest;
}

async function openApprovalPopup(opts: {
  type: 'connect' | 'signTx' | 'personalSign' | 'signTypedData';
  origin: string;
  payload: unknown;
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
      resolve: (v) => {
        if (opts.type === 'connect') {
          state.approvedOrigins.add(opts.origin);
          void persistApprovedOrigins();
        }
        resolve(v);
      },
      reject,
    });
    chrome.windows.create({
      url: chrome.runtime.getURL(`index.html#/request/${id}`),
      type: 'popup',
      width: 380,
      height: 620,
    });
  });
}

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

async function handle(req: RpcRequest, sender: chrome.runtime.MessageSender | undefined): Promise<unknown> {
  // After an MV3 service-worker restart, in-memory unlocked state is gone but
  // we may still have a valid session blob — rehydrate before any handler runs.
  await ensureRehydrated();

  const isDappRequest = req.type.startsWith('dapp.');
  const fromExtension = isFromExtension(sender);

  if (!fromExtension) {
    throw new Error('Unauthorized sender');
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
      await createVault(req.password, {
        mnemonic,
        nextDerivationIndex: 1,
        accounts: [account],
        activeAccountId: account.id,
      });
      await rememberPasswordAndLoad(req.password);
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
      await createVault(req.password, {
        mnemonic: req.mnemonic.trim(),
        nextDerivationIndex: 1,
        accounts: [account],
        activeAccountId: account.id,
      });
      await rememberPasswordAndLoad(req.password);
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
      await createVault(req.password, {
        mnemonic: null,
        nextDerivationIndex: 0,
        accounts: [account],
        activeAccountId: account.id,
      });
      await rememberPasswordAndLoad(req.password);
      return { address: account.address };
    }

    case 'vault.unlock': {
      const gate = unlockTryAllowed();
      if (!gate.allowed) {
        throw new Error(`Too many failed attempts. Try again in ${Math.ceil(gate.waitMs / 1000)}s.`);
      }
      try {
        await rememberPasswordAndLoad(req.password);
        unlockSucceeded();
      } catch {
        unlockFailed();
        throw new Error('Incorrect password');
      }
      return { ok: true };
    }

    case 'vault.lock': {
      lock();
      cachedPassword = null;
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
      const data = await unlockVault(req.password);
      const a = data.accounts.find((x) => x.id === req.id);
      if (!a) throw new Error('Account not found');
      return { privateKey: a.privateKey };
    }

    case 'vault.mnemonic.reveal': {
      const data = await unlockVault(req.password);
      return { mnemonic: data.mnemonic };
    }

    case 'vault.changePassword': {
      await changePassword(req.oldPw, req.newPw);
      cachedPassword = req.newPw;
      return { ok: true };
    }

    case 'vault.destroy': {
      try {
        await unlockVault(req.password);
      } catch {
        throw new Error('Incorrect password');
      }
      await destroyVault();
      lock();
      cachedPassword = null;
      state.approvedOrigins.clear();
      await persistApprovedOrigins();
      submissionQueues.clear();
      await clearSession();
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
      const r = await openApprovalPopup({ type: 'connect', origin, payload: { origin } });
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
      const tx: UnsignedEvmTx = { ...req.tx, from: active.address };

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
      const a = analyzePersonalSign(req.message);
      return await openApprovalPopup({
        type: 'personalSign',
        origin,
        payload: { message: req.message, origin, warnings: a.warnings, isRawHash: a.isRawHash },
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
      });
    }

    // ───────────────────── popup → background (request UI) ─────
    case 'request.list': return [...state.pending.values()].map(stripCallbacks);
    case 'request.get': {
      const r = state.pending.get(req.id);
      return r ? stripCallbacks(r) : null;
    }
    case 'request.resolve': {
      const r = state.pending.get(req.id);
      if (!r) throw new Error('Request not found');
      r.resolve(req.result);
      state.pending.delete(req.id);
      return { ok: true };
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
