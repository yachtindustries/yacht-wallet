import { rankIconUrl } from '@/lib/ranks';

/**
 * Rank icon wrapped in a white SVG progress ring. The ring's filled fraction
 * reflects USD progress to the next rank tier — never the achievement gate.
 *
 * Used in the Accounts list, the Dashboard header, and next to chat bubbles.
 */
export function RankAvatar({
  rank,
  fraction,
  size,
  backgroundColor,
  trackColor = 'rgba(255,255,255,0.25)',
  ringColor = '#ffffff',
  showRing = true,
  artworkScale = 0.6,
  className = '',
}: {
  rank: number;
  fraction: number;
  size: number;
  /**
   * Fraction of the avatar diameter occupied by the rank artwork. Default
   * 0.6 leaves a clear navy ring of breathing room around the icon.
   * Callers like the Dashboard pass a smaller value to shrink the icon
   * within the same circle size.
   */
  artworkScale?: number;
  /**
   * Optional fill colour painted inside the ring, behind the rank artwork.
   * Useful when the parent surface is light (e.g. a white account-list card)
   * and the rank PNG is also light — set this to the navy brand colour so
   * the icon stays legible.
   */
  backgroundColor?: string;
  /** Faint full-perimeter track painted under the progress arc. */
  trackColor?: string;
  /** Colour of the moving progress arc itself. */
  ringColor?: string;
  /** When false, both the track and the progress arc are skipped — useful
   * for places that want the rank icon on a navy disc without the
   * progress-bar styling (e.g. inline next to chat bubbles). */
  showRing?: boolean;
  className?: string;
}) {
  // 40% thicker than the original 2-px ring.
  const stroke = 3;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = c * Math.max(0, Math.min(1, fraction));
  // Navy fill (when supplied) sits INSIDE the ring with a 1-px gap so the
  // ring is unambiguously rendered around — not on top of — the dark
  // circle. Without that gap the inner half of the stroke overlaps the
  // navy and reads as a solid ball. With showRing=false there's no ring,
  // so the navy fill expands to (almost) the full disc.
  const bgRadius = showRing
    ? Math.max(0, r - stroke / 2 - 1)
    : Math.max(0, size / 2 - 1);
  // Rank artwork sized as a fraction of the avatar diameter so callers
  // can shrink the icon without changing the ring/circle size. Default
  // (0.6) keeps a comfortable navy halo; Dashboard passes 0.48 for a
  // smaller-icon-in-same-circle effect.
  const artworkSize = Math.max(8, Math.round(size * artworkScale));
  return (
    <span
      className={`relative inline-block shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0 pointer-events-none"
      >
        {backgroundColor && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={bgRadius}
            fill={backgroundColor}
            stroke="none"
          />
        )}
        {showRing && (
          <>
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={trackColor}
              strokeWidth={stroke}
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={ringColor}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${filled} ${c}`}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          </>
        )}
      </svg>
      {/* The artwork is positioned absolutely so the SVG and image share
          the same centre. Z-stacking is automatic via DOM order — the img
          sits above the SVG, which means the rank icon always paints on
          top of the navy circle and the ring. */}
      <img
        src={rankIconUrl(rank)}
        alt={`Rank ${rank}`}
        className="object-contain absolute"
        style={{
          width: artworkSize,
          height: artworkSize,
          left: (size - artworkSize) / 2,
          top: (size - artworkSize) / 2,
        }}
      />
    </span>
  );
}
