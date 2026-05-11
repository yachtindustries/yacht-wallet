import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Page, Screen, TopBar } from '../components/Layout';
import { useApp } from '../store';
import { rpc } from '@/lib/messaging';

export default function Settings() {
  const { settings, refreshSettings, lock } = useApp();
  const [busy, setBusy] = useState(false);

  async function setAutoLock(autoLockMinutes: number) {
    setBusy(true);
    await rpc({ type: 'settings.set', settings: { autoLockMinutes } });
    await refreshSettings();
    setBusy(false);
  }

  async function setFiat(fiatCurrency: 'usd' | 'eur' | 'gbp') {
    setBusy(true);
    await rpc({ type: 'settings.set', settings: { fiatCurrency } });
    await refreshSettings();
    setBusy(false);
  }

  if (!settings) return null;

  // Subtle grey "pill" so the user knows the value is clickable. The
  // page sits on a white card, so a 5% black overlay reads as a very
  // light grey without competing with the surrounding cards. A small
  // chevron is appended on the right via background-image so the
  // dropdown affordance is unambiguous even with `appearance-none`.
  const selectClasses =
    'w-full rounded-xl px-3 py-2.5 font-bold text-ink focus:outline-none focus:border-brand appearance-none cursor-pointer';
  const selectStyle: React.CSSProperties = {
    backgroundColor: 'rgba(0,0,0,0.05)',
    border: '1px solid rgba(0,0,0,0.08)',
    backgroundImage:
      'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'8\' viewBox=\'0 0 12 8\'><path fill=\'none\' stroke=\'%230a0e14\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\' d=\'M1 1l5 5 5-5\'/></svg>")',
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 12px center',
    paddingRight: 32,
  };

  return (
    <Screen>
      <TopBar title="Settings" />
      <Page>
        <div className="card mb-3">
          <div className="text-ink-dim mb-1 font-bold" style={{ fontSize: 15 }}>Network</div>
          <div className="font-bold" style={{ fontSize: 18 }}>ApeChain mainnet</div>
          <div className="text-ink-faint mt-1 font-bold" style={{ fontSize: 14 }}>RPC: rpc.apechain.com</div>
        </div>

        <div className="card mb-3">
          <div className="text-ink-dim mb-2 font-bold" style={{ fontSize: 15 }}>Auto-lock</div>
          <select
            className={selectClasses}
            style={{ ...selectStyle, fontSize: 16 }}
            value={settings.autoLockMinutes}
            onChange={(e) => setAutoLock(Number(e.target.value))}
            disabled={busy}
          >
            <option value={0}>Never</option>
            <option value={1}>1 minute</option>
            <option value={5}>5 minutes</option>
            <option value={15}>15 minutes</option>
            <option value={60}>1 hour</option>
          </select>
        </div>

        <div className="card mb-3">
          <div className="text-ink-dim mb-2 font-bold" style={{ fontSize: 15 }}>Display currency</div>
          <select
            className={selectClasses}
            style={{ ...selectStyle, fontSize: 16 }}
            value={settings.fiatCurrency}
            onChange={(e) => setFiat(e.target.value as 'usd' | 'eur' | 'gbp')}
            disabled={busy}
          >
            <option value="usd">USD</option>
            <option value="eur">EUR</option>
            <option value="gbp">GBP</option>
          </select>
        </div>

        <Link
          to="/settings/sites"
          className="card w-full flex items-center hover:border-brand mb-3 font-bold"
          style={{ fontSize: 18 }}
        >
          Connected sites
        </Link>

        <button
          className="btn w-full font-bold text-white bg-[#5eccfa] hover:bg-[#3eb8e8]"
          onClick={lock}
        >
          Lock wallet
        </button>

        <p className="text-white/70 text-center mt-3 font-bold" style={{ fontSize: 14 }}>Yacht v0.1.5</p>
      </Page>
    </Screen>
  );
}
