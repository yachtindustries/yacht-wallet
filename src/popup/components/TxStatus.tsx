import { useEffect, useMemo } from 'react';

type Status = 'pending' | 'success' | 'error';

interface Props {
  status: Status;
  message?: string;
  onDismiss?: () => void;
  autoDismissMs?: number;
}

export function TxStatus({ status, message, onDismiss, autoDismissMs = 3000 }: Props) {
  useEffect(() => {
    if (status === 'pending') return;
    if (!onDismiss) return;
    const t = window.setTimeout(onDismiss, autoDismissMs);
    return () => window.clearTimeout(t);
  }, [status, onDismiss, autoDismissMs]);

  const bg =
    status === 'success'
      ? '#16a34a' // bright green
      : status === 'error'
      ? '#dc2626' // bright red
      : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center transition-colors duration-300"
      style={bg ? { backgroundColor: bg } : { backgroundColor: 'rgba(28,19,10,0.95)' }}
      onClick={status !== 'pending' ? onDismiss : undefined}
    >
      {status === 'success' && <Confetti />}
      <Ring status={status} />
      {message && (
        <div className={`mt-5 text-sm px-6 text-center font-bold ${status === 'pending' ? 'text-ink-dim' : 'text-white'}`}>
          {message}
        </div>
      )}
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
