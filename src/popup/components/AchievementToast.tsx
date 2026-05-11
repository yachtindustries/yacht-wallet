import { useEffect, useMemo, useRef, useState } from 'react';
import { ACHIEVEMENTS } from '@/lib/achievements';

const TOAST_DURATION_MS = 5000;
const CONFETTI_COUNT = 36;

/**
 * Top-level toast that drops in from the very top of the popup whenever a
 * new achievement is unlocked. Listens for the global `yacht:achievement-
 * unlocked` CustomEvent (dispatched from any sync path that produces a
 * `newlyUnlocked` array). Plays a synthesized two-note chime and rains
 * confetti under the banner for the 5 seconds the banner is on screen.
 */
export function AchievementToast() {
  const [queue, setQueue] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [phase, setPhase] = useState<'enter' | 'show' | 'leave'>('enter');
  // Don't double-show the same achievement id within a single popup session
  // — sync paths can fire the same id from multiple screens before the
  // toast finishes its enter-leave cycle.
  const seen = useRef<Set<string>>(new Set());

  // Receive global unlock events.
  useEffect(() => {
    function onUnlock(e: Event) {
      const detail = (e as CustomEvent<{ ids: string[] }>).detail;
      if (!detail?.ids?.length) return;
      const fresh = detail.ids.filter((id) => !seen.current.has(id));
      if (fresh.length === 0) return;
      for (const id of fresh) seen.current.add(id);
      setQueue((q) => [...q, ...fresh]);
    }
    window.addEventListener('yacht:achievement-unlocked', onUnlock as EventListener);
    return () => window.removeEventListener('yacht:achievement-unlocked', onUnlock as EventListener);
  }, []);

  // Pull the next item off the queue when nothing's currently on-screen.
  useEffect(() => {
    if (active != null) return;
    if (queue.length === 0) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    setActive(next);
    setPhase('enter');
  }, [queue, active]);

  // Drive the phase transitions: enter → show → leave → null.
  useEffect(() => {
    if (active == null) return;
    let t1 = 0, t2 = 0, t3 = 0;
    // Enter for ~250 ms then settle into show.
    t1 = window.setTimeout(() => setPhase('show'), 50);
    // Hold for the visible duration.
    t2 = window.setTimeout(() => setPhase('leave'), TOAST_DURATION_MS - 350);
    // Then dismiss.
    t3 = window.setTimeout(() => setActive(null), TOAST_DURATION_MS);
    // Chime fires once on mount.
    playChime();
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [active]);

  const text = useMemo(() => {
    if (!active) return '';
    return ACHIEVEMENTS.find((a) => a.id === active)?.text ?? active;
  }, [active]);

  if (active == null) return null;

  const slide =
    phase === 'enter'
      ? 'translateY(-110%)'
      : phase === 'leave'
      ? 'translateY(-110%)'
      : 'translateY(0)';

  return (
    <div
      // The popup root is position-static; using fixed inset-0 lets us mount
      // anywhere in the tree without depending on a relative ancestor.
      className="fixed left-0 right-0 top-0 z-[60] pointer-events-none"
      aria-live="polite"
    >
      <div
        className="mx-3 mt-3 rounded-2xl shadow-lg border-2 border-[#f5b042] bg-white px-4 py-3 transition-transform duration-300 ease-out"
        style={{ transform: slide }}
      >
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="rounded-full flex items-center justify-center text-white font-bold shrink-0"
            style={{ width: 28, height: 28, backgroundColor: '#f5b042', fontSize: 16 }}
          >
            ✓
          </span>
          <div className="min-w-0">
            <div className="font-bold text-ink-dim uppercase tracking-wider" style={{ fontSize: 11 }}>
              Achievement unlocked
            </div>
            <div className="font-bold text-ink truncate" style={{ fontSize: 15 }}>
              {text}
            </div>
          </div>
        </div>
      </div>
      {phase === 'show' && <FallingConfetti />}
    </div>
  );
}

/**
 * Confetti raining from just under the banner. Each piece has a randomised
 * horizontal position and fall speed; one CSS animation handles the drop.
 */
function FallingConfetti() {
  const pieces = useMemo(() => {
    const colors = ['#5eccfa', '#f5b042', '#22c55e', '#ec4899', '#a855f7', '#eab308'];
    return Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
      id: i,
      color: colors[i % colors.length],
      // Spread across the visible width.
      left: `${(Math.random() * 100).toFixed(1)}%`,
      // Random delay so the cascade isn't a wall.
      delay: `${(Math.random() * 0.6).toFixed(2)}s`,
      // 1.4–2.4 s descent.
      duration: `${(1.4 + Math.random() * 1).toFixed(2)}s`,
      width: 6 + Math.random() * 5,
      height: 8 + Math.random() * 6,
      rotate: `${(Math.random() * 720 - 360).toFixed(0)}deg`,
    }));
  }, []);
  return (
    <div className="pointer-events-none absolute left-0 right-0 overflow-hidden" style={{ top: 70, height: 400 }}>
      {pieces.map((p) => (
        <span
          key={p.id}
          className="yacht-rain"
          style={{
            position: 'absolute',
            left: p.left,
            top: 0,
            width: p.width,
            height: p.height,
            backgroundColor: p.color,
            borderRadius: 1,
            animationDelay: p.delay,
            animationDuration: p.duration,
            // The keyframe rotates from 0 to a final angle via custom prop.
            ['--end-rot' as any]: p.rotate,
          }}
        />
      ))}
    </div>
  );
}

let _audioCtx: AudioContext | null = null;
function playChime() {
  try {
    // Lazy-init: some browsers throw if AudioContext is constructed before
    // any user gesture. We only call this in response to UI activity, so
    // by the time we're here the policy permits playback.
    if (!_audioCtx) {
      const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
      if (!Ctor) return;
      _audioCtx = new Ctor();
    }
    const ctx = _audioCtx;
    if (!ctx) return;
    const now = ctx.currentTime;
    // Major triad arpeggio: C5 → E5 → G5. Short, cheery.
    const notes = [
      { freq: 523.25, t: 0.00 },
      { freq: 659.25, t: 0.10 },
      { freq: 783.99, t: 0.20 },
    ];
    for (const n of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = n.freq;
      gain.gain.setValueAtTime(0, now + n.t);
      gain.gain.linearRampToValueAtTime(0.15, now + n.t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + n.t + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + n.t);
      osc.stop(now + n.t + 0.55);
    }
  } catch { /* audio not available — silent */ }
}
