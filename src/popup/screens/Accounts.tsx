import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Page, Screen, TopBar } from '../components/Layout';
import { useApp } from '../store';
import { rpc } from '@/lib/messaging';
import { shortAddress } from '@/lib/wallet-utils';
import { CopyButton } from '../components/Copy';
import { AddressActions } from '../components/AddressActions';

const settingsIconUrl = chrome.runtime.getURL('public/actions/settings.png');
const TRACKED_TOKENS_KEY = 'yacht.trackedTokens.v1';

function accountInitial(name: string): string {
  const trimmed = name.trim();
  const m = /^account\s*(\d+)$/i.exec(trimmed);
  if (m) return `A${m[1]}`;
  return (trimmed[0] ?? 'A').toUpperCase();
}

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
  const [usdByAccount, setUsdByAccount] = useState<Record<string, number>>({});

  // Auto-clear revealed secrets after 60s of inactivity, on tab blur, and on
  // unmount. JS strings can't be securely zeroed; this just shrinks the
  // window during which the secret sits in popup memory.
  useEffect(() => {
    if (!revealedPk && !revealedMnemonic) return;
    const clear = () => { setRevealedPk(null); setRevealedMnemonic(null); };
    const timer = window.setTimeout(clear, 60_000);
    window.addEventListener('blur', clear);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('blur', clear);
    };
  }, [revealedPk, revealedMnemonic]);

  // Fetch USD totals for every account in parallel. Uses one APE-price + one
  // DexScreener pair lookup per unique tracked token, then sums each account's
  // (native_balance × ape_usd) + Σ(token_balance × token_usd). Cheap on the
  // common case (a handful of accounts and tracked tokens); failures fall
  // through silently so the row just hides the total.
  useEffect(() => {
    const accounts = meta?.publicAccounts ?? [];
    if (accounts.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await chrome.storage.local.get(TRACKED_TOKENS_KEY);
        const tracked: string[] = Array.isArray(r[TRACKED_TOKENS_KEY]) ? r[TRACKED_TOKENS_KEY] : [];
        const [apePriceResp, ...pairResps] = await Promise.all([
          rpc({ type: 'price.get' }).catch(() => null),
          ...tracked.map((t) =>
            rpc({ type: 'dex.token', query: t }).catch(() => null),
          ),
        ]);
        const apeUsd = (apePriceResp?.usd ?? 0) || 0;
        const tokenUsdByAddr = new Map<string, number>();
        tracked.forEach((addr, i) => {
          const p = pairResps[i];
          const usd = p?.priceUsd ? parseFloat(p.priceUsd) : NaN;
          if (Number.isFinite(usd)) tokenUsdByAddr.set(addr.toLowerCase(), usd);
        });
        const perAccount = await Promise.all(
          accounts.map(async (a) => {
            try {
              const [summary, balances] = await Promise.all([
                rpc({ type: 'evm.account', address: a.address }),
                tracked.length
                  ? rpc({ type: 'evm.erc20.balances', tokens: tracked, address: a.address })
                  : Promise.resolve([]),
              ]);
              let total = parseFloat(summary.nativeBalance) * apeUsd;
              for (const b of balances) {
                const usd = tokenUsdByAddr.get(b.token.address.toLowerCase());
                if (usd != null) total += parseFloat(b.balance) * usd;
              }
              return [a.id, total] as const;
            } catch {
              return [a.id, 0] as const;
            }
          }),
        );
        if (cancelled) return;
        setUsdByAccount(Object.fromEntries(perAccount));
      } catch { /* leave totals empty */ }
    })();
    return () => { cancelled = true; };
  }, [meta?.publicAccounts.length, meta?.publicAccounts.map((a) => a.address).join(',')]);

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
                width: 18,
                height: 18,
                backgroundColor: '#2e2114',
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
              {meta?.publicAccounts.map((a) => {
                const isActive = a.id === meta.activeAccountId;
                const usd = usdByAccount[a.id];
                const usdText = usd != null
                  ? `$${usd.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`
                  : '';
                return (
                <div
                  key={a.id}
                  className={`flex items-center gap-3 rounded-2xl p-4 border ${isActive ? 'border-transparent' : 'border-line bg-bg-card'}`}
                  style={isActive ? { backgroundColor: '#5eccfa' } : undefined}
                >
                  <button className="shrink-0" onClick={() => activate(a.id)} aria-label={`Switch to ${a.name}`}>
                    <span
                      className={`block rounded-full flex items-center justify-center font-bold ${isActive ? 'bg-white/30 text-white' : 'bg-brand/25 text-brand'}`}
                      style={{ width: 36, height: 36, fontSize: 13 }}
                    >
                      {accountInitial(a.name)}
                    </span>
                  </button>
                  <div className="flex-1 min-w-0">
                    <button className="w-full flex items-baseline justify-between gap-3" onClick={() => activate(a.id)}>
                      <span className={`font-bold truncate ${isActive ? 'text-white' : ''}`} style={{ fontSize: 17 }}>
                        {a.name}
                      </span>
                      <span className={`font-bold shrink-0 ${isActive ? 'text-white' : 'text-ink'}`} style={{ fontSize: 17 }}>
                        {usdText}
                      </span>
                    </button>
                    <div className="flex items-center justify-between gap-2 mt-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`font-mono truncate ${isActive ? 'text-white' : 'text-ink-faint'}`}
                          style={{ fontSize: 13 }}
                        >
                          {shortAddress(a.address)}
                        </span>
                        <AddressActions address={a.address} color={isActive ? '#ffffff' : '#6b4423'} size={16} />
                      </div>
                      <button
                        className={`font-bold shrink-0 ${isActive ? 'text-white hover:opacity-80' : 'text-ink-dim hover:text-ink'}`}
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
                  </div>
                </div>
                );
              })}
            </div>

            <div className="grid grid-cols-2 gap-2 mt-4">
              <button className="btn-ghost flex-col py-3" onClick={() => setMode('add-derived')}>
                <span style={{ fontSize: 24, lineHeight: 1 }}>+</span>
                <span style={{ fontSize: 14 }}>New account</span>
              </button>
              <button className="btn-ghost flex-col py-3" onClick={() => setMode('add-pk')}>
                <span
                  role="img"
                  aria-hidden
                  className="block"
                  style={{
                    width: 14,
                    height: 14,
                    backgroundColor: '#2e2114',
                    WebkitMaskImage: `url(${chrome.runtime.getURL('public/actions/sendreceive.png')})`,
                    maskImage: `url(${chrome.runtime.getURL('public/actions/sendreceive.png')})`,
                    WebkitMaskRepeat: 'no-repeat',
                    maskRepeat: 'no-repeat',
                    WebkitMaskPosition: 'center',
                    maskPosition: 'center',
                    WebkitMaskSize: 'contain',
                    maskSize: 'contain',
                    transform: 'rotate(180deg)',
                  }}
                />
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
            <h3 className="font-bold mb-3" style={{ fontSize: 17 }}>Reveal private key</h3>
            {!revealedPk ? (
              <>
                <input
                  className="w-full bg-white border-0 rounded-xl px-3 py-2.5 font-bold text-black placeholder:text-ink-faint focus:outline-none"
                  style={{ fontSize: 15 }}
                  type="password"
                  autoComplete="current-password"
                  spellCheck={false}
                  value={revealPw}
                  onChange={(e) => setRevealPw(e.target.value)}
                  placeholder="Wallet password"
                />
                {err && <div className="text-danger text-xs mt-2">{err}</div>}
                <div className="flex gap-2 mt-4">
                  <button
                    className="btn flex-1 text-white font-bold hover:opacity-90"
                    style={{ backgroundColor: '#f6c87e' }}
                    onClick={() => setMode('list')}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn flex-1 text-white font-bold bg-[#5eccfa] hover:bg-[#3eb8e8] disabled:opacity-60"
                    disabled={busy}
                    onClick={revealPk}
                  >
                    {busy ? 'Verifying…' : 'Reveal'}
                  </button>
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
                <input
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  spellCheck={false}
                  value={revealPw}
                  onChange={(e) => setRevealPw(e.target.value)}
                  placeholder="Wallet password"
                />
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

