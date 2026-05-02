// DexScreener client — fetches ApeChain token metadata, USD prices, logos.
// Public, key-less API: https://docs.dexscreener.com/api/reference

import { NETWORKS } from './networks';

const BASE = 'https://api.dexscreener.com';
const CACHE_KEY = 'yacht.dex.cache.v1';
const TTL_MS = 90_000;
const APECHAIN = NETWORKS.mainnet.dexChainId;

export interface DexPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: { address: string; name?: string; symbol: string };
  quoteToken: { address: string; name?: string; symbol: string };
  priceUsd?: string;
  priceNative?: string;
  liquidity?: { usd?: number; base?: number; quote?: number };
  volume?: { h24?: number; h6?: number; h1?: number };
  priceChange?: { h24?: number; h6?: number; h1?: number };
  fdv?: number;
  marketCap?: number;
  info?: { imageUrl?: string; websites?: { url: string }[]; socials?: { type: string; url: string }[] };
  url?: string;
}

interface CacheShape {
  [key: string]: { ts: number; data: unknown };
}

async function readCache(): Promise<CacheShape> {
  const r = await chrome.storage.local.get(CACHE_KEY);
  return (r[CACHE_KEY] as CacheShape) ?? {};
}

async function writeCache(cache: CacheShape): Promise<void> {
  await chrome.storage.local.set({ [CACHE_KEY]: cache });
}

async function cached<T>(key: string, fetcher: () => Promise<T>, ttl = TTL_MS): Promise<T> {
  const c = await readCache();
  const e = c[key];
  if (e && Date.now() - e.ts < ttl) return e.data as T;
  try {
    const data = await fetcher();
    c[key] = { ts: Date.now(), data };
    const keys = Object.keys(c);
    if (keys.length > 200) {
      const sorted = keys.sort((a, b) => c[a].ts - c[b].ts);
      for (const k of sorted.slice(0, keys.length - 200)) delete c[k];
    }
    await writeCache(c);
    return data;
  } catch {
    if (e) return e.data as T;
    throw new Error('DexScreener unavailable');
  }
}

async function search(q: string): Promise<DexPair[]> {
  const url = `${BASE}/latest/dex/search?q=${encodeURIComponent(q)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`dexscreener ${r.status}`);
  const j = await r.json();
  return ((j.pairs ?? []) as DexPair[]).filter((p) => p.chainId === APECHAIN);
}

// Direct token endpoint — given a contract address on a specific chain.
async function pairsForToken(tokenAddress: string): Promise<DexPair[]> {
  const url = `${BASE}/tokens/v1/${APECHAIN}/${tokenAddress}`;
  const r = await fetch(url);
  if (!r.ok) {
    // Older endpoint shape for backwards compat
    const fallback = await fetch(`${BASE}/latest/dex/tokens/${tokenAddress}`);
    if (!fallback.ok) return [];
    const j: any = await fallback.json();
    return ((j.pairs ?? []) as DexPair[]).filter((p) => p.chainId === APECHAIN);
  }
  const j: any = await r.json();
  if (Array.isArray(j)) return j.filter((p: DexPair) => p.chainId === APECHAIN);
  return ((j.pairs ?? []) as DexPair[]).filter((p) => p.chainId === APECHAIN);
}

// Best pair for an ApeChain token (symbol or contract address).
export async function getApeChainPair(query: string): Promise<DexPair | null> {
  return cached(`pair:${query}`, async () => {
    const isAddr = /^0x[a-fA-F0-9]{40}$/.test(query.trim());
    let pairs: DexPair[] = [];
    if (isAddr) {
      pairs = await pairsForToken(query.trim());
      if (!pairs.length) pairs = await search(query);
    } else {
      pairs = await search(query);
    }
    if (!pairs.length) return null;
    pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    return pairs[0];
  });
}

export async function getTokenUsd(query: string): Promise<number | null> {
  const p = await getApeChainPair(query);
  return p?.priceUsd ? parseFloat(p.priceUsd) : null;
}

export async function getTokenLogo(query: string): Promise<string | null> {
  const p = await getApeChainPair(query);
  return p?.info?.imageUrl ?? null;
}

// Top tokens on ApeChain by 24h volume. We hit search with the chain name and
// other broad terms, dedupe by base token, and rank by 24h volume.
export async function getTrendingApeChainTokens(limit = 10): Promise<DexPair[]> {
  return cached(
    `trending:${limit}`,
    async () => {
      const queries = ['apechain', 'ape', 'apecoin', 'wape'];
      const all: DexPair[] = [];
      for (const q of queries) {
        try {
          const pairs = await search(q);
          all.push(...pairs);
        } catch { /* ignore */ }
      }
      const seen = new Set<string>();
      const dedup = all.filter((p) => {
        const k = `${p.baseToken.symbol}:${p.baseToken.address.toLowerCase()}`;
        if (seen.has(k)) return false;
        // Skip pairs where the base token IS the native APE wrapper itself
        if (p.baseToken.symbol?.toUpperCase() === 'APE') return false;
        seen.add(k);
        return true;
      });
      dedup.sort((a, b) => (b.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0));
      return dedup.slice(0, limit);
    },
    5 * 60_000,
  );
}
