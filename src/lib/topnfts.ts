// Top-NFTs registry + collection-stats fetcher.
//
// Fixed list of curated ApeChain collections shown in the Discover
// menu. Stats (floor price, supply, image) come from the OpenSea v2
// API and cache for an hour. Vote tallies live in `voting.ts` with
// weekly resets — ranking is by total APE contributed, NOT by tx
// count, so a 10 APE vote outweighs ten 1 APE votes.
//
// Reservoir's NFT API was sunset in October 2025 so we no longer hit
// it. OpenSea v2 is the primary indexer for ApeChain collection data.
//
// Adding a collection is a one-line append to TOP_NFT_REGISTRY.

import type { NetworkId } from './networks';
import { getApePrice } from './price';
import { getVoteTalliesForWeek } from './voting';

export interface TopNftEntry {
  contract: string;          // 0x… lowercase
  name: string;
  /** OpenSea slug — used for both the API call AND the outbound link. */
  slug: string;
}

export const TOP_NFT_REGISTRY: TopNftEntry[] = [
  { contract: '0x272461ef3ae1743eed0c4fa7e894ee71c088ba7e', name: 'Arsham Voyager',          slug: 'arsham-voyager' },
  { contract: '0x81c9ce55e8214fd0f5181fd3d38f52fd8c33ec38', name: 'GIMBOZ',                  slug: 'gimboznft' },
  { contract: '0xbebaa24108d6a03c7331464270b95278bbbe6ff7', name: 'Gobs on Ape',             slug: 'gobs-on-ape' },
  { contract: '0xb3443b6bd585ba4118cae2bedb61c7ec4a8281df', name: "G's on Ape",              slug: 'gs-on-ape' },
  { contract: '0xb2385c55bc447cedb9545558b7b92a4b6886de16', name: 'Typical Tigers ApeChain', slug: 'typical-tigers-apechain' },
  { contract: '0xa511c29edc004e3d6a91a94df1e1f0c0fd8a41db', name: 'MIMUONape',               slug: 'mimuonape' },
  { contract: '0xfdb917b599ba8898325373b34454385489285c10', name: 'JNKYZ',                   slug: 'jnkyz' },
  { contract: '0x7262718ca3734a48c3be93521e8695630f1a45cd', name: 'Jimmy',                   slug: 'jimmy' },
  { contract: '0x8954f7a8eb01e94efb10d610837f115fe95aafb1', name: 'RILLAZ Ape',              slug: 'rillaz-ape' },
  { contract: '0x64688e9e0f69631b347f749c2f9b445201af5498', name: 'Monos ApeChain',          slug: 'monos-apechain' },
  { contract: '0xacfa101ece167f1894150e090d9471aee2dd3041', name: 'The Fiendz',              slug: 'the-fiendz' },
  { contract: '0x52c929e6d282e1a69de46860f41a0a2d8ca30eca', name: 'Balloons by Balloons',    slug: 'balloons-by-balloons' },
  { contract: '0xc2c22e804f465493d6be8ea22a9a8115d4220f4b', name: 'SportsMonke',             slug: 'sportsmonke-by-sportsdefi' },
  { contract: '0x2cf92fe634909a9cf5e41291f54e5784d234cf8d', name: 'Dengs',                   slug: 'dengs' },
  { contract: '0x312d0349c6b32fc4934e570c795a7bfe6fbf986b', name: 'FoxyFam',                 slug: 'foxyfam' },
  { contract: '0x7d23b40319b7124bc20d35b86424f0f6053e01d3', name: 'Boximus',                 slug: 'boximus' },
  { contract: '0x4c2ef2994ac84036f695be2e23e669fe5dd73526', name: 'Sloooths',                slug: 'sloooths' },
  { contract: '0x91417bd88af5071ccea8d3bf3af410660e356b06', name: 'Zards',                   slug: 'zards' },
  { contract: '0x41232b4b2c6c1abe0238e590f4bd433c166a6b01', name: 'NightGlyders',            slug: 'nightglyders' },
];

/** Lookup: lower-cased contract → registry entry. */
const REGISTRY_BY_LC = new Map<string, TopNftEntry>(
  TOP_NFT_REGISTRY.map((e) => [e.contract.toLowerCase(), e]),
);

export function isTopNftCollection(contract: string): boolean {
  return REGISTRY_BY_LC.has(contract.toLowerCase());
}

export interface CollectionStats {
  contract: string;
  name: string;
  imageUrl: string | null;
  floorApe: number | null;
  floorUsd: number | null;
  supply: number | null;
  /** Floor × supply in USD. Null if either input is missing. */
  mcapUsd: number | null;
}

export interface TopNftRow extends CollectionStats {
  slug: string;
  /** Total APE contributed to this collection during the current ISO week. */
  apeVoted: number;
  /** Number of distinct vote transactions during the current week. */
  voteCount: number;
}

const OPENSEA_API_BASE = 'https://api.opensea.io/api/v2';
// User-supplied OpenSea API key. Embedded in the bundle so popup-side
// fetches can authenticate. OpenSea keys grant read-only access to
// public collection / NFT data; they cannot move funds.
const OPENSEA_API_KEY = '4ae0d12d95e4454cb9a4831ccc6fd103';

// v2 = OpenSea-backed (post-Reservoir sunset). v1 entries are
// abandoned by the stale-key check — users upgrading from earlier
// builds skip a stale-cache window and see real data on first open.
const STATS_CACHE_KEY = 'yacht.topnftStats.v2';
const STATS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CachedStatsEntry { stats: CollectionStats; cachedAt: number }
type CachedStats = { [contractLc: string]: CachedStatsEntry };

async function readStatsCache(): Promise<CachedStats> {
  try {
    const r = await chrome.storage.local.get(STATS_CACHE_KEY);
    const v = r[STATS_CACHE_KEY];
    return v && typeof v === 'object' ? (v as CachedStats) : {};
  } catch { return {}; }
}

async function writeStatsCache(c: CachedStats): Promise<void> {
  try { await chrome.storage.local.set({ [STATS_CACHE_KEY]: c }); } catch { /* best effort */ }
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

function osHeaders(): HeadersInit {
  return {
    accept: 'application/json',
    'X-API-KEY': OPENSEA_API_KEY,
  };
}

/**
 * One OpenSea call returns name, image, supply, floor price, and
 * owner count for a slug. floor_price comes back in native chain
 * currency (APE for ApeChain collections).
 */
async function fetchOpenseaCollection(slug: string): Promise<{
  name?: string;
  image?: string;
  supply?: number;
  floorNative?: number;
} | null> {
  try {
    const r = await withTimeout(
      fetch(`${OPENSEA_API_BASE}/collections/${encodeURIComponent(slug)}`, { headers: osHeaders() }),
      8000,
    );
    if (!r.ok) return null;
    const j: any = await r.json();
    return {
      name: typeof j?.name === 'string' ? j.name : undefined,
      image: typeof j?.image_url === 'string' ? j.image_url : undefined,
      supply: typeof j?.total_supply === 'number'
        ? j.total_supply
        : typeof j?.total_supply === 'string'
          ? parseInt(j.total_supply, 10)
          : undefined,
    };
  } catch { return null; }
}

/** Stats endpoint returns floor + volume. Floor lives under
 * `total.floor_price` (or `intervals[].volume`). */
async function fetchOpenseaStats(slug: string): Promise<{ floorNative?: number; supply?: number } | null> {
  try {
    const r = await withTimeout(
      fetch(`${OPENSEA_API_BASE}/collections/${encodeURIComponent(slug)}/stats`, { headers: osHeaders() }),
      8000,
    );
    if (!r.ok) return null;
    const j: any = await r.json();
    const floor =
      typeof j?.total?.floor_price === 'number'
        ? j.total.floor_price
        : typeof j?.floor_price === 'number'
          ? j.floor_price
          : undefined;
    const supply = typeof j?.total?.total_supply === 'number' ? j.total.total_supply : undefined;
    return { floorNative: floor, supply };
  } catch { return null; }
}

async function fetchOneStats(_network: NetworkId, entry: TopNftEntry, apeUsd: number): Promise<CollectionStats> {
  const fallback: CollectionStats = {
    contract: entry.contract,
    name: entry.name,
    imageUrl: null,
    floorApe: null,
    floorUsd: null,
    supply: null,
    mcapUsd: null,
  };
  // Two parallel calls — collection metadata for image+supply+name,
  // stats for the floor price. Either side failing falls back to the
  // best info we got from the other.
  const [meta, stats] = await Promise.all([
    fetchOpenseaCollection(entry.slug),
    fetchOpenseaStats(entry.slug),
  ]);
  if (!meta && !stats) return fallback;

  const supply = (meta?.supply ?? stats?.supply) ?? null;
  const floorApe = stats?.floorNative ?? null;
  const floorUsd = floorApe != null && apeUsd > 0 ? floorApe * apeUsd : null;
  const mcapUsd = floorUsd != null && supply != null ? floorUsd * supply : null;
  return {
    contract: entry.contract,
    name: meta?.name ?? entry.name,
    imageUrl: meta?.image ?? null,
    floorApe,
    floorUsd,
    supply,
    mcapUsd,
  };
}

/**
 * Build the Top NFTs list: registry × OpenSea stats × this-week
 * vote tallies, sorted by total APE voted desc.
 */
export async function getTopNftCollections(network: NetworkId): Promise<TopNftRow[]> {
  const cache = await readStatsCache();
  const now = Date.now();

  const apePrice = await getApePrice().catch(() => null);
  const apeUsd = apePrice?.usd ?? 0;

  // Fetch stats in parallel, using cache when fresh. OpenSea throttles
  // unauthenticated traffic but the user's API key gives generous
  // headroom — 19 collections × 2 calls = 38 in the worst case is well
  // under the per-minute budget.
  const stats = await Promise.all(
    TOP_NFT_REGISTRY.map(async (entry) => {
      const lc = entry.contract.toLowerCase();
      const cached = cache[lc];
      if (cached && now - cached.cachedAt < STATS_CACHE_TTL_MS) {
        // Re-derive USD-side fields from the current APE price so a
        // long-cached entry doesn't show a stale market cap when APE
        // moves intraday.
        const s = cached.stats;
        const floorUsd = s.floorApe != null && apeUsd > 0 ? s.floorApe * apeUsd : null;
        const mcapUsd = floorUsd != null && s.supply != null ? floorUsd * s.supply : null;
        return { ...s, floorUsd, mcapUsd };
      }
      const fresh = await fetchOneStats(network, entry, apeUsd);
      cache[lc] = { stats: fresh, cachedAt: now };
      return fresh;
    }),
  );
  await writeStatsCache(cache);

  const tallies = await getVoteTalliesForWeek(network);
  const rows: TopNftRow[] = stats.map((s) => {
    const entry = REGISTRY_BY_LC.get(s.contract.toLowerCase());
    const tally = tallies[s.contract.toLowerCase()] ?? { apeTotal: 0, voteCount: 0 };
    return {
      ...s,
      slug: entry?.slug ?? '',
      apeVoted: tally.apeTotal,
      voteCount: tally.voteCount,
    };
  });
  rows.sort((a, b) => {
    if (b.apeVoted !== a.apeVoted) return b.apeVoted - a.apeVoted;
    // Tie-break by market cap so the more meaningful collections
    // surface above untracked ones at zero votes.
    return (b.mcapUsd ?? 0) - (a.mcapUsd ?? 0);
  });
  return rows;
}
