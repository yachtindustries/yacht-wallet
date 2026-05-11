import { useEffect, useState } from 'react';
import { RankAvatar } from './RankAvatar';
import { getNftDetailByContract } from '@/lib/opensea';
import { rpc } from '@/lib/messaging';

// Module-level cache of resolved {address → image} so two avatars
// for the same address don't both make round-trips. Resolved PFPs
// are stable so we hold them for the popup session; null results
// (no PFP set) expire fast so a freshly-published PFP doesn't sit
// behind a stale cache entry until the popup closes.
interface CacheEntry { image: string | null; cachedAt: number }
const RESOLVED_TTL_MS = 30 * 60_000;
const NULL_TTL_MS = 60_000;
const imageByAddress = new Map<string, CacheEntry>();
function cacheGet(lc: string): CacheEntry | undefined {
  const e = imageByAddress.get(lc);
  if (!e) return undefined;
  const ttl = e.image ? RESOLVED_TTL_MS : NULL_TTL_MS;
  if (Date.now() - e.cachedAt > ttl) {
    imageByAddress.delete(lc);
    return undefined;
  }
  return e;
}
function cacheSet(lc: string, image: string | null): void {
  imageByAddress.set(lc, { image, cachedAt: Date.now() });
}

/**
 * Avatar that takes an arbitrary ApeChain address (not an
 * accountId) and resolves the user's PFP via the on-chain PFP
 * registry, then renders the NFT image inside a circular ring.
 * Falls back to the rank artwork while loading and on lookup
 * failure — same visual surface as before, just augmented when
 * an on-chain PFP exists.
 */
export function OnChainPfpAvatar({
  address,
  rank,
  fraction,
  size,
  showRing = true,
  withRankBelow = false,
  rankSize,
  backgroundColor,
  className = '',
}: {
  address: string;
  rank: number;
  fraction: number;
  size: number;
  showRing?: boolean;
  withRankBelow?: boolean;
  rankSize?: number;
  backgroundColor?: string;
  className?: string;
}) {
  const [image, setImage] = useState<string | null>(() => cacheGet(address.toLowerCase())?.image ?? null);

  useEffect(() => {
    if (!address) return;
    const lc = address.toLowerCase();
    const cached = cacheGet(lc);
    if (cached) {
      setImage(cached.image);
      return;
    }
    let cancelled = false;
    void (async () => {
      let resolved: string | null = null;
      try {
        const pfp = await rpc({ type: 'pfp.get', address });
        if (pfp) {
          const chain = 'ape_chain';
          const detail = await getNftDetailByContract(chain, pfp.contract, pfp.tokenId).catch(() => null);
          resolved = detail?.image ?? null;
        }
      } catch { /* leave null */ }
      if (cancelled) return;
      cacheSet(lc, resolved);
      setImage(resolved);
    })();
    return () => { cancelled = true; };
  }, [address]);

  if (!image) {
    return (
      <RankAvatar
        rank={rank}
        fraction={fraction}
        size={size}
        showRing={showRing}
        backgroundColor={backgroundColor}
        className={className}
      />
    );
  }

  // Mirror PfpRing's geometry from PfpAvatar.tsx — SVG ring + inset
  // image — so the on-chain version reads as the same visual.
  const stroke = 3;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = c * Math.max(0, Math.min(1, fraction));
  const imgInset = stroke + 1;
  const imgSize = size - imgInset * 2;

  const innerRank = rankSize ?? Math.max(14, Math.round(size * 0.42));
  const overlap = Math.round(innerRank * 0.28);

  const ring = (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0 pointer-events-none"
      >
        {showRing && (
          <>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={stroke} />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke="#ffffff"
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${filled} ${c}`}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          </>
        )}
      </svg>
      <img
        src={image}
        alt="Profile"
        className="rounded-full object-cover absolute"
        style={{ width: imgSize, height: imgSize, left: imgInset, top: imgInset }}
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
      />
    </span>
  );

  if (!withRankBelow) {
    return <span className={className}>{ring}</span>;
  }

  return (
    <div className={`flex flex-col items-center ${className}`}>
      {ring}
      <div style={{ marginTop: -overlap }}>
        <RankAvatar rank={rank} fraction={fraction} size={innerRank} showRing={false} backgroundColor="#002849" />
      </div>
    </div>
  );
}
