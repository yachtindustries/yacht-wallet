// Lightweight CoinGecko APE price feed with cache.

const CACHE_KEY = 'yacht.price.v1';
const TTL_MS = 60_000;

export interface PriceCache {
  ts: number;
  usd: number;
  eur: number;
  gbp: number;
}

export async function getApePrice(force = false): Promise<PriceCache> {
  const r = await chrome.storage.local.get(CACHE_KEY);
  const cached: PriceCache | undefined = r[CACHE_KEY];
  if (!force && cached && Date.now() - cached.ts < TTL_MS) return cached;
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=apecoin&vs_currencies=usd,eur,gbp',
    );
    const j = await res.json();
    const out: PriceCache = {
      ts: Date.now(),
      usd: j.apecoin?.usd ?? 0,
      eur: j.apecoin?.eur ?? 0,
      gbp: j.apecoin?.gbp ?? 0,
    };
    await chrome.storage.local.set({ [CACHE_KEY]: out });
    return out;
  } catch {
    return cached ?? { ts: 0, usd: 0, eur: 0, gbp: 0 };
  }
}
