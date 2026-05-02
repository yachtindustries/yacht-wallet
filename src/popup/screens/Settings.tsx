import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Page, Screen, TopBar } from '../components/Layout';
import { useApp } from '../store';
import { rpc } from '@/lib/messaging';

function ResetWalletButton() {
  const [step, setStep] = useState<'idle' | 'confirm'>('idle');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (step === 'idle') {
    return (
      <button className="btn-danger w-full" onClick={() => setStep('confirm')}>
        Reset wallet
      </button>
    );
  }

  return (
    <div className="card border-danger/30 bg-danger/5">
      <div className="text-sm font-semibold text-danger mb-2">Reset wallet</div>
      <p className="text-[11px] text-ink-dim mb-3">
        This deletes all keys on this device. Make sure your recovery phrase is backed up.
        You will not be able to recover this wallet without it.
      </p>
      <input
        className="input mb-2"
        type="password"
        placeholder="Wallet password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
      />
      {err && <div className="text-danger text-xs mb-2">{err}</div>}
      <div className="flex gap-2">
        <button className="btn-ghost flex-1" onClick={() => { setStep('idle'); setPw(''); setErr(null); }}>Cancel</button>
        <button
          className="btn-danger flex-1"
          disabled={busy || !pw}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              await rpc({ type: 'vault.destroy', password: pw });
              location.reload();
            } catch (e) {
              setErr((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Resetting…' : 'Reset wallet'}
        </button>
      </div>
    </div>
  );
}

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

  return (
    <Screen>
      <TopBar title="Settings" />
      <Page>
        <div className="card mb-3">
          <div className="text-xs text-ink-dim mb-1">Network</div>
          <div className="text-sm">ApeChain mainnet · chain id 33139</div>
          <div className="text-[11px] text-ink-faint mt-1">RPC: rpc.apechain.com</div>
        </div>

        <div className="card mb-3">
          <div className="text-xs text-ink-dim mb-2">Auto-lock</div>
          <select
            className="input"
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
          <div className="text-xs text-ink-dim mb-2">Display currency</div>
          <select
            className="input"
            value={settings.fiatCurrency}
            onChange={(e) => setFiat(e.target.value as 'usd' | 'eur' | 'gbp')}
            disabled={busy}
          >
            <option value="usd">USD</option>
            <option value="eur">EUR</option>
            <option value="gbp">GBP</option>
          </select>
        </div>

        <Link to="/settings/sites" className="card w-full flex items-center justify-between hover:border-brand mb-3">
          <span className="text-sm">Connected sites</span>
          <span className="text-ink-dim">›</span>
        </Link>

        <button className="btn-ghost w-full mb-2" onClick={lock}>Lock wallet</button>
        <ResetWalletButton />
        <p className="text-[11px] text-ink-faint text-center mt-3">Yacht v0.1.0</p>
      </Page>
    </Screen>
  );
}
