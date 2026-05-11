import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Page, Screen, TopBar } from '../components/Layout';
import { useApp } from '../store';
import { rpc } from '@/lib/messaging';
import { shortAddress } from '@/lib/wallet-utils';
import { CopyButton } from '../components/Copy';
import { AddressActions } from '../components/AddressActions';
import { RankAvatar } from '../components/RankAvatar';
import { PfpAvatar, usePfp } from '../components/PfpAvatar';
import { computeRank, progressToNextUsd, rankIconUrl } from '@/lib/ranks';
import { TOTAL_ACHIEVEMENTS } from '@/lib/achievements';

const settingsIconUrl = chrome.runtime.getURL('public/actions/settings.png');
const TRACKED_TOKENS_KEY = 'yacht.trackedTokens.v1';

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
  const [unlockedByAccount, setUnlockedByAccount] = useState<Record<string, number>>({});
  // Active account's @username + edit-mode state.
  const [username, setUsernameState] = useState<string>('');
  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState('');
  const [usernameErr, setUsernameErr] = useState<string | null>(null);
  // Brief "Copied" flash on the active-account address pill.
  const [addrCopied, setAddrCopied] = useState(false);
  // Inline rename of the active account (the title at the top of the page).
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [nameErr, setNameErr] = useState<string | null>(null);

  async function saveAccountName() {
    const id = meta?.activeAccountId;
    if (!id) return;
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setNameErr('Name cannot be empty');
      return;
    }
    setNameErr(null);
    try {
      await rpc({ type: 'vault.account.rename', id, name: trimmed });
      await refreshStatus();
      setEditingName(false);
    } catch (e) {
      setNameErr((e as Error).message);
    }
  }

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

  // Pull achievement counts per account. Active account also triggers a
  // sync (which evaluates against current chain state and persists newly-
  // unlocked achievements). Other accounts read from local cache only.
  useEffect(() => {
    const accounts = meta?.publicAccounts ?? [];
    if (accounts.length === 0) return;
    const activeId = meta?.activeAccountId;
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        accounts.map(async (a) => {
          const isActive = a.id === activeId;
          try {
            if (isActive) {
              const r = await rpc({ type: 'achievements.sync', address: a.address });
              if (!cancelled && r.newlyUnlocked && r.newlyUnlocked.length > 0) {
                window.dispatchEvent(
                  new CustomEvent('yacht:achievement-unlocked', { detail: { ids: r.newlyUnlocked } }),
                );
              }
              return [a.id, r.unlocked.length] as const;
            }
            const r = await rpc({ type: 'achievements.snapshot', address: a.address });
            return [a.id, r.unlocked.length] as const;
          } catch {
            return [a.id, 0] as const;
          }
        }),
      );
      if (cancelled) return;
      setUnlockedByAccount(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [meta?.activeAccountId, meta?.publicAccounts.map((a) => a.address).join(',')]);

  // Pull (or auto-generate) the active account's username whenever the
  // active account changes. The handler will create one on first read.
  useEffect(() => {
    const activeId = meta?.activeAccountId;
    if (!activeId) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await rpc({ type: 'username.get', accountId: activeId });
        if (!cancelled) {
          setUsernameState(r.username);
          setUsernameDraft(r.username);
        }
      } catch { /* leave empty */ }
    })();
    return () => { cancelled = true; };
  }, [meta?.activeAccountId]);

  async function saveUsername() {
    const id = meta?.activeAccountId;
    if (!id) return;
    setUsernameErr(null);
    try {
      const r = await rpc({ type: 'username.set', accountId: id, username: usernameDraft });
      setUsernameState(r.username);
      setUsernameDraft(r.username);
      setEditingUsername(false);
    } catch (e) {
      setUsernameErr((e as Error).message);
    }
  }

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
        title={(() => {
          const a = meta?.publicAccounts.find((x) => x.id === meta?.activeAccountId);
          if (!a) return 'Accounts';
          if (editingName) {
            return (
              <span className="inline-flex flex-col items-center">
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); void saveAccountName(); }
                    if (e.key === 'Escape') { setEditingName(false); setNameErr(null); }
                  }}
                  className="bg-white text-ink font-bold rounded-md px-2 py-0.5 focus:outline-none"
                  style={{ fontSize: 17, width: 200 }}
                  maxLength={32}
                  spellCheck={false}
                />
                {nameErr && (
                  <span className="text-danger font-bold mt-0.5" style={{ fontSize: 11 }}>{nameErr}</span>
                )}
              </span>
            );
          }
          // Group + group-hover keeps the pencil hidden until the cursor
          // is over the name; the pencil itself is positioned absolutely
          // so it doesn't take any layout width — that way the title
          // stays perfectly centred whether or not the pencil is visible.
          return (
            <span className="group relative inline-flex items-center justify-center">
              <span>{a.name}</span>
              <button
                onClick={() => {
                  setNameDraft(a.name);
                  setEditingName(true);
                  setNameErr(null);
                }}
                aria-label="Rename account"
                title="Rename account"
                className="absolute opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ left: '100%', marginLeft: 6 }}
              >
                <PencilIcon />
              </button>
            </span>
          );
        })()}
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
      <Page className="mobile-scale-120">
        {mode === 'list' && (
          <>
            {(() => {
              const active = meta?.publicAccounts.find((a) => a.id === meta?.activeAccountId);
              if (!active) return null;
              const usd = usdByAccount[active.id] ?? 0;
              const unlocked = unlockedByAccount[active.id] ?? 0;
              const tier = computeRank(usd, unlocked);
              const prog = progressToNextUsd(usd);
              const fmt = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: n < 100 ? 2 : 0 })}`;
              return (
                <div className="flex flex-col items-center mb-4">
                  {/* @username + pencil edit, just under the title bar.
                      Pulled up slightly (~5%) with a negative margin so it
                      sits closer to the title. The pencil is hidden until
                      the user mouses over the username so the row stays
                      visually quiet by default. */}
                  {!editingUsername ? (
                    // The pencil sits in absolute position relative to
                    // this wrapper so it never adds layout width — the
                    // username stays centred whether or not the pencil
                    // is visible.
                    <div
                      className="group relative inline-flex items-center justify-center mb-3"
                      style={{ marginTop: '-5%' }}
                    >
                      <span className="font-bold text-white" style={{ fontSize: 19 }}>
                        @{username || '…'}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingUsername(true);
                          setUsernameDraft(username);
                          setUsernameErr(null);
                        }}
                        className="absolute opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ left: '100%', marginLeft: 6 }}
                        aria-label="Edit username"
                        title="Edit username"
                      >
                        <PencilIcon />
                      </button>
                    </div>
                  ) : (
                    <div className="w-full mb-3" style={{ marginTop: '-5%' }}>
                      <div className="flex items-center gap-2">
                        <input
                          autoFocus
                          className="flex-1 rounded-lg bg-white px-3 py-1.5 font-bold text-black placeholder:text-black/60 focus:outline-none"
                          style={{ fontSize: 15 }}
                          value={usernameDraft}
                          onChange={(e) => setUsernameDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); void saveUsername(); }
                            if (e.key === 'Escape') { setEditingUsername(false); }
                          }}
                          maxLength={20}
                          spellCheck={false}
                        />
                        <button
                          onClick={() => void saveUsername()}
                          className="px-3 py-1.5 rounded-lg bg-[#5eccfa] hover:bg-[#3eb8e8] text-white font-bold"
                          style={{ fontSize: 13 }}
                        >
                          Save
                        </button>
                        <button
                          onClick={() => { setEditingUsername(false); setUsernameDraft(username); setUsernameErr(null); }}
                          className="px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white font-bold"
                          style={{ fontSize: 13 }}
                        >
                          Cancel
                        </button>
                      </div>
                      {usernameErr && (
                        <div className="text-danger mt-1 font-bold" style={{ fontSize: 12 }}>{usernameErr}</div>
                      )}
                    </div>
                  )}

                  {/* Big PFP slot — when the user has set an NFT as their
                      profile picture, the NFT image takes the 110-px slot
                      and a smaller rank icon appears under it. Default
                      (no PFP) renders the rank icon directly at 110 px,
                      matching the prior look. */}
                  <BigPfp
                    accountId={active.id}
                    rank={tier.rank}
                    fraction={prog.fraction}
                  />
                  <div className="text-white font-bold mt-1" style={{ fontSize: 18 }}>Rank {tier.rank}</div>

                  {/* USD progress: left label is the account's *current* USD,
                      right label is the threshold for the next tier. The
                      labels are ~30% larger than they were before so they
                      read clearly above the bar. */}
                  <div className="w-full mt-3">
                    <div className="flex justify-between font-bold text-white/85" style={{ fontSize: 16 }}>
                      <span>{fmt(usd)}</span>
                      <span>{prog.nextMinUsd === prog.currentMinUsd ? 'Max rank' : fmt(prog.nextMinUsd)}</span>
                    </div>
                    <div className="w-full mt-1 rounded-full bg-white/15 overflow-hidden" style={{ height: 12 }}>
                      <div
                        className="h-full bar-shiny rounded-full"
                        style={{
                          width: `${(prog.fraction * 100).toFixed(1)}%`,
                          // Subtle sheen — only a step lighter than the
                          // base water blue so it reads as a shimmer
                          // rather than a white flash.
                          ['--bar-fill' as any]: '#5eccfa',
                          ['--bar-shine' as any]: '#87dbfb',
                        }}
                      />
                    </div>
                  </div>

                  {/* Address (with copy + Apescan icons) on the left, Reveal
                      key on the right — sits between the USD bar and the
                      achievements card. */}
                  <div className="w-full mt-3 rounded-2xl bg-white p-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {/* Click the address itself to copy it; the existing
                          AddressActions cluster sits next to it for the
                          explicit copy / Apescan affordances. The text
                          itself is ~20% bigger than the prior 13 px and
                          rendered bold for the new top section. */}
                      <button
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(active.address);
                            setAddrCopied(true);
                            window.setTimeout(() => setAddrCopied(false), 2000);
                          } catch { /* ignore */ }
                        }}
                        className="font-mono font-bold truncate text-ink text-left hover:opacity-80"
                        style={{ fontSize: 16 }}
                        title="Click to copy"
                      >
                        {addrCopied ? 'Copied' : shortAddress(active.address)}
                      </button>
                      <AddressActions address={active.address} color="#2e2114" size={16} />
                    </div>
                    <button
                      className="font-bold text-ink-dim hover:text-ink shrink-0"
                      style={{ fontSize: 14 }}
                      onClick={() => {
                        setRevealId(active.id);
                        setMode('reveal-pk');
                        setRevealPw('');
                        setRevealedPk(null);
                        setErr(null);
                      }}
                    >
                      Reveal key
                    </button>
                  </div>

                  <button
                    onClick={() => nav('/achievements')}
                    className="w-full mt-3 rounded-2xl p-3 bg-white text-left hover:opacity-90"
                  >
                    <div className="flex items-baseline justify-between mb-1">
                      <span className="font-bold text-ink" style={{ fontSize: 15 }}>Achievements</span>
                      <span className="font-bold text-ink" style={{ fontSize: 15 }}>
                        {unlocked} / {TOTAL_ACHIEVEMENTS}
                      </span>
                    </div>
                    <div className="w-full rounded-full bg-ink-faint/20 overflow-hidden" style={{ height: 8 }}>
                      <div
                        className="h-full bar-shiny rounded-full"
                        style={{
                          width: `${(Math.min(1, unlocked / TOTAL_ACHIEVEMENTS) * 100).toFixed(1)}%`,
                          // Same restraint as the USD bar — gold sheen is
                          // a half-step lighter than the base, not a
                          // bright yellow flash.
                          ['--bar-fill' as any]: '#f5b042',
                          ['--bar-shine' as any]: '#f9c772',
                        }}
                      />
                    </div>
                  </button>
                </div>
              );
            })()}

            <div className="space-y-2">
              {meta?.publicAccounts.map((a) => {
                const isActive = a.id === meta.activeAccountId;
                const usd = usdByAccount[a.id];
                const usdText = usd != null
                  ? `$${usd.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`
                  : '';
                const unlocked = unlockedByAccount[a.id] ?? 0;
                const tier = computeRank(usd ?? 0, unlocked);
                const prog = progressToNextUsd(usd ?? 0);
                return (
                <div
                  key={a.id}
                  className="flex items-center gap-3 rounded-2xl p-4"
                  style={isActive ? { backgroundColor: '#5eccfa' } : { backgroundColor: '#ffffff' }}
                >
                  <button className="shrink-0" onClick={() => activate(a.id)} aria-label={`Switch to ${a.name}`}>
                    {/* If this account has set an NFT as its PFP, render
                        the NFT image with the USD progress ring around it
                        and a small rank icon underneath. Otherwise fall
                        through to the bare RankAvatar — backgroundColor
                        is the navy halo behind the rank artwork on
                        inactive rows (white card backing). */}
                    <PfpAvatar
                      accountId={a.id}
                      rank={tier.rank}
                      fraction={prog.fraction}
                      size={42}
                      withRankBelow
                      backgroundColor={isActive ? undefined : '#002849'}
                    />
                  </button>
                  <div className="flex-1 min-w-0">
                    <button className="w-full flex items-baseline justify-between gap-3" onClick={() => activate(a.id)}>
                      <span className={`font-bold truncate ${isActive ? 'text-white' : 'text-ink'}`} style={{ fontSize: 17 }}>
                        {a.name}
                      </span>
                      <span className={`font-bold shrink-0 ${isActive ? 'text-white' : 'text-ink'}`} style={{ fontSize: 17 }}>
                        {usdText}
                      </span>
                    </button>
                    <div className="flex items-center justify-between gap-2 mt-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`font-mono font-bold truncate ${isActive ? 'text-white' : 'text-ink'}`}
                          style={{ fontSize: 13 }}
                        >
                          {shortAddress(a.address)}
                        </span>
                        <AddressActions address={a.address} color={isActive ? '#ffffff' : '#2e2114'} size={16} />
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
                className="btn w-full font-bold text-white bg-[#5eccfa] hover:bg-[#3eb8e8]"
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
            <h3 className="font-bold mb-3 text-white" style={{ fontSize: 17 }}>
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
            {err && <div className="text-danger text-xs mt-2">{err}</div>}
            <div className="flex gap-2 mt-4">
              <button className="btn-ghost flex-1" onClick={() => setMode('list')}>Cancel</button>
              <button className="btn-primary flex-1" disabled={busy} onClick={add}>{busy ? 'Adding…' : 'Add'}</button>
            </div>
          </>
        )}

        {mode === 'reveal-pk' && (
          <>
            <h3 className="font-bold mb-3 text-white" style={{ fontSize: 17 }}>Reveal private key</h3>
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
                    className="btn flex-1 text-white font-bold bg-white/20 hover:bg-white/30"
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
                <div
                  className="card font-mono break-all select-all font-bold"
                  style={{ fontSize: 16 }}
                >
                  {revealedPk}
                </div>
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
            <h3 className="font-bold mb-1 text-white" style={{ fontSize: 17 }}>Reveal recovery phrase</h3>
            <p className="text-white/85 mb-3 font-bold" style={{ fontSize: 18 }}>
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
                      <div
                        key={i}
                        className="bg-bg-soft border border-line rounded-lg px-2 py-1.5 font-bold"
                        style={{ fontSize: 16 }}
                      >
                        <span className="text-ink-faint mr-1 font-bold">{i + 1}.</span>
                        <span className="font-mono font-bold">{w}</span>
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

/** Tiny inline pencil glyph next to the @username, for the edit affordance. */
function PencilIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M14.06 2.94l3 3a2 2 0 010 2.83l-9.06 9.06-4.83 1 1-4.83 9.06-9.06a2 2 0 012.83 0z"
        stroke="#ffffff"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}


/**
 * Big-slot avatar at the top of the Accounts page: NFT PFP at 110 px
 * with a smaller rank avatar floating just under it, or — when no PFP
 * is set — the bare rank icon at 110 px to match the historical look.
 */
function BigPfp({ accountId, rank, fraction }: { accountId: string; rank: number; fraction: number }) {
  const pfp = usePfp(accountId);
  if (!pfp?.image) {
    return (
      <img
        src={rankIconUrl(rank)}
        alt={`Rank ${rank}`}
        className="object-contain"
        style={{ width: 110, height: 110 }}
      />
    );
  }
  return (
    <div className="flex flex-col items-center">
      <img
        src={pfp.image}
        alt="Profile"
        className="rounded-full object-cover"
        style={{ width: 110, height: 110 }}
      />
      {/* Negative top margin floats the rank halfway over the PFP edge so
          it reads as an attached badge. The rank-below has NO progress
          ring — the ring belongs to the PFP image when one is set. */}
      <div style={{ marginTop: -16 }}>
        <RankAvatar
          rank={rank}
          fraction={fraction}
          size={48}
          backgroundColor="#002849"
          showRing={false}
        />
      </div>
    </div>
  );
}
