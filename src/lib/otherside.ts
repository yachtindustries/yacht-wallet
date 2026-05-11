// Otherside (Yuga Labs metaverse) profile lookup.
//
// Public surface area, as of May 2026 (Yacht v0.1.27 research):
//
// • Agentic API at api.otherside.xyz exposes THREE endpoints (privy-id
//   resolver, user-data, world chat). x402-paid in production but free
//   during preview. We *try* the first two best-effort — they are fast
//   to fail and add useful badges when they work.
//
// • Otherside NFT collections (Otherdeeds, Kodas, Vessels) live on
//   ETHEREUM mainnet, not ApeChain. Yacht is an ApeChain wallet so the
//   regular `evm.nfts` RPC can't see them. For any address being
//   inspected we query Etherscan V2 with chainid=1 against the same
//   API key Yacht already uses for ApeChain — `addresstokennftbalance`
//   returns the address's ERC-721 collection counts in one call.
//
// What is NOT available from any public source today:
// • Username / Yuga ID display name reverse-lookup
// • Level / XP / battle stats
// • A "top players" leaderboard
// We do not pretend to render those — see getTopOthersidePlayers().

import { rpc } from './messaging';
import type { OwnedNft } from './evm';

const OTHERSIDE_API_BASE = 'https://api.otherside.xyz';
const ETHERSCAN_V2_BASE = 'https://api.etherscan.io/v2/api';
// Same key that Yacht uses for ApeChain (Etherscan V2 is unified across
// chainids). Embedded for parity with networks.ts; both calls cost from
// the same daily quota.
const ETHERSCAN_V2_KEY = 'JC9XJF7FBYRTZPR8E4IYP91RWJV1YW1N2R';

/**
 * Verified Yuga / Otherside ERC-721 contracts on Ethereum mainnet.
 * Lower-cased. Sources: official Yuga / Otherside posts, OpenSea
 * collection pages. The wallet ALSO accepts name-matched contracts
 * for forward-compat with future drops we haven't hard-coded.
 */
const OTHERSIDE_ETH_CONTRACTS: { address: string; label: string }[] = [
  { address: '0x34d85c9cdeb23fa97cb08333b511ac86e1c4e258', label: 'Otherdeed for Otherside' },
  { address: '0x790b2cf29ed4f310bf7641f013c65d4560d28371', label: 'Otherdeed Expanded' },
  { address: '0xe012baf811cf9c05c408e879c399960d1f305903', label: 'Otherside Koda' },
  { address: '0x5b1085136a811e55b2bb2ca1ea456ba82126a376', label: 'Otherside Vessel' },
  { address: '0x495f947276749ce646f68ac8c248420045cb7b5e', label: 'Otherside Mara (legacy)' },
];
const OTHERSIDE_ETH_SET = new Set(OTHERSIDE_ETH_CONTRACTS.map((c) => c.address.toLowerCase()));

/** Substring hints (case-insensitive). Caught both for ApeChain
 * filtering and as a forward-compat backstop on Ethereum. */
const OTHERSIDE_NAME_HINTS: string[] = [
  'otherside',
  'otherdeed',
  'koda',
  'voyager',
  'vessel',
  'mara',
  'geez',
  'omentokens',
  'kodapendant',
];

export interface OthersideHolding {
  label: string;
  count: number;
  /** Which chain the holding lives on, for the UI to badge. */
  chain: 'apechain' | 'ethereum';
}

export interface OthersideProfile {
  username: string | null;
  level: number | null;
  avatarUrl: string | null;
  yugaIdRegistered: boolean;
  lastSeenLocation: string | null;
  holdings: OthersideHolding[];
  /** True when at least ONE of our data sources returned a usable
   * response. False means everything failed; the UI shows a clearer
   * "couldn't reach Otherside" state. */
  anySourceSucceeded: boolean;
  /** Per-source status, surfaced in the UI so the user can tell which
   * piece of the integration is working. */
  sources: {
    yugaIdApi: 'ok' | 'failed' | 'no-account';
    apeChainNfts: 'ok' | 'failed';
    ethereumNfts: 'ok' | 'failed';
  };
  note?: string;
}

function isNameHinted(label: string): boolean {
  const lc = label.toLowerCase();
  return OTHERSIDE_NAME_HINTS.some((h) => lc.includes(h));
}

function groupBy<T, K extends string>(xs: T[], key: (x: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const x of xs) {
    const k = key(x);
    (out[k] ??= [] as T[]).push(x);
  }
  return out;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function fetchYugaId(wallet: string): Promise<string | null> {
  try {
    const r = await withTimeout(
      fetch(`${OTHERSIDE_API_BASE}/api/agents/privy-id?wallet=${encodeURIComponent(wallet)}`, {
        headers: { accept: 'application/json' },
      }),
      6000,
    );
    if (!r.ok) return null;
    const j: any = await r.json();
    const id = j?.id ?? j?.privyId ?? j?.userId ?? null;
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch { return null; }
}

async function fetchUserData(userId: string): Promise<{ location: string | null } | null> {
  try {
    const r = await withTimeout(
      fetch(`${OTHERSIDE_API_BASE}/api/agents/user-data?userId=${encodeURIComponent(userId)}`, {
        headers: { accept: 'application/json' },
      }),
      6000,
    );
    if (!r.ok) return null;
    const j: any = await r.json();
    const loc =
      typeof j?.location === 'string'
        ? j.location
        : typeof j?.world?.name === 'string'
          ? j.world.name
          : typeof j?.lastWorld === 'string'
            ? j.lastWorld
            : null;
    return { location: loc };
  } catch { return null; }
}

interface EtherscanNftBalanceRow {
  TokenAddress?: string;
  TokenName?: string;
  TokenSymbol?: string;
  TokenQuantity?: string;
  // V2 sometimes returns these in lower-case fields.
  contractAddress?: string;
  name?: string;
  symbol?: string;
  balance?: string;
}

/**
 * One-shot Ethereum NFT collection inventory for `address`. Returns an
 * empty array on any failure — the Otherside tab is still useful with
 * just on-chain ApeChain data.
 */
async function fetchEthereumNftCollections(address: string): Promise<{ contract: string; name: string; symbol: string; balance: number }[]> {
  const params = new URLSearchParams({
    chainid: '1',
    module: 'account',
    action: 'addresstokennftbalance',
    address,
    page: '1',
    offset: '100',
    apikey: ETHERSCAN_V2_KEY,
  });
  try {
    const r = await withTimeout(fetch(`${ETHERSCAN_V2_BASE}?${params}`), 8000);
    if (!r.ok) return [];
    const j: any = await r.json();
    if (!Array.isArray(j?.result)) return [];
    return (j.result as EtherscanNftBalanceRow[]).map((row) => ({
      contract: String(row.TokenAddress ?? row.contractAddress ?? '').toLowerCase(),
      name: String(row.TokenName ?? row.name ?? ''),
      symbol: String(row.TokenSymbol ?? row.symbol ?? ''),
      balance: parseFloat(String(row.TokenQuantity ?? row.balance ?? '0')) || 0,
    })).filter((x) => x.contract && x.balance > 0);
  } catch { return []; }
}

function isOthersideApechainNft(nft: OwnedNft): boolean {
  const blob = `${nft.contractName ?? ''} ${nft.contractSymbol ?? ''} ${nft.name ?? ''}`;
  return isNameHinted(blob);
}

/**
 * Build an Otherside profile combining (a) the public Agentic API for
 * Yuga-ID + last-seen location, (b) Ethereum NFT inventory via
 * Etherscan V2, and (c) ApeChain NFT inventory via the existing wallet
 * RPC. Always returns a profile so the UI renders something — even
 * when every source comes back empty we show "no Otherside footprint
 * found" with the per-source diagnostics.
 */
export async function fetchOthersideProfile(address: string): Promise<OthersideProfile> {
  const sources: OthersideProfile['sources'] = {
    yugaIdApi: 'no-account',
    apeChainNfts: 'failed',
    ethereumNfts: 'failed',
  };

  const [privyId, apeNfts, ethCollections] = await Promise.all([
    fetchYugaId(address),
    rpc({ type: 'evm.nfts', address }).then(
      (n) => { sources.apeChainNfts = 'ok'; return n; },
      () => { sources.apeChainNfts = 'failed'; return [] as OwnedNft[]; },
    ),
    fetchEthereumNftCollections(address).then(
      (c) => { sources.ethereumNfts = 'ok'; return c; },
      () => { sources.ethereumNfts = 'failed'; return []; },
    ),
  ]);

  if (privyId) sources.yugaIdApi = 'ok';

  let lastSeenLocation: string | null = null;
  if (privyId) {
    const ud = await fetchUserData(privyId);
    lastSeenLocation = ud?.location ?? null;
  }

  // Apechain matches (best-effort, name-based — most Otherside NFTs
  // aren't here so this is usually empty).
  const apeMatches = apeNfts.filter(isOthersideApechainNft);

  // Ethereum matches: prefer the verified contract list, fall back to
  // name-matching for forward-compat with future drops.
  const ethMatches = ethCollections.filter((c) => OTHERSIDE_ETH_SET.has(c.contract) || isNameHinted(`${c.name} ${c.symbol}`));

  // Build the unified holdings list. Verified Ethereum contracts use
  // their canonical label from the registry; everything else uses the
  // contract name as reported.
  const holdings: OthersideHolding[] = [];
  for (const m of ethMatches) {
    const verified = OTHERSIDE_ETH_CONTRACTS.find((c) => c.address.toLowerCase() === m.contract);
    holdings.push({
      label: verified?.label ?? m.name ?? m.symbol ?? 'Otherside collection',
      count: m.balance,
      chain: 'ethereum',
    });
  }
  const apeGrouped = groupBy(apeMatches, (n) => (n.contractName ?? n.contractSymbol ?? 'Otherside (ApeChain)') as string);
  for (const [label, items] of Object.entries(apeGrouped)) {
    holdings.push({ label, count: (items as OwnedNft[]).length, chain: 'apechain' });
  }
  holdings.sort((a, b) => b.count - a.count);

  // Avatar: any Otherside-themed NFT image we have on the ApeChain
  // side. We don't pull Ethereum NFT images here (would need another
  // round-trip) — the on-chain image is just a nice-to-have.
  const withImage = apeMatches.find((n) => n.image);

  const anySourceSucceeded =
    sources.yugaIdApi === 'ok' ||
    holdings.length > 0 ||
    (sources.apeChainNfts === 'ok' && sources.ethereumNfts === 'ok');

  return {
    username: null,
    level: null,
    avatarUrl: withImage?.image ?? null,
    yugaIdRegistered: !!privyId,
    lastSeenLocation,
    holdings,
    anySourceSucceeded,
    sources,
    note:
      'Otherside has no public username / level / XP API yet. Yacht surfaces what is reachable: Yuga ID registration (Otherside Agentic API), last-seen world, and Otherside-collection holdings on both Ethereum and ApeChain.',
  };
}

// ─── Top players (Discovery menu) ─────────────────────────────────────────

export interface OthersideTopPlayer {
  address: string;
  username: string | null;
  metric: string;
}

// Magic Eden runs the Reservoir Tooling Platform (RTP) post-sunset,
// so we keep using the Reservoir-style /owners/v2 endpoint behind
// Magic Eden's domain. Free tier; no key required for ranked owner
// lookups on supported chains.
const ME_RTP_BASE = 'https://api-mainnet.magiceden.dev/v3/rtp';
// Otherdeed for Otherside (Ethereum mainnet) — Yuga's foundational
// Otherside collection. Top holders here ARE the top Otherside players
// in the only metric the public surface exposes.
const OTHERDEED_ETH = '0x34d85c9cdeb23fa97cb08333b511ac86e1c4e258';
const OTHERDEED_OS_SLUG = 'otherdeed';
// Same key Yacht uses for the Top NFTs section. Embedded; only grants
// public-data lookups.
const OPENSEA_API_KEY = '4ae0d12d95e4454cb9a4831ccc6fd103';

interface RtpOwner {
  address?: string;
  ownership?: { tokenCount?: number | string };
}

/**
 * Try Magic Eden RTP for ranked Otherdeed owners. Returns null on any
 * failure so the caller can fall back to OpenSea sampling.
 */
async function fetchTopHoldersViaRtp(): Promise<OthersideTopPlayer[] | null> {
  try {
    const url = `${ME_RTP_BASE}/ethereum/owners/v2?collection=${OTHERDEED_ETH}&limit=15&offset=0&sortBy=ownership`;
    const r = await withTimeout(
      fetch(url, { headers: { accept: 'application/json' } }),
      8000,
    );
    if (!r.ok) return null;
    const j: any = await r.json();
    const owners: RtpOwner[] = Array.isArray(j?.owners) ? j.owners : [];
    const players: OthersideTopPlayer[] = [];
    for (const o of owners) {
      if (typeof o.address !== 'string') continue;
      const count =
        typeof o.ownership?.tokenCount === 'number'
          ? o.ownership.tokenCount
          : typeof o.ownership?.tokenCount === 'string'
            ? parseInt(o.ownership.tokenCount, 10)
            : 0;
      players.push({
        address: o.address,
        username: null,
        metric: `${count.toLocaleString()} Otherdeeds`,
      });
    }
    return players.length > 0 ? players : null;
  } catch { return null; }
}

/**
 * Fallback: enumerate a slice of Otherdeed NFTs from OpenSea and
 * aggregate by owner. Sampling, not exhaustive — we surface ~200 NFTs
 * out of ~100k — but the addresses that show up multiple times across
 * a random sample are still meaningfully large holders. Better than
 * nothing while RTP is unreliable.
 */
async function fetchTopHoldersViaOpenSea(): Promise<OthersideTopPlayer[] | null> {
  try {
    const url = `https://api.opensea.io/api/v2/collection/${OTHERDEED_OS_SLUG}/nfts?limit=200`;
    const r = await withTimeout(
      fetch(url, {
        headers: { accept: 'application/json', 'X-API-KEY': OPENSEA_API_KEY },
      }),
      10000,
    );
    if (!r.ok) return null;
    const j: any = await r.json();
    const nfts: any[] = Array.isArray(j?.nfts) ? j.nfts : [];
    const counts = new Map<string, number>();
    for (const n of nfts) {
      const owners = Array.isArray(n?.owners) ? n.owners : [];
      for (const o of owners) {
        const addr = typeof o?.address === 'string' ? o.address.toLowerCase() : null;
        if (!addr) continue;
        const qty = typeof o?.quantity === 'number' ? o.quantity : 1;
        counts.set(addr, (counts.get(addr) ?? 0) + qty);
      }
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
    if (sorted.length === 0) return null;
    return sorted.map(([address, count]) => ({
      address,
      username: null,
      // Sample-based wording so users know this is an active-holder
      // estimate rather than a true global rank.
      metric: `${count}+ in active sample`,
    }));
  } catch { return null; }
}

/**
 * "Top Otherside Players" — ranked by Otherdeed for Otherside
 * holdings on Ethereum. Yuga does not publish a level / XP / battle
 * leaderboard, so the largest holders of the foundational Otherside
 * deed are the closest objective proxy available.
 *
 * Tries Magic Eden RTP first (true ranking). Falls back to OpenSea
 * sample-based aggregation (active-sample ranking) if RTP is down.
 * Returns `[]` if both fail — the Discovery section then renders the
 * "coming soon" tile.
 */
export async function getTopOthersidePlayers(): Promise<OthersideTopPlayer[]> {
  const viaRtp = await fetchTopHoldersViaRtp();
  if (viaRtp && viaRtp.length > 0) return viaRtp;
  const viaOs = await fetchTopHoldersViaOpenSea();
  if (viaOs && viaOs.length > 0) return viaOs;
  return [];
}
