import { useEffect, useState } from 'react';
import { RankAvatar } from './RankAvatar';
import { rpc } from '@/lib/messaging';

// Per-account profile picture. Users opt in by clicking "Set PFP" on any
// NFT they own; we save the {contract, tokenId, image} triple keyed by
// accountId in chrome.storage.local. Rank info is still tracked
// separately and rendered as a smaller badge under the PFP — no PFP
// means the rank avatar takes the full slot like before.

const PFP_KEY = 'yacht.pfp.v1';

export interface PfpEntry {
  contract: string;
  tokenId: string;
  image: string;
}

export type PfpStore = { [accountId: string]: PfpEntry };

export async function setAccountPfp(
  accountId: string,
  entry: PfpEntry | null,
  /** Optional account address — when supplied we ALSO mark the
   * pfp-set local signal so the matching achievement unlocks on the
   * next sync. */
  accountAddress?: string,
): Promise<void> {
  try {
    const r = await chrome.storage.local.get(PFP_KEY);
    const map: PfpStore = (r[PFP_KEY] as PfpStore | undefined) ?? {};
    if (entry === null) delete map[accountId];
    else map[accountId] = entry;
    await chrome.storage.local.set({ [PFP_KEY]: map });
  } catch {
    // Storage failures are silent — worst case the user just has to
    // pick again.
  }
  // Mark the achievement signal directly from the popup. The
  // signals store is just a chrome.storage.local key, so we don't
  // need to round-trip to the background.
  if (entry && accountAddress) {
    try {
      const SIG_KEY = 'yacht.achievementSignals.v1';
      const r = await chrome.storage.local.get(SIG_KEY);
      const cur = (r[SIG_KEY] as { setPfp?: { [a: string]: boolean } } | undefined) ?? {};
      const map = cur.setPfp ?? {};
      map[accountAddress.toLowerCase()] = true;
      await chrome.storage.local.set({ [SIG_KEY]: { ...cur, setPfp: map } });
    } catch { /* best effort */ }
  }
  // Publish the same change on-chain so other Yacht clients
  // (chat avatars, top-users list, profile views) can see it.
  // Fire-and-forget: failures are logged but never block the
  // local-only PFP from updating.
  if (accountAddress) {
    if (entry) {
      void rpc({
        type: 'pfp.set',
        account: accountAddress,
        contract: entry.contract,
        tokenId: entry.tokenId,
      }).catch((e) => console.warn('[Yacht] on-chain PFP set failed:', e));
    } else {
      void rpc({ type: 'pfp.clear', account: accountAddress })
        .catch((e) => console.warn('[Yacht] on-chain PFP clear failed:', e));
    }
  }
}

/**
 * Reactive read of the PFP entry for an account. Subscribes to
 * chrome.storage.onChanged so a "Set PFP" click in one place updates
 * every PfpAvatar on the page (Dashboard, Accounts, Chat).
 */
export function usePfp(accountId: string | undefined): PfpEntry | null {
  const [pfp, setPfp] = useState<PfpEntry | null>(null);
  useEffect(() => {
    if (!accountId) { setPfp(null); return; }
    let cancelled = false;
    chrome.storage.local.get(PFP_KEY).then((r) => {
      if (cancelled) return;
      const map = (r[PFP_KEY] as PfpStore | undefined) ?? {};
      setPfp(map[accountId] ?? null);
    });
    function listener(changes: { [key: string]: chrome.storage.StorageChange }, area: string) {
      if (area !== 'local' || !changes[PFP_KEY]) return;
      const map = (changes[PFP_KEY].newValue as PfpStore | undefined) ?? {};
      setPfp(map[accountId!] ?? null);
    }
    chrome.storage.onChanged.addListener(listener);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, [accountId]);
  return pfp;
}

interface Props {
  /** accountId; empty string disables the lookup (renders rank only). */
  accountId?: string;
  rank: number;
  fraction: number;
  /** PFP / rank-avatar diameter when no PFP is set. */
  size: number;
  /** When true, the rank icon renders as a small badge under the PFP. */
  withRankBelow?: boolean;
  /** Diameter of the rank-below badge. Defaults to ~42% of `size`. */
  rankSize?: number;
  /** Forwarded to the RankAvatar fallback (no-PFP case) AND the PFP ring. */
  showRing?: boolean;
  artworkScale?: number;
  /** Forwarded as the navy halo behind the rank artwork. */
  backgroundColor?: string;
  /**
   * If true, the rank-below is positioned absolutely so it overflows
   * outside the wrapper rather than expanding the layout. Used on the
   * Home page so the small rank under the avatar doesn't push the
   * Send/Swap/Receive + tokens grid down.
   */
  rankBelowAbsolute?: boolean;
  className?: string;
}

/**
 * Rendered ring + image used when a PFP is set. Mirrors the SVG ring
 * style of RankAvatar so the visual language is consistent.
 */
function PfpRing({
  image,
  size,
  fraction,
  showRing,
}: {
  image: string;
  size: number;
  fraction: number;
  showRing: boolean;
}) {
  const stroke = 3;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = c * Math.max(0, Math.min(1, fraction));
  // Inset the image just inside the ring so the stroke is fully
  // visible and doesn't overlap the artwork.
  const imgInset = stroke + 1;
  const imgSize = size - imgInset * 2;
  return (
    <span
      className="relative inline-block shrink-0"
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0 pointer-events-none"
      >
        {showRing && (
          <>
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke="rgba(255,255,255,0.25)"
              strokeWidth={stroke}
            />
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
        style={{
          width: imgSize,
          height: imgSize,
          left: imgInset,
          top: imgInset,
        }}
      />
    </span>
  );
}

/**
 * Renders a circular profile picture with the rank icon stacked
 * underneath. Falls through to RankAvatar when no PFP is set so a
 * just-installed wallet still shows the user's rank.
 */
export function PfpAvatar({
  accountId,
  rank,
  fraction,
  size,
  withRankBelow = false,
  rankSize,
  showRing = true,
  artworkScale,
  backgroundColor,
  rankBelowAbsolute = false,
  className = '',
}: Props) {
  const pfp = usePfp(accountId);
  if (!pfp?.image) {
    return (
      <RankAvatar
        rank={rank}
        fraction={fraction}
        size={size}
        showRing={showRing}
        artworkScale={artworkScale}
        backgroundColor={backgroundColor}
        className={className}
      />
    );
  }

  const ring = (
    <PfpRing image={pfp.image} size={size} fraction={fraction} showRing={showRing} />
  );

  if (!withRankBelow) {
    return <span className={className}>{ring}</span>;
  }

  // Per the latest design: when an NFT PFP is set, the rank-below is
  // ALWAYS rendered without its own ring. The ring belongs to the PFP
  // circle now, not the rank badge.
  const innerRank = rankSize ?? Math.max(14, Math.round(size * 0.42));
  const overlap = Math.round(innerRank * 0.28);
  const rankBadge = (
    <RankAvatar
      rank={rank}
      fraction={fraction}
      size={innerRank}
      showRing={false}
      backgroundColor="#002849"
    />
  );

  if (rankBelowAbsolute) {
    // The wrapper is exactly `size × size` — the rank below floats
    // outside its bounds so the parent's flex/grid layout stays the
    // height it would have been with just the bare avatar.
    return (
      <span
        className={`relative inline-block shrink-0 ${className}`}
        style={{ width: size, height: size }}
      >
        {ring}
        <span
          className="absolute left-1/2 -translate-x-1/2"
          style={{ top: size - overlap }}
        >
          {rankBadge}
        </span>
      </span>
    );
  }

  return (
    <div className={`flex flex-col items-center ${className}`}>
      {ring}
      <div style={{ marginTop: -overlap }}>{rankBadge}</div>
    </div>
  );
}
