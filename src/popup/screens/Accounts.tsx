import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Page, Screen, TopBar } from '../components/Layout';
import { useApp } from '../store';
import { rpc } from '@/lib/messaging';
import { shortAddress } from '@/lib/wallet-utils';
import { CopyButton } from '../components/Copy';

const settingsIconUrl = chrome.runtime.getURL('public/actions/settings.png');

type Mode = 'list' | 'add-derived' | 'add-pk' | 'reveal-pk' | 'reveal-mnemonic';

export default function Accounts() {
  const nav = useNavigate();
  const { meta, refreshStatus, lock } = useApp();
  const [mode, setMode] = useState<Mode>('list');
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const [revealId, setRevealId] = useState<string | null>(null);
  const [revealPw, setRevealPw] = useState('');
  const [revealedPk, setRevealedPk] = useState<string | null>(null);
  const [revealedMnemonic, setRevealedMnemonic] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function activate(id: string) {
    await rpc({ type: 'vault.account.activate', id });
    await refreshStatus();
    nav('/');
  }

  async function add() {
    setErr(null);
    setBusy(true);
    try {
      if (mode === 'add-derived') {
        await rpc({ type: 'vault.account.add.derived', name: name || undefined });
      } else if (mode === 'add-pk') {
        const trimmed = secret.trim();
        const pk = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
        if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error('Private key must be 32 bytes (64 hex chars)');
        await rpc({ type: 'vault.account.add.privateKey', name: name || undefined, privateKey: pk });
      }
      setName('');
      setSecret('');
      setMode('list');
      await refreshStatus();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revealPk() {
    if (!revealId) return;
    setErr(null);
    setBusy(true);
    try {
      const r = await rpc({ type: 'vault.account.reveal', id: revealId, password: revealPw });
      setRevealedPk(r.privateKey);
    } catch {
      setErr('Incorrect password');
    } finally {
      setBusy(false);
    }
  }

  async function revealMnemonic() {
    setErr(null);
    setBusy(true);
    try {
      const r = await rpc({ type: 'vault.mnemonic.reveal', password: revealPw });
      if (!r.mnemonic) throw new Error('No HD recovery phrase — all accounts were imported.');
      setRevealedMnemonic(r.mnemonic);
    } catch (e) {
      setErr((e as Error).message || 'Incorrect password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <TopBar
        title="Accounts"
        right={
          <button
            onClick={() => nav('/settings')}
            aria-label="Settings"
            className="hover:opacity-80"
          >
            <span
              role="img"
              aria-hidden
              className="block"
              style={{
                width: 24,
                height: 24,
                backgroundColor: '#ffffff',
                WebkitMaskImage: `url(${settingsIconUrl})`,
                maskImage: `url(${settingsIconUrl})`,
                WebkitMaskRepeat: 'no-repeat',
                maskRepeat: 'no-repeat',
                WebkitMaskPosition: 'center',
                maskPosition: 'center',
                WebkitMaskSize: 'contain',
                maskSize: 'contain',
              }}
            />
          </button>
        }
      />
      <Page>
        {mode === 'list' && (
          <>
            <div className="space-y-2">
              {meta?.publicAccounts.map((a) => (
                <div key={a.id} className={`card flex justify-between items-center gap-2 ${a.id === meta.activeAccountId ? 'border-brand' : ''}`}>
                  <button className="text-left flex-1 min-w-0" onClick={() => activate(a.id)}>
                    <div className="font-bold" style={{ fontSize: 17 }}>{a.name}</div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-ink-faint font-mono truncate" style={{ fontSize: 13 }}>{shortAddress(a.address)}</span>
                      <AddressCopy address={a.address} />
                    </div>
                  </button>
                  <button
                    className="text-ink-dim hover:text-ink font-bold"
                    style={{ fontSize: 14 }}
                    onClick={() => {
                      setRevealId(a.id);
                      setMode('reveal-pk');
                      setRevealPw('');
                      setRevealedPk(null);
                      setErr(null);
                    }}
                  >
                    Reveal key
                  </button>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2 mt-4">
              <button className="btn-ghost flex-col py-3" onClick={() => setMode('add-derived')}>
                <span style={{ fontSize: 20 }}>+</span>
                <span style={{ fontSize: 14 }}>New account</span>
              </button>
              <button className="btn-ghost flex-col py-3" onClick={() => setMode('add-pk')}>
                <span style={{ fontSize: 20 }}>↧</span>
                <span style={{ fontSize: 14 }}>Import private key</span>
              </button>
            </div>

            <div className="mt-6 space-y-2">
              <button
                onClick={() => {
                  setMode('reveal-mnemonic');
                  setRevealPw('');
                  setRevealedMnemonic(null);
                  setErr(null);
                }}
                className="btn w-full font-bold text-white"
                style={{ backgroundColor: '#f6c87e' }}
              >
                Seed Phrase
              </button>
              <button
                onClick={lock}
                className="btn w-full font-bold text-black bg-white"
              >
                Lock Wallet
              </button>
            </div>
          </>
        )}

        {(mode === 'add-derived' || mode === 'add-pk') && (
          <>
            <h3 className="font-bold mb-3" style={{ fontSize: 17 }}>
              {mode === 'add-derived' ? 'New derived account' : 'Import private key'}
            </h3>
            <label className="label">Account name (optional)</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="My account" />
            {mode === 'add-pk' && (
              <>
                <label className="label mt-3">Private key</label>
                <textarea
                  className="input min-h-[80px] font-mono text-xs"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="0x…"
                />
              </>
            )}
            {mode === 'add-derived' && (
              <p className="text-[11px] text-ink-faint mt-2">
                Derives a new account from your existing recovery phrase at the next standard
                Ethereum HD path (m/44'/60'/0'/0/N).
              </p>
            )}
            {err && <div className="text-danger text-xs mt-2">{err}</div>}
            <div className="flex gap-2 mt-4">
              <button className="btn-ghost flex-1" onClick={() => setMode('list')}>Cancel</button>
              <button className="btn-primary flex-1" disabled={busy} onClick={add}>{busy ? 'Adding…' : 'Add'}</button>
            </div>
          </>
        )}

        {mode === 'reveal-pk' && (
          <>
            <h3 className="font-bold mb-1" style={{ fontSize: 17 }}>Reveal private key</h3>
            <p className="text-ink-dim mb-3" style={{ fontSize: 14 }}>
              Enter your password to view this account's private key. Never share it.
            </p>
            {!revealedPk ? (
              <>
                <input className="input" type="password" value={revealPw} onChange={(e) => setRevealPw(e.target.value)} placeholder="Wallet password" />
                {err && <div className="text-danger text-xs mt-2">{err}</div>}
                <div className="flex gap-2 mt-4">
                  <button className="btn-ghost flex-1" onClick={() => setMode('list')}>Cancel</button>
                  <button className="btn-primary flex-1" disabled={busy} onClick={revealPk}>{busy ? 'Verifying…' : 'Reveal'}</button>
                </div>
              </>
            ) : (
              <>
                <div className="card font-mono text-xs break-all select-all">{revealedPk}</div>
                <div className="text-center mt-2">
                  <CopyButton text={revealedPk} label="Copy private key" clearAfterMs={60_000} />
                </div>
                <button className="btn-ghost w-full mt-3" onClick={() => setMode('list')}>Done</button>
              </>
            )}
          </>
        )}

        {mode === 'reveal-mnemonic' && (
          <>
            <h3 className="font-bold mb-1" style={{ fontSize: 17 }}>Reveal recovery phrase</h3>
            <p className="text-ink-dim mb-3" style={{ fontSize: 14 }}>
              The recovery phrase derives every account in this wallet. Whoever holds it can spend all your funds.
            </p>
            {!revealedMnemonic ? (
              <>
                <input className="input" type="password" value={revealPw} onChange={(e) => setRevealPw(e.target.value)} placeholder="Wallet password" />
                {err && <div className="text-danger text-xs mt-2">{err}</div>}
                <div className="flex gap-2 mt-4">
                  <button className="btn-ghost flex-1" onClick={() => setMode('list')}>Cancel</button>
                  <button className="btn-primary flex-1" disabled={busy} onClick={revealMnemonic}>{busy ? 'Verifying…' : 'Reveal'}</button>
                </div>
              </>
            ) : (
              <>
                <div className="card">
                  <div className="grid grid-cols-3 gap-2">
                    {revealedMnemonic.split(/\s+/).map((w, i) => (
                      <div key={i} className="bg-bg-soft border border-line rounded-lg px-2 py-1.5 text-xs">
                        <span className="text-ink-faint mr-1">{i + 1}.</span>
                        <span className="font-mono">{w}</span>
                      </div>
                    ))}
                  </div>
                  <div className="text-center mt-3">
                    <CopyButton text={revealedMnemonic} label="Copy phrase" clearAfterMs={60_000} />
                  </div>
                </div>
                <button className="btn-ghost w-full mt-3" onClick={() => setMode('list')}>Done</button>
              </>
            )}
          </>
        )}
      </Page>
    </Screen>
  );
}

function AddressCopy({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async (e) => {
        e.stopPropagation();
        await navigator.clipboard.writeText(address);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      title={copied ? 'Copied!' : 'Copy address'}
      aria-label="Copy address"
      className="text-ink-dim hover:text-brand shrink-0"
      style={{ fontSize: 18 }}
    >
      {copied ? '✓' : '⧉'}
    </button>
  );
}
