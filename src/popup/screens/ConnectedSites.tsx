import { useEffect, useState } from 'react';
import { Page, Screen, TopBar } from '../components/Layout';
import { rpc } from '@/lib/messaging';
import { hostFromOrigin, looksHomograph } from '@/lib/security';

export default function ConnectedSites() {
  const [origins, setOrigins] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const o = await rpc({ type: 'origins.list' });
    setOrigins(o);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function revoke(origin: string) {
    if (!confirm(`Revoke ${hostFromOrigin(origin)}? They'll need to reconnect to use this wallet.`)) return;
    await rpc({ type: 'origins.revoke', origin });
    await load();
  }

  return (
    <Screen>
      <TopBar title="Connected sites" />
      <Page>
        {loading && <div className="text-white/85 text-sm">Loading…</div>}
        {!loading && origins.length === 0 && (
          <div className="card text-center text-sm text-ink-dim py-6">
            No sites connected.
            <div className="text-[11px] text-ink-faint mt-2">
              Sites you connect to will appear here. You can revoke any site at any time.
            </div>
          </div>
        )}
        <div className="space-y-2">
          {origins.map((o) => {
            const host = hostFromOrigin(o);
            const homograph = looksHomograph(host);
            return (
              <div key={o} className="card flex justify-between items-center">
                <div className="min-w-0 flex-1">
                  <div className="font-bold truncate" style={{ fontSize: 18 }}>{host}</div>
                  <div className="text-ink-faint truncate font-mono font-bold" style={{ fontSize: 14 }}>{o}</div>
                  {homograph && (
                    <div className="text-warn mt-0.5 font-bold" style={{ fontSize: 14 }}>⚠ Possible look-alike domain</div>
                  )}
                </div>
                <button
                  className="text-danger hover:underline ml-2 font-bold"
                  style={{ fontSize: 15 }}
                  onClick={() => revoke(o)}
                >
                  Revoke
                </button>
              </div>
            );
          })}
        </div>
      </Page>
    </Screen>
  );
}
