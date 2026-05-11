import { useEffect, useState } from 'react';
import { Page, Screen, TopBar } from '../components/Layout';
import { useApp } from '../store';
import { rpc } from '@/lib/messaging';
import { ACHIEVEMENTS } from '@/lib/achievements';

export default function Achievements() {
  const { meta } = useApp();
  const active = meta?.publicAccounts.find((a) => a.id === meta?.activeAccountId);
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await rpc({ type: 'achievements.sync', address: active.address });
        if (!cancelled) {
          setUnlocked(new Set(r.unlocked));
          if (r.newlyUnlocked && r.newlyUnlocked.length > 0) {
            window.dispatchEvent(
              new CustomEvent('yacht:achievement-unlocked', { detail: { ids: r.newlyUnlocked } }),
            );
          }
        }
      } catch {
        // fall back to whatever's already cached
        try {
          const s = await rpc({ type: 'achievements.snapshot', address: active.address });
          if (!cancelled) setUnlocked(new Set(s.unlocked));
        } catch { /* leave empty */ }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [active?.address]);

  return (
    <Screen>
      <TopBar title="Achievements" />
      <Page>
        <div className="flex items-baseline justify-between mb-3">
          <span className="text-white/85 font-bold" style={{ fontSize: 14 }}>
            {loading ? 'Syncing…' : `${unlocked.size} of ${ACHIEVEMENTS.length} unlocked`}
          </span>
          <button
            className="font-bold text-white/85 hover:text-white"
            style={{ fontSize: 13 }}
            onClick={async () => {
              if (!active) return;
              setLoading(true);
              try {
                const r = await rpc({ type: 'achievements.sync', address: active.address, force: true });
                setUnlocked(new Set(r.unlocked));
                if (r.newlyUnlocked && r.newlyUnlocked.length > 0) {
                  window.dispatchEvent(
                    new CustomEvent('yacht:achievement-unlocked', { detail: { ids: r.newlyUnlocked } }),
                  );
                }
              } finally {
                setLoading(false);
              }
            }}
          >
            Refresh
          </button>
        </div>

        <div className="space-y-2">
          {ACHIEVEMENTS.map((a) => {
            const done = unlocked.has(a.id);
            return (
              <div
                key={a.id}
                className="card flex items-center gap-3"
                style={{ opacity: done ? 1 : 0.85 }}
              >
                <CheckCircle done={done} />
                <div className={`flex-1 font-bold ${done ? 'text-ink' : 'text-ink-dim'}`} style={{ fontSize: 15 }}>
                  {a.text}
                </div>
              </div>
            );
          })}
        </div>
      </Page>
    </Screen>
  );
}

function CheckCircle({ done }: { done: boolean }) {
  if (done) {
    return (
      <span
        className="rounded-full flex items-center justify-center text-white font-bold shrink-0"
        style={{ width: 26, height: 26, backgroundColor: '#5eccfa', fontSize: 16 }}
        aria-label="Unlocked"
      >
        ✓
      </span>
    );
  }
  return (
    <span
      className="rounded-full shrink-0"
      style={{ width: 26, height: 26, border: '2px solid rgba(0,0,0,0.2)' }}
      aria-label="Locked"
    />
  );
}
