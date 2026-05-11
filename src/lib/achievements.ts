// Yacht achievements. Achievements are FOREVER once unlocked: even if the
// wallet later sells the holding that triggered them, the achievement stays.
// We persist newly-unlocked achievements to chrome.storage.local keyed by
// account address. Conditions are evaluated against on-chain history at sync
// time, so a fresh install on the same address re-derives every prior
// unlock from chain data.
//
// Storage shape (`yacht.achievements.v1`):
//
//   {
//     [accountAddress.toLowerCase()]: {
//       achievements: { [id]: { unlockedAt: number /* ms */ } },
//       lastSyncedAt: number /* ms */,
//     }
//   }
//
// Sync is rate-limited to once-per-minute per address. The popup may call
// `achievements.sync` whenever it opens; if the cache is fresh enough we
// return immediately without re-fetching chain history.

import { formatUnits } from 'ethers';
import { NETWORKS, type NetworkId } from './networks';
import { CAMELOT_V2_ROUTER, TRADING_FEE_TREASURY } from './camelot';
import { CURTIS, BLUE, MURTIS } from './tokens';
import { TIP_MAGIC, YACHT_CHAT_INBOX } from './chat';
// Static imports: MV3 service workers can be flaky with dynamic `import()`,
// and we'd rather pay the (tiny) startup cost than have the achievement
// sync silently fail to load its dependencies on some Chrome versions.
import { getAccountSummary, getErc20Balances, getOwnedNfts } from './evm';
import { getApePrice } from './price';
import { getApeChainPair } from './dexscreener';
import { getCollectionFloorByContract, OPENSEA_APECHAIN } from './opensea';
import { computeRank, progressToNextUsd } from './ranks';

// ─── Achievement definitions ───────────────────────────────────────────────

export interface AchievementDef {
  id: string;
  /** User-facing description rendered in the achievements list. */
  text: string;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'chat-1msg',                text: 'Send a message in chat' },
  { id: 'chat-50msg',               text: 'Send 50 messages in chat' },
  { id: 'chat-7day-streak',         text: 'Send a message in chat 7 days in a row' },
  { id: 'tip-1',                    text: 'Tip someone in chat' },
  { id: 'tip-50-distinct',          text: 'Tip 50 different people in chat' },
  { id: 'swap-1',                   text: 'Swap a token' },
  { id: 'swap-7day-streak',         text: 'Do 1 swap every day for 7 days in a row' },
  { id: 'swap-100usd',              text: 'Do a $100 swap' },
  { id: 'swap-1000usd',             text: 'Do a $1000 swap' },
  { id: 'hold-300usd',              text: 'Hold $300 of assets' },
  { id: 'hold-3000usd',             text: 'Hold $3000 of assets' },
  { id: 'hold-curtis-100',          text: 'Hold $100 of CURTIS' },
  { id: 'hold-curtis-1000',         text: 'Hold $1000 of CURTIS' },
  { id: 'swap-50',                  text: 'Do 50 swaps' },
  { id: 'collect-curtis-blue-murtis', text: 'Acquire CURTIS, BLUE, and MURTIS' },
  { id: 'swap-to-stable',           text: 'Swap into a stablecoin (USDC or USDT)' },
  { id: 'revoke-site',              text: 'Revoke a connected site' },
  { id: 'send-curtis',              text: 'Send CURTIS to someone' },
  { id: 'receive-curtis-from-team', text: 'Receive CURTIS from a Yacht team member' },
  { id: 'connect-opensea',          text: 'Connect your wallet to OpenSea' },
  { id: 'buy-opensea-nft',          text: 'Buy an ApeChain NFT on OpenSea' },
  { id: 'pfp-set',                  text: 'Set an NFT as your profile picture' },
];

export const TOTAL_ACHIEVEMENTS = ACHIEVEMENTS.length;

// ─── Constants ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'yacht.achievements.v1';
// Short cache window: just enough to debounce repeated UI opens within a
// few seconds. Long enough that we're not hammering Etherscan; short enough
// that an action the user just performed shows up on the next screen open.
const SYNC_TTL_MS = 10_000;

const STABLES_LC = new Set<string>([
  '0xf1815bd50389c46847f0bda824ec8da914045d14', // USDC on ApeChain
  '0x674843c06ff83502ddb4d37c2e09c01cda38cbc8', // USDT on ApeChain
]);
const TEAM_MEMBER_LC = '0x1215c213767772de4b3b0d02db79df4459e5b590';

// We track local-only signals (e.g. "user revoked a site") in a sibling
// store because they don't show up in chain history.
const LOCAL_SIGNALS_KEY = 'yacht.achievementSignals.v1';

interface LocalSignals {
  /** Address-keyed: did this account ever revoke an approved origin? */
  revokedSite?: { [address: string]: boolean };
  /** Address-keyed: did this account ever connect to opensea.io? */
  connectedOpensea?: { [address: string]: boolean };
  /** Address-keyed: did this account ever sign a successful tx targeting
   * an OpenSea Seaport contract from opensea.io? Treated as "bought a
   * Seaport-listed item" — covers ApeChain NFT purchases. */
  boughtOpenseaNft?: { [address: string]: boolean };
  /** Address-keyed: did this account ever set an NFT as its PFP? */
  setPfp?: { [address: string]: boolean };
}

// ─── Storage helpers ───────────────────────────────────────────────────────

interface PerAccountState {
  achievements: { [id: string]: { unlockedAt: number } };
  lastSyncedAt: number;
}
type StorageShape = { [address: string]: PerAccountState };

async function readStore(): Promise<StorageShape> {
  try {
    const r = await chrome.storage.local.get(STORAGE_KEY);
    const v = r[STORAGE_KEY];
    return v && typeof v === 'object' ? (v as StorageShape) : {};
  } catch {
    return {};
  }
}

async function writeStore(s: StorageShape): Promise<void> {
  try { await chrome.storage.local.set({ [STORAGE_KEY]: s }); } catch { /* best effort */ }
}

async function readSignals(): Promise<LocalSignals> {
  try {
    const r = await chrome.storage.local.get(LOCAL_SIGNALS_KEY);
    const v = r[LOCAL_SIGNALS_KEY];
    return v && typeof v === 'object' ? (v as LocalSignals) : {};
  } catch {
    return {};
  }
}

async function writeSignals(s: LocalSignals): Promise<void> {
  try { await chrome.storage.local.set({ [LOCAL_SIGNALS_KEY]: s }); } catch { /* best effort */ }
}

/**
 * Mark that this account has revoked at least one connected site. Called from
 * the background when the user clicks Revoke on the Connected Sites screen.
 */
export async function recordRevokedSite(address: string): Promise<void> {
  const s = await readSignals();
  const map = s.revokedSite ?? {};
  map[address.toLowerCase()] = true;
  await writeSignals({ ...s, revokedSite: map });
}

/** Mark that this account connected to opensea.io. */
export async function recordOpenseaConnect(address: string): Promise<void> {
  const s = await readSignals();
  const map = s.connectedOpensea ?? {};
  map[address.toLowerCase()] = true;
  await writeSignals({ ...s, connectedOpensea: map });
}

/** Mark that this account submitted a successful Seaport tx from opensea.io. */
export async function recordOpenseaNftPurchase(address: string): Promise<void> {
  const s = await readSignals();
  const map = s.boughtOpenseaNft ?? {};
  map[address.toLowerCase()] = true;
  await writeSignals({ ...s, boughtOpenseaNft: map });
}

/** Mark that this account picked an NFT for its profile picture. */
export async function recordPfpSet(address: string): Promise<void> {
  const s = await readSignals();
  const map = s.setPfp ?? {};
  map[address.toLowerCase()] = true;
  await writeSignals({ ...s, setPfp: map });
}

// ─── Public read API ───────────────────────────────────────────────────────

export interface AchievementSnapshot {
  unlocked: string[];           // achievement ids
  total: number;                // ACHIEVEMENT count
  lastSyncedAt: number;
}

export async function readAchievementSnapshot(address: string): Promise<AchievementSnapshot> {
  const store = await readStore();
  const cur = store[address.toLowerCase()];
  return {
    unlocked: cur ? Object.keys(cur.achievements) : [],
    total: TOTAL_ACHIEVEMENTS,
    lastSyncedAt: cur?.lastSyncedAt ?? 0,
  };
}

// ─── Sync (chain evaluation + persist) ─────────────────────────────────────

interface RawTx {
  hash?: string;
  from?: string;
  to?: string;
  value?: string;
  input?: string;
  timeStamp?: string;
  isError?: string;
  txreceipt_status?: string;
}

interface RawTokenTx {
  hash?: string;
  from?: string;
  to?: string;
  value?: string;
  contractAddress?: string;
  tokenSymbol?: string;
  tokenDecimal?: string;
  timeStamp?: string;
}

async function explorer<T>(network: NetworkId, params: Record<string, string>): Promise<T[]> {
  const cfg = NETWORKS[network];
  const merged: Record<string, string> = { ...params };
  if (cfg.apiChainParam) merged.chainid = cfg.apiChainParam;
  if (cfg.apiKey) merged.apikey = cfg.apiKey;
  const qs = new URLSearchParams(merged).toString();
  try {
    const r = await fetch(`${cfg.apiBase}?${qs}`);
    if (!r.ok) return [];
    const j: any = await r.json();
    return Array.isArray(j.result) ? (j.result as T[]) : [];
  } catch {
    return [];
  }
}

interface SyncContext {
  txs: RawTx[];          // sender or receiver = address
  tokenTxs: RawTokenTx[]; // ERC-20 transfers
  /** USD price for the native APE. */
  apePriceUsd: number;
  /** Token-address (lower-case) → USD price. */
  tokenPrices: Map<string, number>;
  /** Wei held in native APE right now. */
  nativeBalance: bigint;
  /** Lower-case token address → display-units balance. */
  tokenBalances: Map<string, number>;
  totalUsd: number;
  signals: LocalSignals;
}

/**
 * Build all the chain context needed to evaluate every still-locked
 * achievement in one shot. Most of this lives in Etherscan's normal/token
 * tx history; balance + price come from the existing wallet helpers.
 */
async function buildContext(network: NetworkId, address: string): Promise<SyncContext> {
  // Pull a generous window of history — we cap at 1000 each to stay under
  // Etherscan's max offset and keep the API cost bounded.
  const [txs, tokenTxs, summary] = await Promise.all([
    explorer<RawTx>(network, {
      module: 'account', action: 'txlist', address,
      startblock: '0', endblock: '99999999',
      page: '1', offset: '1000', sort: 'desc',
    }),
    explorer<RawTokenTx>(network, {
      module: 'account', action: 'tokentx', address,
      startblock: '0', endblock: '99999999',
      page: '1', offset: '1000', sort: 'desc',
    }),
    getAccountSummary(network, address).catch(() => null),
  ]);

  // Collect distinct ERC-20 contract addresses the user has touched so we
  // can both balance-check and price-check them. We're interested in current
  // holdings — the historical event list gives us the full list of contracts
  // we've ever interacted with.
  const tokenSet = new Set<string>();
  for (const t of tokenTxs) {
    const c = (t.contractAddress ?? '').toLowerCase();
    if (c) tokenSet.add(c);
  }
  // Always include the brand tokens we explicitly check against, so the
  // achievements that need their balance work even before the user has
  // touched the contract directly.
  tokenSet.add(CURTIS.address.toLowerCase());
  tokenSet.add(BLUE.address.toLowerCase());
  tokenSet.add(MURTIS.address.toLowerCase());

  const tokenList = [...tokenSet];
  const balances = tokenList.length
    ? await getErc20Balances(network, tokenList, address).catch(() => [])
    : [];

  const tokenBalances = new Map<string, number>();
  for (const b of balances) {
    tokenBalances.set(b.token.address.toLowerCase(), parseFloat(b.balance));
  }

  // Prices: APE via the native price route; ERC-20s via DexScreener (we cap
  // to keep the API budget tight).
  const apePrice = await getApePrice().catch(() => null);
  const apePriceUsd = apePrice?.usd ?? 0;

  const tokenPrices = new Map<string, number>();
  // Only fetch prices for tokens the user actually holds (saves API calls).
  const heldNonZero = [...tokenBalances.entries()]
    .filter(([, bal]) => bal > 0)
    .map(([addr]) => addr);
  // Always include CURTIS so the "hold $X of CURTIS" check works even when
  // the user holds a tiny dust amount.
  if (!heldNonZero.includes(CURTIS.address.toLowerCase())) {
    heldNonZero.push(CURTIS.address.toLowerCase());
  }
  await Promise.all(heldNonZero.slice(0, 30).map(async (addr) => {
    try {
      const p = await getApeChainPair(addr);
      if (p?.priceUsd) {
        tokenPrices.set(addr, parseFloat(p.priceUsd));
      }
    } catch { /* skip */ }
  }));

  // Total USD across native APE + every priced ERC-20.
  const nativeBalanceWei = summary ? BigInt(summary.nativeBalanceWei) : 0n;
  const nativeBalanceApe = parseFloat(formatUnits(nativeBalanceWei, 18));
  let totalUsd = nativeBalanceApe * apePriceUsd;
  for (const [addr, bal] of tokenBalances.entries()) {
    const p = tokenPrices.get(addr);
    if (p && bal > 0) totalUsd += bal * p;
  }

  // NFT portfolio value — sum of (collection floor × count) × APE
  // price for each unique contract the address holds. Best-effort:
  // OpenSea floors that don't resolve contribute 0. Capped to a
  // sensible number of unique contracts so a 200-NFT wallet doesn't
  // blow the API budget.
  if (apePriceUsd > 0) {
    try {
      const nfts = await getOwnedNfts(network, address, false).catch(() => []);
      const countByContract = new Map<string, number>();
      for (const n of nfts) {
        const lc = n.contract.toLowerCase();
        countByContract.set(lc, (countByContract.get(lc) ?? 0) + 1);
      }
      const uniqueContracts = [...countByContract.keys()].slice(0, 25);
      const floors = await Promise.all(
        uniqueContracts.map(async (c) => {
          const f = await getCollectionFloorByContract(OPENSEA_APECHAIN, c).catch(() => null);
          return [c, f?.floorApe ?? 0] as const;
        }),
      );
      for (const [contract, floorApe] of floors) {
        if (floorApe > 0) {
          const count = countByContract.get(contract) ?? 0;
          totalUsd += floorApe * count * apePriceUsd;
        }
      }
    } catch { /* swallow — NFT contribution is best-effort */ }
  }

  const signals = await readSignals();

  return {
    txs: txs.filter((t) => t.from || t.to),
    tokenTxs,
    apePriceUsd,
    tokenPrices,
    nativeBalance: nativeBalanceWei,
    tokenBalances,
    totalUsd,
    signals,
  };
}

// ─── Per-achievement predicates ────────────────────────────────────────────
//
// Each function returns `true` if the account currently satisfies the
// condition. We never UN-set; the storage layer keeps achievements forever.

type CheckFn = (ctx: SyncContext, addressLc: string) => boolean;

function chatMessagesFromMe(ctx: SyncContext, lc: string): RawTx[] {
  const inbox = YACHT_CHAT_INBOX.toLowerCase();
  return ctx.txs.filter(
    (t) =>
      (t.from ?? '').toLowerCase() === lc &&
      (t.to ?? '').toLowerCase() === inbox &&
      typeof t.input === 'string' && t.input !== '0x' && t.input.length > 2,
  );
}

function tipsFromMe(ctx: SyncContext, lc: string): RawTx[] {
  const magic = TIP_MAGIC.toLowerCase();
  return ctx.txs.filter(
    (t) =>
      (t.from ?? '').toLowerCase() === lc &&
      typeof t.input === 'string' &&
      t.input.toLowerCase().startsWith(magic),
  );
}

function swapsFromMe(ctx: SyncContext, lc: string): RawTx[] {
  const router = CAMELOT_V2_ROUTER.toLowerCase();
  return ctx.txs.filter(
    (t) =>
      (t.from ?? '').toLowerCase() === lc &&
      (t.to ?? '').toLowerCase() === router &&
      (t.isError === '0' || t.txreceipt_status === '1'),
  );
}

/** Did the user complete N consecutive UTC days each containing >=1 such tx? */
function maxConsecutiveDays(timestamps: number[]): number {
  if (timestamps.length === 0) return 0;
  // Bucket by UTC day, keyed as a numeric day index (`Date.UTC()/86_400_000`)
  // so we can sort numerically. The previous string-keyed approach
  // (`${y}-${m}-${d}` with no zero-padding) produced lexicographic order
  // — `2025-8-10` sorted BEFORE `2025-8-9` — which broke the streak walk
  // for any week containing both single- and double-digit days. Most
  // weeks. The chat- and swap-7day-streak achievements never fired.
  const days = new Set<number>();
  for (const ts of timestamps) {
    const d = new Date(ts * 1000);
    days.add(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86_400_000);
  }
  const sorted = [...days].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  for (const t of sorted) {
    run = prev != null && t === prev + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  return best;
}

const CHECKS: Record<string, CheckFn> = {
  'chat-1msg': (ctx, lc) => chatMessagesFromMe(ctx, lc).length >= 1,
  'chat-50msg': (ctx, lc) => chatMessagesFromMe(ctx, lc).length >= 50,
  'chat-7day-streak': (ctx, lc) => {
    const ts = chatMessagesFromMe(ctx, lc).map((t) => Number(t.timeStamp ?? 0));
    return maxConsecutiveDays(ts) >= 7;
  },

  'tip-1': (ctx, lc) => tipsFromMe(ctx, lc).length >= 1,
  'tip-50-distinct': (ctx, lc) => {
    const recipients = new Set<string>();
    for (const t of tipsFromMe(ctx, lc)) {
      const to = (t.to ?? '').toLowerCase();
      if (to && to !== lc) recipients.add(to);
    }
    return recipients.size >= 50;
  },

  'swap-1': (ctx, lc) => swapsFromMe(ctx, lc).length >= 1,
  'swap-50': (ctx, lc) => swapsFromMe(ctx, lc).length >= 50,
  'swap-7day-streak': (ctx, lc) => {
    const ts = swapsFromMe(ctx, lc).map((t) => Number(t.timeStamp ?? 0));
    return maxConsecutiveDays(ts) >= 7;
  },
  // For per-swap USD thresholds we use the trading-fee-skim transfer that
  // accompanies every Yacht swap: it carries the exact pre-swap input amount
  // (× 0.5%). Reverse-engineering the input amount × current price gives a
  // strong proxy for "swap value in USD".
  'swap-100usd': (ctx, lc) => largestSwapUsd(ctx, lc) >= 100,
  'swap-1000usd': (ctx, lc) => largestSwapUsd(ctx, lc) >= 1000,

  'hold-300usd': (ctx) => ctx.totalUsd >= 300,
  'hold-3000usd': (ctx) => ctx.totalUsd >= 3000,

  'hold-curtis-100': (ctx) => curtisHoldingUsd(ctx) >= 100,
  'hold-curtis-1000': (ctx) => curtisHoldingUsd(ctx) >= 1000,

  'collect-curtis-blue-murtis': (ctx) => {
    const c = ctx.tokenBalances.get(CURTIS.address.toLowerCase()) ?? 0;
    const b = ctx.tokenBalances.get(BLUE.address.toLowerCase()) ?? 0;
    const m = ctx.tokenBalances.get(MURTIS.address.toLowerCase()) ?? 0;
    return c > 0 && b > 0 && m > 0;
  },

  'swap-to-stable': (ctx, lc) => {
    // Any incoming ERC-20 transfer of USDC or USDT received from the Camelot
    // router (or any address; the router forwards) — i.e. the user finished
    // a swap with a stablecoin as the output token.
    return ctx.tokenTxs.some(
      (t) =>
        (t.to ?? '').toLowerCase() === lc &&
        STABLES_LC.has((t.contractAddress ?? '').toLowerCase()),
    );
  },

  'revoke-site': (ctx, lc) => !!ctx.signals.revokedSite?.[lc],

  // OpenSea-related signals are local-only because opensea.io connect
  // and Seaport buy aren't observable purely from txlist (Seaport
  // calls have many internal subcalls and the buyer's TX target is
  // often a router/conduit rather than the listing contract directly).
  // We mark these from the background dApp handler when the conditions
  // are met and check the local signal here.
  'connect-opensea': (ctx, lc) => !!ctx.signals.connectedOpensea?.[lc],
  'buy-opensea-nft': (ctx, lc) => !!ctx.signals.boughtOpenseaNft?.[lc],
  'pfp-set': (ctx, lc) => !!ctx.signals.setPfp?.[lc],

  'send-curtis': (ctx, lc) => {
    const curtis = CURTIS.address.toLowerCase();
    return ctx.tokenTxs.some(
      (t) =>
        (t.from ?? '').toLowerCase() === lc &&
        (t.to ?? '').toLowerCase() !== TRADING_FEE_TREASURY.toLowerCase() &&
        (t.contractAddress ?? '').toLowerCase() === curtis,
    );
  },

  'receive-curtis-from-team': (ctx, lc) => {
    const curtis = CURTIS.address.toLowerCase();
    return ctx.tokenTxs.some(
      (t) =>
        (t.from ?? '').toLowerCase() === TEAM_MEMBER_LC &&
        (t.to ?? '').toLowerCase() === lc &&
        (t.contractAddress ?? '').toLowerCase() === curtis,
    );
  },
};

function curtisHoldingUsd(ctx: SyncContext): number {
  const lc = CURTIS.address.toLowerCase();
  const bal = ctx.tokenBalances.get(lc) ?? 0;
  const price = ctx.tokenPrices.get(lc) ?? 0;
  return bal * price;
}

function largestSwapUsd(ctx: SyncContext, lc: string): number {
  // The fee tx is a 0.5% transfer of the input token to the treasury. Its
  // USD value × 200 ≈ swap input USD. Iterate all such transfers and
  // remember the largest.
  const treasury = TRADING_FEE_TREASURY.toLowerCase();
  let best = 0;
  for (const t of ctx.tokenTxs) {
    if ((t.from ?? '').toLowerCase() !== lc) continue;
    if ((t.to ?? '').toLowerCase() !== treasury) continue;
    const tokenAddr = (t.contractAddress ?? '').toLowerCase();
    const decimals = Number(t.tokenDecimal ?? '18');
    let amt = 0;
    try { amt = parseFloat(formatUnits(BigInt(t.value ?? '0'), decimals)); } catch { continue; }
    const price = ctx.tokenPrices.get(tokenAddr) ?? 0;
    if (price <= 0) continue;
    const swapUsd = amt * price * 200; // 0.5% fee → swap was 200×
    if (swapUsd > best) best = swapUsd;
  }
  // Also handle native-APE fee transfers (no token contract).
  const apePrice = ctx.apePriceUsd;
  for (const t of ctx.txs) {
    if ((t.from ?? '').toLowerCase() !== lc) continue;
    if ((t.to ?? '').toLowerCase() !== treasury) continue;
    let valueWei = 0n;
    try { valueWei = BigInt(t.value ?? '0'); } catch { continue; }
    if (valueWei <= 0n) continue;
    const apeAmt = parseFloat(formatUnits(valueWei, 18));
    const swapUsd = apeAmt * apePrice * 200;
    if (swapUsd > best) best = swapUsd;
  }
  return best;
}

// ─── Sync entry point ──────────────────────────────────────────────────────

export interface SyncResult {
  unlocked: string[];
  newlyUnlocked: string[];
  total: number;
  totalUsd: number;
  lastSyncedAt: number;
}

export async function syncAchievements(
  network: NetworkId,
  address: string,
  opts?: { force?: boolean },
): Promise<SyncResult> {
  const lc = address.toLowerCase();
  const store = await readStore();
  const cur = store[lc] ?? { achievements: {}, lastSyncedAt: 0 };

  // Rate-limit. The popup may call this on every Accounts open; if we ran
  // a sync in the last SYNC_TTL_MS we just hand back the cache. If every
  // achievement is already unlocked there's no point ever re-evaluating.
  const allUnlocked = Object.keys(cur.achievements).length >= TOTAL_ACHIEVEMENTS;
  const recentlyChecked = Date.now() - cur.lastSyncedAt < SYNC_TTL_MS;
  if (!opts?.force && (allUnlocked || recentlyChecked)) {
    return {
      unlocked: Object.keys(cur.achievements),
      newlyUnlocked: [],
      total: TOTAL_ACHIEVEMENTS,
      totalUsd: 0, // caller can re-fetch live USD separately if it needs that
      lastSyncedAt: cur.lastSyncedAt,
    };
  }

  // Build chain context once and run every still-locked predicate.
  let ctx: SyncContext;
  try {
    ctx = await buildContext(network, address);
  } catch {
    // Fall back to whatever was previously persisted; never wipe progress.
    return {
      unlocked: Object.keys(cur.achievements),
      newlyUnlocked: [],
      total: TOTAL_ACHIEVEMENTS,
      totalUsd: 0,
      lastSyncedAt: cur.lastSyncedAt,
    };
  }

  const newlyUnlocked: string[] = [];
  const merged: PerAccountState['achievements'] = { ...cur.achievements };
  for (const a of ACHIEVEMENTS) {
    if (merged[a.id]) continue;
    const fn = CHECKS[a.id];
    if (!fn) continue;
    let ok = false;
    try { ok = !!fn(ctx, lc); } catch { ok = false; }
    if (ok) {
      merged[a.id] = { unlockedAt: Date.now() };
      newlyUnlocked.push(a.id);
    }
  }

  const next: PerAccountState = {
    achievements: merged,
    lastSyncedAt: Date.now(),
  };
  store[lc] = next;
  await writeStore(store);

  return {
    unlocked: Object.keys(merged),
    newlyUnlocked,
    total: TOTAL_ACHIEVEMENTS,
    totalUsd: ctx.totalUsd,
    lastSyncedAt: next.lastSyncedAt,
  };
}

// ─── Rank evaluator for arbitrary addresses ────────────────────────────────
//
// Every chat message renders the sender's rank, so we need a fast way to
// evaluate rank for addresses that aren't even in this wallet. evaluateRank-
// ForAddress runs the same on-chain predicates as syncAchievements, but never
// writes to the achievements store — its results live in a separate cache
// keyed by lowercase address with a 5-minute TTL. Local-only signals (e.g.
// "this account revoked a site") are necessarily skipped: we only know that
// for accounts we own.

// v2 = NFT-portfolio value is now part of totalUsd (which feeds
// the rank tier). Old v1 entries that were computed without the
// NFT contribution are abandoned by the version bump so users
// see the corrected rank on next eval.
const RANK_CACHE_KEY = 'yacht.rankCache.v2';
const RANK_CACHE_TTL_MS = 5 * 60_000;

interface RankCacheEntry {
  rank: number;
  fraction: number;        // progress to next USD tier
  totalUsd: number;
  achievementsUnlocked: number;
  cachedAt: number;
}
type RankCache = { [addressLc: string]: RankCacheEntry };

async function readRankCache(): Promise<RankCache> {
  try {
    const r = await chrome.storage.local.get(RANK_CACHE_KEY);
    const v = r[RANK_CACHE_KEY];
    return v && typeof v === 'object' ? (v as RankCache) : {};
  } catch {
    return {};
  }
}

async function writeRankCache(c: RankCache): Promise<void> {
  try { await chrome.storage.local.set({ [RANK_CACHE_KEY]: c }); } catch { /* best effort */ }
}

export interface RankResult {
  rank: number;
  fraction: number;
  totalUsd: number;
  achievementsUnlocked: number;
  /** Set when the result was served from cache rather than freshly evaluated. */
  cached: boolean;
}

export async function evaluateRankForAddress(
  network: NetworkId,
  address: string,
  opts?: { force?: boolean },
): Promise<RankResult> {
  const lc = address.toLowerCase();

  // Hot cache hit — return immediately.
  if (!opts?.force) {
    const cache = await readRankCache();
    const hit = cache[lc];
    if (hit && Date.now() - hit.cachedAt < RANK_CACHE_TTL_MS) {
      return { ...hit, cached: true };
    }
  }

  let totalUsd = 0;
  let unlocked = 0;
  try {
    const ctx = await buildContext(network, address);
    totalUsd = ctx.totalUsd;
    // Count every on-chain achievement; skip those that depend on local
    // signals we don't have for foreign addresses (revoke-site).
    for (const a of ACHIEVEMENTS) {
      if (a.id === 'revoke-site' || a.id === 'connect-opensea' || a.id === 'buy-opensea-nft' || a.id === 'pfp-set') continue;
      const fn = CHECKS[a.id];
      if (!fn) continue;
      try { if (fn(ctx, lc)) unlocked += 1; } catch { /* skip */ }
    }
    // For our own accounts, also fold in any persistently-stored
    // achievements (including local signals) so the rank reflects the
    // user's full progress.
    const stored = await readStore();
    const own = stored[lc]?.achievements;
    if (own) {
      // Don't double-count: take the union of on-chain + stored.
      const ids = new Set<string>();
      for (const id of Object.keys(own)) ids.add(id);
      for (const a of ACHIEVEMENTS) {
        if (a.id === 'revoke-site' || a.id === 'connect-opensea' || a.id === 'buy-opensea-nft' || a.id === 'pfp-set') continue;
        const fn = CHECKS[a.id];
        try { if (fn && fn(ctx, lc)) ids.add(a.id); } catch { /* skip */ }
      }
      unlocked = ids.size;
    }
  } catch { /* fall back to zeros */ }

  const tier = computeRank(totalUsd, unlocked);
  const prog = progressToNextUsd(totalUsd);

  const entry: RankCacheEntry = {
    rank: tier.rank,
    fraction: prog.fraction,
    totalUsd,
    achievementsUnlocked: unlocked,
    cachedAt: Date.now(),
  };

  // Persist back so the next call (often within the same chat scroll) is
  // instant. The cache lives in chrome.storage.local — there's no atomic
  // read-modify-write, and Chat.tsx fans this function out 15+ ways in
  // parallel via Promise.all. A naive write would clobber the entries
  // computed by sibling fan-outs. We do a fresh re-read of the cache
  // immediately before merging in our entry, so the only race that loses
  // data is the sub-millisecond window between this read and the write,
  // which is dominated by single-process SW serialisation in practice.
  const latest = await readRankCache();
  latest[lc] = entry;
  await writeRankCache(latest);

  return { ...entry, cached: false };
}
