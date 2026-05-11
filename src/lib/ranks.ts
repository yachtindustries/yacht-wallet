// Yacht ranks. Each account has a dynamic rank computed from (a) the USD
// value held on that account and (b) how many achievements that account has
// unlocked. Both gates must be satisfied — falling under the USD threshold
// drops the rank, but achievements are forever (so they only need to be
// earned once per account, ever).
//
// Rank tiers are open at the top end: rank 12 starts at $30 000 and stays.

export interface RankTier {
  /** 1-indexed rank number. */
  rank: number;
  /** Inclusive lower bound of the USD range. */
  minUsd: number;
  /** Inclusive upper bound; +Infinity for the open-ended top tier. */
  maxUsd: number;
  /** Achievements that must already be unlocked to enter this rank. */
  minAchievements: number;
}

export const RANKS: RankTier[] = [
  { rank: 1,  minUsd: 0,       maxUsd: 9.99,       minAchievements: 0  },
  { rank: 2,  minUsd: 10,      maxUsd: 49.99,      minAchievements: 1  },
  { rank: 3,  minUsd: 50,      maxUsd: 99.99,      minAchievements: 3  },
  { rank: 4,  minUsd: 100,     maxUsd: 499.99,     minAchievements: 7  },
  { rank: 5,  minUsd: 500,     maxUsd: 999.99,     minAchievements: 10 },
  { rank: 6,  minUsd: 1_000,   maxUsd: 1_999.99,   minAchievements: 12 },
  { rank: 7,  minUsd: 2_000,   maxUsd: 3_999.99,   minAchievements: 14 },
  { rank: 8,  minUsd: 4_000,   maxUsd: 9_999.99,   minAchievements: 16 },
  { rank: 9,  minUsd: 10_000,  maxUsd: 19_999.99,  minAchievements: 17 },
  { rank: 10, minUsd: 20_000,  maxUsd: 24_999.99,  minAchievements: 18 },
  { rank: 11, minUsd: 25_000,  maxUsd: 29_999.99,  minAchievements: 19 },
  { rank: 12, minUsd: 30_000,  maxUsd: Number.POSITIVE_INFINITY, minAchievements: 20 },
];

/**
 * Resolve the highest rank tier the account currently qualifies for. Both
 * the USD floor AND the achievement floor must be met. Falling below the
 * USD floor of a tier drops the rank back down; achievements never unwind.
 */
export function computeRank(usd: number, achievementsUnlocked: number): RankTier {
  for (let i = RANKS.length - 1; i >= 0; i--) {
    const t = RANKS[i];
    if (usd >= t.minUsd && achievementsUnlocked >= t.minAchievements) return t;
  }
  return RANKS[0];
}

/**
 * Progress toward the next USD threshold, ignoring the achievement gate so
 * the bar is purely a "how much further until the wallet's USD reaches the
 * next tier" indicator. If the wallet is already at the top tier, returns a
 * full bar.
 */
export function progressToNextUsd(usd: number): {
  currentMinUsd: number;
  nextMinUsd: number;
  /** 0..1 fraction of the way between currentMinUsd and nextMinUsd. */
  fraction: number;
} {
  // Find the highest tier whose minUsd <= usd. That's the user's current
  // USD-only tier (regardless of whether achievement gate would block them).
  let currentIdx = 0;
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (usd >= RANKS[i].minUsd) { currentIdx = i; break; }
  }
  const cur = RANKS[currentIdx];
  const nxt = RANKS[currentIdx + 1];
  if (!nxt) {
    return { currentMinUsd: cur.minUsd, nextMinUsd: cur.minUsd, fraction: 1 };
  }
  const span = nxt.minUsd - cur.minUsd;
  const frac = span > 0 ? Math.max(0, Math.min(1, (usd - cur.minUsd) / span)) : 1;
  return { currentMinUsd: cur.minUsd, nextMinUsd: nxt.minUsd, fraction: frac };
}

export function rankIconUrl(rank: number): string {
  const safe = Math.max(1, Math.min(RANKS.length, Math.floor(rank)));
  // Vite copies public/ contents to the dist root, so the runtime URL is
  // ranks/… (NOT public/ranks/…). The previous path 404d and the rank
  // icons rendered as broken images.
  return chrome.runtime.getURL(`ranks/rank-${safe}.png`);
}
