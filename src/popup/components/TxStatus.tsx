import { useEffect, useMemo, useRef } from 'react';

type Status = 'pending' | 'success' | 'error';

const successSoundUrl = chrome.runtime.getURL('successsound.wav');

interface Props {
  status: Status;
  message?: string;
  onDismiss?: () => void;
  autoDismissMs?: number;
  /** When set + status is 'success', renders the image as a slowly
   *  wobbling 3-D card in place of the standard ring + checkmark. */
  imageUrl?: string;
}

export function TxStatus({ status, message, onDismiss, autoDismissMs = 3000, imageUrl }: Props) {
  // Hold the latest onDismiss in a ref so the auto-dismiss timer is armed
  // exactly once per status transition. Without the ref, every parent
  // re-render would pass a freshly-created onDismiss, the effect would
  // re-run, and the timer would never get a chance to fire.
  const onDismissRef = useRef(onDismiss);
  useEffect(() => { onDismissRef.current = onDismiss; }, [onDismiss]);

  useEffect(() => {
    if (status === 'pending') return;
    const t = window.setTimeout(() => onDismissRef.current?.(), autoDismissMs);
    return () => window.clearTimeout(t);
  }, [status, autoDismissMs]);

  // Celebratory chime — same asset the Swap success uses, kept
  // single-shot. Browsers may block autoplay until they see a
  // user gesture, but every code path that opens this overlay
  // (Send / Swap / NFT buy) is initiated by an explicit click,
  // so we're inside an allowed window.
  useEffect(() => {
    if (status !== 'success') return;
    try {
      const a = new Audio(successSoundUrl);
      a.volume = 0.6;
      void a.play().catch(() => { /* browser blocked autoplay — silent */ });
    } catch { /* Audio API unavailable */ }
  }, [status]);

  const bg =
    status === 'success'
      ? '#5eccfa'              // water blue — matches the brand's primary accent
      : status === 'error'
      ? '#dc2626'              // bright red
      : 'rgba(0,40,73,0.95)';  // pending — translucent navy (was warm brown)

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center transition-colors duration-300"
      style={{ backgroundColor: bg }}
      onClick={status !== 'pending' ? () => onDismissRef.current?.() : undefined}
    >
      {status === 'success' && <Confetti />}
      {status === 'success' && imageUrl ? (
        <NftCube imageUrl={imageUrl} />
      ) : (
        <Ring status={status} />
      )}
      {message && (
        <div
          className="mt-5 px-6 text-center font-bold text-white"
          style={{ fontSize: 17 }}
        >
          {message}
        </div>
      )}
    </div>
  );
}

function NftCube({ imageUrl }: { imageUrl: string }) {
  // Flat 2-D card of the bought NFT. (The function name is kept
  // as `NftCube` for call-site stability across builds; the visual
  // is now a still image per request.)
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        width: 220,
        height: 220,
        boxShadow: '0 0 0 1px rgba(255,255,255,0.18), 0 16px 40px -12px rgba(0,0,0,0.45)',
      }}
    >
      <img
        src={imageUrl}
        alt="NFT"
        className="w-full h-full object-cover"
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
      />
    </div>
  );
}

function Ring({ status }: { status: Status }) {
  // Pure white ring + check on green; pure red on red; white during pending.
  const color =
    status === 'success' ? '#ffffff' : status === 'error' ? '#7f1d1d' : '#ffffff';
  const size = 110;
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {status === 'pending' ? (
          <>
            {/* Faint track */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke="rgba(255,255,255,0.15)"
              strokeWidth={stroke}
            />
            {/* Spinning arc */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={c * 0.72}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              className="yacht-spin"
            />
          </>
        ) : (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            className="yacht-ring-appear"
          />
        )}
      </svg>
      {status !== 'pending' && (
        <div
          className={`absolute inset-0 flex items-center justify-center text-[56px] font-bold leading-none yacht-mark-pop`}
          style={{ color }}
        >
          {status === 'success' ? '✓' : '✗'}
        </div>
      )}
    </div>
  );
}

// Lightweight confetti: 40 colored squares with individual ballistic trajectories
// driven by CSS custom properties. No dependency.
function Confetti() {
  const pieces = useMemo(() => {
    const colors = ['#0b90ff', '#22c55e', '#f5b042', '#ef4d57', '#a855f7', '#ec4899', '#14b8a6', '#eab308'];
    return Array.from({ length: 56 }, (_, i) => {
      const angle = (Math.random() - 0.5) * Math.PI * 0.9; // spread
      const speed = 220 + Math.random() * 180;
      const dx = Math.sin(angle) * speed;
      const dy = -(Math.cos(angle) * speed + 60);
      return {
        id: i,
        color: colors[i % colors.length],
        dx: `${dx.toFixed(0)}px`,
        dy: `${dy.toFixed(0)}px`,
        delay: `${(Math.random() * 0.2).toFixed(2)}s`,
        size: 6 + Math.random() * 6,
        rot: `${Math.random() * 720 - 360}deg`,
      };
    });
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="yacht-confetti"
          style={
            {
              left: '50%',
              top: '50%',
              width: p.size,
              height: p.size * 0.6,
              background: p.color,
              '--dx': p.dx,
              '--dy': p.dy,
              '--rot': p.rot,
              animationDelay: p.delay,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
