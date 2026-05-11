import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Screen, BottomNav } from '../components/Layout';
import { TokenLogo } from '../components/TokenLogo';
import { YachtBackground } from '../components/YachtBackground';
import { AddressActions } from '../components/AddressActions';
import { PfpAvatar, setAccountPfp } from '../components/PfpAvatar';
import { useApp } from '../store';
import { rpc } from '@/lib/messaging';
import type { AccountSummary, Erc20Balance, OwnedNft } from '@/lib/evm';
import { shortAddress } from '@/lib/wallet-utils';
import { APE, TokenMeta, isVerifiedAddress, safeChecksum } from '@/lib/tokens';

const verifiedIconUrl = chrome.runtime.getURL('verified.png');

const arrowIcon = chrome.runtime.getURL('public/actions/sendreceive.png');
const swapIcon = chrome.runtime.getURL('public/actions/swap.png');

const TRACKED_TOKENS_KEY = 'yacht.trackedTokens.v1';
// Cache balance + price per token so the Swap screen's TokenPicker can show
// them without hitting any APIs again.
const PICKER_STATS_KEY = 'yacht.pickerStats.v1';
// Persisted dashboard snapshot keyed by lowercase active address. We read
// this on mount and seed React state immediately, so navigating back to
// Home from another screen renders the LAST-known balances + prices
// straight away while the fresh fetch runs in the background. Without
// this hydration step the screen would briefly show $0 / empty token
// list / empty NFT grid every time.
const DASH_CACHE_KEY = 'yacht.dashCache.v1';

interface DashSnapshot {
  summary: AccountSummary | null;
  tokens: Erc20Balance[];
  apeUsd: number;
  apeChange: number | null;
  tokenStats: Record<string, TokenStats>;
  nfts: OwnedNft[];
  savedAt: number;
}

interface TokenStats {
  priceUsd: number;
  priceChange24h: number | null;
}

async function loadTrackedTokens(): Promise<string[]> {
  const r = await chrome.storage.local.get(TRACKED_TOKENS_KEY);
  const list: string[] = r[TRACKED_TOKENS_KEY] ?? [];
  return list;
}

export default function Dashboard() {
  const nav = useNavigate();
  const { meta, settings } = useApp();
  const active = meta?.publicAccounts.find((a) => a.id === meta?.activeAccountId) ?? meta?.publicAccounts[0];
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [tokens, setTokens] = useState<Erc20Balance[]>([]);
  const [apeUsd, setApeUsd] = useState<number>(0);
  const [apeChange, setApeChange] = useState<number | null>(null);
  const [tokenStats, setTokenStats] = useState<Record<string, TokenStats>>({});
  const [, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<'tokens' | 'nfts'>('tokens');
  const [nfts, setNfts] = useState<OwnedNft[]>([]);
  const [nftsLoading, setNftsLoading] = useState(false);
  const [nftsLoaded, setNftsLoaded] = useState(false);
  const [rank, setRank] = useState<{ rank: number; fraction: number }>({ rank: 1, fraction: 0 });

  // Hydrate state from the cached snapshot for the current active address
  // BEFORE the fresh fetch lands. So navigating back to Home doesn't
  // briefly flash $0 / empty token list — the previous values render
  // instantly and just update when the network call resolves.
  useEffect(() => {
    if (!active) return;
    const lc = active.address.toLowerCase();
    let cancelled = false;
    void chrome.storage.local.get(DASH_CACHE_KEY).then((r) => {
      if (cancelled) return;
      const map = (r[DASH_CACHE_KEY] as Record<string, DashSnapshot> | undefined) ?? {};
      const snap = map[lc];
      // Always set state — either to the cached snapshot OR to fresh
      // empties so we don't accidentally show the previous account's
      // values while the next account's fetch is in-flight.
      setSummary(snap?.summary ?? null);
      setTokens(snap?.tokens ?? []);
      setApeUsd(snap?.apeUsd ?? 0);
      setApeChange(snap?.apeChange ?? null);
      setTokenStats(snap?.tokenStats ?? {});
      setNfts(snap?.nfts ?? []);
      setNftsLoaded(snap?.nfts ? snap.nfts.length > 0 : false);
    });
    return () => { cancelled = true; };
  }, [active?.address]);

  // Pull (and locally cache) the rank for the active account so the home-
  // page avatar reflects the same icon + USD progress ring shown in the
  // Accounts menu. rank.get is itself cached for 5 minutes, so re-mounting
  // the dashboard is cheap.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await rpc({ type: 'rank.get', address: active.address });
        if (!cancelled) setRank({ rank: r.rank, fraction: r.fraction });
      } catch { /* leave default rank-1 */ }
    })();
    return () => { cancelled = true; };
  }, [active?.address]);

  const loadAll = useCallback(async () => {
    if (!active) return;
    setErr(null);
    try {
      const [s, history, p, apePair] = await Promise.all([
        rpc({ type: 'evm.account', address: active.address }),
        rpc({ type: 'evm.history', address: active.address }).catch(() => []),
        rpc({ type: 'price.get' }),
        rpc({ type: 'dex.token', query: 'apecoin' }).catch(() => null),
      ]);
      const tracked = await loadTrackedTokens();
      const lower = new Set(tracked.map((t) => t.toLowerCase()));
      let added = false;
      for (const h of history) {
        for (const tr of h.transfers) {
          if (tr.native || !tr.tokenAddress || tr.direction === 'out') continue;
          const a = tr.tokenAddress;
          if (!lower.has(a.toLowerCase())) {
            tracked.push(a);
            lower.add(a.toLowerCase());
            added = true;
          }
        }
      }
      if (added) await chrome.storage.local.set({ [TRACKED_TOKENS_KEY]: tracked });

      const balances = tracked.length
        ? await rpc({ type: 'evm.erc20.balances', tokens: tracked, address: active.address })
        : ([] as Erc20Balance[]);
      setSummary(s);
      setTokens(balances);
      setApeUsd(p.usd);
      setApeChange(apePair?.priceChange?.h24 ?? null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [active?.address]);

  const loadNfts = useCallback(async () => {
    if (!active) return;
    setNftsLoading(true);
    try {
      const list = await rpc({ type: 'evm.nfts', address: active.address });
      setNfts(list);
    } catch {
      setNfts([]);
    } finally {
      setNftsLoading(false);
      setNftsLoaded(true);
    }
  }, [active?.address]);

  useEffect(() => {
    if (!active) return;
    setLoading(true);
    loadAll().finally(() => setLoading(false));
    // NB: NFT state reset lives in the hydrate effect above so a fresh
    // address reads its own cached NFTs (or resets to empty when none),
    // without clobbering values the cache just hydrated.
  }, [active?.address, settings?.network, loadAll]);

  useEffect(() => {
    if (view === 'nfts' && !nftsLoaded && !nftsLoading) {
      void loadNfts();
    }
  }, [view, nftsLoaded, nftsLoading, loadNfts]);

  // Listen for cross-screen refresh signals — e.g. the Collection
  // View writes `yacht.dashRefreshSignal.v1` after a successful
  // NFT buy so the Home grid picks up the new item without the
  // user having to manually pull-to-refresh.
  useEffect(() => {
    function onChanged(changes: { [k: string]: chrome.storage.StorageChange }, area: string) {
      if (area !== 'local') return;
      if (!changes['yacht.dashRefreshSignal.v1']) return;
      setNftsLoaded(false);
      void loadNfts();
      void loadAll();
    }
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [loadNfts, loadAll]);

  // Fetch USD price + 24h change for each ERC-20 (lazy, per token)
  useEffect(() => {
    if (!tokens.length) return;
    for (const t of tokens) {
      const k = t.token.address.toLowerCase();
      if (tokenStats[k] !== undefined) continue;
      setTokenStats((p) => ({ ...p, [k]: p[k] ?? { priceUsd: 0, priceChange24h: null } }));
      void rpc({ type: 'dex.token', query: t.token.address })
        .then((pair) => {
          setTokenStats((p) => ({
            ...p,
            [k]: {
              priceUsd: pair?.priceUsd ? parseFloat(pair.priceUsd) : 0,
              priceChange24h: pair?.priceChange?.h24 ?? null,
            },
          }));
        })
        .catch(() => {
          setTokenStats((p) => ({ ...p, [k]: { priceUsd: 0, priceChange24h: null } }));
        });
    }
  }, [tokens]);

  async function refresh() {
    setRefreshing(true);
    setTokenStats({});
    await loadAll();
    if (view === 'nfts') {
      setNftsLoaded(false);
      await loadNfts();
    }
    setRefreshing(false);
  }

  const ape = parseFloat(summary?.nativeBalance ?? '0');
  const apeValue = ape * apeUsd;

  // Persist the latest balances + prices so the Swap-screen TokenPicker can
  // surface them without re-fetching. Keyed: NATIVE for APE, lowercase
  // contract address for ERC-20.
  useEffect(() => {
    const out: Record<string, { balance: string; priceUsd: number }> = {};
    out['NATIVE'] = { balance: String(ape || 0), priceUsd: apeUsd || 0 };
    for (const t of tokens) {
      const k = t.token.address.toLowerCase();
      const stat = tokenStats[k];
      out[k] = { balance: t.balance, priceUsd: stat?.priceUsd ?? 0 };
    }
    void chrome.storage.local.set({ [PICKER_STATS_KEY]: out });
  }, [tokens, tokenStats, ape, apeUsd]);

  // Persist the dashboard snapshot for the active address. The hydrate
  // effect above reads this back on next mount.
  useEffect(() => {
    if (!active) return;
    if (!summary) return; // wait until we have at least one fetched value
    const lc = active.address.toLowerCase();
    void chrome.storage.local.get(DASH_CACHE_KEY).then((r) => {
      const map = (r[DASH_CACHE_KEY] as Record<string, DashSnapshot> | undefined) ?? {};
      map[lc] = { summary, tokens, apeUsd, apeChange, tokenStats, nfts, savedAt: Date.now() };
      void chrome.storage.local.set({ [DASH_CACHE_KEY]: map });
    });
  }, [active?.address, summary, tokens, apeUsd, apeChange, tokenStats, nfts]);

  const totalUsd = useMemo(() => {
    let total = apeValue;
    for (const t of tokens) {
      const k = t.token.address.toLowerCase();
      const stat = tokenStats[k];
      if (!stat) continue;
      total += parseFloat(t.balance) * stat.priceUsd;
    }
    return total;
  }, [apeValue, tokens, tokenStats]);

  // Per-collection floor (APE) for every NFT contract this account
  // holds. Looked up via OpenSea collection-stats. Cached in
  // chrome.storage 1h on the lib side, so toggling tabs is cheap.
  const [nftFloors, setNftFloors] = useState<Record<string, number | null>>({});
  useEffect(() => {
    if (!nfts.length) return;
    const seen = new Set(Object.keys(nftFloors));
    const need = [...new Set(nfts.map((n) => n.contract.toLowerCase()))].filter((c) => !seen.has(c));
    if (need.length === 0) return;
    let cancelled = false;
    void Promise.all(
      need.map(async (c) => {
        try {
          const r = await rpc({ type: 'nft.collectionFloor', contract: c });
          return [c, r.floorApe] as const;
        } catch {
          return [c, null] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setNftFloors((prev) => {
        const next = { ...prev };
        for (const [c, f] of entries) next[c] = f;
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [nfts]);

  // NFT portfolio total: per-token floor (APE) × current APE/USD.
  // Tokens whose collection floor hasn't resolved yet contribute 0
  // until the OpenSea lookup lands; the total inches up as floors
  // arrive rather than blocking the whole view.
  const totalNftUsd = useMemo(() => {
    if (apeUsd <= 0) return 0;
    let totalApe = 0;
    for (const n of nfts) {
      const f = nftFloors[n.contract.toLowerCase()];
      if (typeof f === 'number') totalApe += f;
    }
    return totalApe * apeUsd;
  }, [nfts, nftFloors, apeUsd]);

  // The big USD number at the top swaps based on which tab the
  // user is on — token-portfolio when tokens, NFT-portfolio when
  // nfts. The address row + action buttons remain unchanged.
  const headlineUsd = view === 'nfts' ? totalNftUsd : totalUsd;

  // Only ever render tokens with a non-zero balance on the active account.
  // Tokens that another account in this wallet holds (but the active account
  // doesn't) are deliberately hidden — they'd otherwise appear under a
  // confusing "empty balance" disclosure, suggesting the user owned tokens
  // they don't. Beyond that filter, sort descending by USD value so the
  // largest holdings rise to the top. Native APE is rendered as its own
  // pinned row above this list, so we don't need to special-case it here.
  const nonZero = tokens
    .filter((t) => parseFloat(t.balance) !== 0)
    .map((t) => {
      const stat = tokenStats[t.token.address.toLowerCase()];
      const usd = (stat?.priceUsd ?? 0) * parseFloat(t.balance);
      return { t, usd };
    })
    .sort((a, b) => b.usd - a.usd)
    .map(({ t }) => t);

  if (!active) return null;

  return (
    <Screen>
      <div
        className="relative flex-1 overflow-y-auto"
        style={{ backgroundColor: '#002849' }}
      >
        <YachtBackground />

        <div className="relative z-10">
          {/* Top header — over the water. The water-blue YachtBackground
              sits absolutely behind this whole Screen so the safe-area
              inset on top is naturally painted blue (not navy). The
              extra 5vh sits below the status-bar inset so the avatar
              row clears the system clock comfortably. */}
          <div
            className="flex items-center justify-between px-4 pb-2"
            style={{ paddingTop: 'calc(var(--safe-top, 0px) + 12px + 3vh)' }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Link
                to="/accounts"
                aria-label="Accounts"
                className="hover:opacity-90 transition shrink-0"
                // The avatar is visually 47×47 (+ a small rank that floats
                // below it). Negative top/bottom margins shrink the
                // element's *layout* contribution back to the original
                // 36px so the row's height — and therefore the Send/Swap/
                // Receive grid and tokens box below — stay exactly where
                // they were before the avatar grew. The avatar overflows
                // visually into the surrounding pt-3/pb-2 padding, which
                // is empty space.
                style={{ marginTop: -12, marginBottom: -10 }}
              >
                <PfpAvatar
                  accountId={active.id}
                  rank={rank.rank}
                  fraction={rank.fraction}
                  size={61}
                  withRankBelow
                  rankBelowAbsolute
                  artworkScale={0.48}
                />
              </Link>
              <ClickToCopyAddress address={active.address} />
              <AddressActions address={active.address} color="#ffffff" size={23} />
            </div>
            <LayoutToggle />
          </div>

          <div className="px-4 pb-4">
            {/* Total balance — no card, pure white text */}
            <div className="text-center mb-4 mt-2">
              <div className="text-[59px] leading-tight font-bold text-white">
                ${headlineUsd.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}
              </div>
              {err && <div className="mt-2 text-xs text-danger">{err}</div>}
            </div>

            {/* Square action buttons */}
            {/* Action buttons sit fully on the water; 25% smaller than the row width. */}
            <div className="grid grid-cols-3 gap-2 mb-5 mx-auto" style={{ width: '75%' }}>
              <ActionBtn to="/send" icon={arrowIcon} label="Send" iconSize={22} action="send" />
              <ActionBtn to="/swap" icon={swapIcon} label="Swap" iconSize={28} action="swap" />
              <ActionBtn to="/receive" icon={arrowIcon} label="Receive" rotate={180} iconSize={22} action="receive" />
            </div>

            {/* Tokens / NFTs tab header. marginTop bumped to 13% to push
                the box down below the action grid. Label / count / refresh
                icon all sized for mobile reach. */}
            <div className="flex items-center gap-4 mb-3 pb-2" style={{ marginTop: '13%' }}>
              <button
                onClick={() => setView('tokens')}
                className={`text-[22px] font-bold transition ${view === 'tokens' ? 'text-white' : 'text-white/55 hover:text-white/80'}`}
              >
                Tokens <span className="text-[17px] font-bold opacity-80">{tokens.length + 1}</span>
              </button>
              <button
                onClick={() => setView('nfts')}
                className={`text-[22px] font-bold transition ${view === 'nfts' ? 'text-white' : 'text-white/55 hover:text-white/80'}`}
              >
                NFTs {nftsLoaded && <span className="text-[17px] font-bold opacity-80">{nfts.length}</span>}
              </button>
              <div className="ml-auto flex items-center gap-0">
                <button
                  onClick={refresh}
                  disabled={refreshing}
                  title="Refresh"
                  className={`w-11 h-14 -mr-1 rounded-lg flex items-center justify-center text-white hover:bg-white/15 ${refreshing ? 'animate-spin' : ''}`}
                >
                  <span className="leading-none font-bold" style={{ fontSize: 30 }}>↻</span>
                </button>
              </div>
            </div>

            {view === 'tokens' ? (
              <div className="space-y-2">
                <button
                  onClick={() => nav('/token/native')}
                  className="card token-row flex justify-between items-center w-full text-left"
                >
                  <div className="flex items-center gap-3">
                    <span className="token-logo">
                      <TokenLogo token={APE} size={47} />
                    </span>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold" style={{ fontSize: 19 }}>APE</span>
                        <img src={verifiedIconUrl} alt="Verified" className="inline-block" style={{ width: 16, height: 16 }} />
                      </div>
                      <PriceChangeLine priceUsd={apeUsd} change24h={apeChange} />
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold" style={{ fontSize: 19 }}>
                      ${apeValue.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}
                    </div>
                    <div className="text-ink-faint font-bold" style={{ fontSize: 16 }}>
                      {ape.toLocaleString(undefined, { maximumFractionDigits: 3 })}
                    </div>
                  </div>
                </button>

                {nonZero.map((t) => {
                  const tm: TokenMeta = {
                    symbol: t.token.symbol,
                    name: t.token.name,
                    address: safeChecksum(t.token.address),
                    decimals: t.token.decimals,
                  };
                  const k = t.token.address.toLowerCase();
                  const stat = tokenStats[k];
                  const bal = parseFloat(t.balance);
                  const value = (stat?.priceUsd ?? 0) * bal;
                  return (
                    <button
                      key={k}
                      onClick={() => nav(`/token/${encodeURIComponent(t.token.address)}`)}
                      className="card token-row flex justify-between items-center w-full text-left"
                    >
                      <div className="flex items-center gap-3">
                        <span className="token-logo">
                          <TokenLogo token={tm} size={47} />
                        </span>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold" style={{ fontSize: 19 }}>{t.token.symbol}</span>
                            {isVerifiedAddress(t.token.address) && (
                              <img src={verifiedIconUrl} alt="Verified" className="inline-block" style={{ width: 16, height: 16 }} />
                            )}
                          </div>
                          <PriceChangeLine
                            priceUsd={stat?.priceUsd ?? 0}
                            change24h={stat?.priceChange24h ?? null}
                            fallback={shortAddress(t.token.address)}
                          />
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold" style={{ fontSize: 19 }}>
                          {stat?.priceUsd != null && stat.priceUsd > 0
                            ? `$${value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`
                            : '—'}
                        </div>
                        <div className="text-ink-faint font-bold" style={{ fontSize: 16 }}>
                          {bal.toLocaleString(undefined, { maximumFractionDigits: 3 })}
                        </div>
                      </div>
                    </button>
                  );
                })}

              </div>
            ) : (
              <NftGrid
                nfts={nfts}
                loading={nftsLoading}
                loaded={nftsLoaded}
                accountId={active?.id}
                accountAddress={active?.address}
                floors={nftFloors}
              />
            )}
          </div>
        </div>
      </div>

      <BottomNav />
    </Screen>
  );
}

function ActionBtn({
  to,
  icon,
  label,
  rotate = 0,
  iconSize = 28,
  action,
}: {
  to: string;
  icon: string;
  label: string;
  rotate?: number;
  iconSize?: number;
  /** Which hover animation to play. action-send = arrow nudges up,
   * action-receive = arrow nudges down (rotated icon), action-swap =
   * jelly squash. CSS in index.css owns the keyframes. */
  action: 'send' | 'swap' | 'receive';
}) {
  return (
    <Link
      to={to}
      aria-label={label}
      className={`action-${action} aspect-square flex flex-col items-center justify-center rounded-2xl bg-[#3a87b8]/55 hover:bg-[#3a87b8]/75 transition relative`}
    >
      {/* Fixed-height icon row so all 3 labels align regardless of iconSize */}
      <div className="h-8 flex items-center justify-center" style={{ marginTop: '10%' }}>
        <span
          role="img"
          aria-hidden
          className="action-icon block"
          style={{
            width: iconSize,
            height: iconSize,
            backgroundColor: '#ffffff',
            WebkitMaskImage: `url(${icon})`,
            maskImage: `url(${icon})`,
            WebkitMaskRepeat: 'no-repeat',
            maskRepeat: 'no-repeat',
            WebkitMaskPosition: 'center',
            maskPosition: 'center',
            WebkitMaskSize: 'contain',
            maskSize: 'contain',
            transform: rotate ? `rotate(${rotate}deg)` : undefined,
          }}
        />
      </div>
      <span className="font-bold text-white mt-1" style={{ fontSize: 13 }}>{label}</span>
    </Link>
  );
}

function ClickToCopyAddress({ address }: { address: string }) {
  const [showCopy, setShowCopy] = useState(false);
  async function onClick() {
    try {
      await navigator.clipboard.writeText(address);
      setShowCopy(true);
      setTimeout(() => setShowCopy(false), 2000);
    } catch { /* clipboard denied */ }
  }
  return (
    <button
      onClick={onClick}
      className="font-bold text-white hover:text-white/80 transition truncate"
      // 30% bump from the desktop 15px so the address pill scales up with
      // the bigger avatar and copy icon on the dashboard header.
      style={{ fontSize: 19 }}
      title={showCopy ? 'Copied' : 'Copy address'}
    >
      {showCopy ? 'copied' : shortAddress(address, 5, 4)}
    </button>
  );
}

function LayoutToggle() {
  // No popup/side-panel concept on mobile — Capacitor renders fullscreen.
  if ((import.meta as any).env?.YACHT_PLATFORM === 'mobile') return null;
  const [mode, setMode] = useState<'popup' | 'sidepanel'>('popup');
  useEffect(() => {
    rpc({ type: 'layout.get' }).then((r) => setMode(r.mode)).catch(() => {});
  }, []);
  async function toggle() {
    const next = mode === 'popup' ? 'sidepanel' : 'popup';
    try {
      if (next === 'sidepanel') {
        // Open the side panel from THIS context first — Chrome requires
        // sidePanel.open to be called inside a user-gesture handler, and
        // forwarding via background drops the gesture in some Chrome
        // versions. Then we tell the background to persist + reconfigure.
        try {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          const tabId = tabs[0]?.id;
          if (tabId != null) {
            await chrome.sidePanel.open({ tabId });
          }
        } catch { /* fall through; background will configure on next click */ }
        await rpc({ type: 'layout.set', mode: 'sidepanel' });
        setMode('sidepanel');
        // Popup mode will close itself when focus moves to the side panel.
        window.close();
      } else {
        // Side panel → popup. The background opens the popup first while we
        // still have a user-gesture, then disables the side panel which
        // dismisses it via Chrome. Do NOT call window.close() here — when
        // running in the side-panel context, that closed the popup along
        // with the panel because of focus-shift behaviour.
        await rpc({ type: 'layout.set', mode: 'popup' });
        setMode('popup');
      }
    } catch { /* ignore */ }
  }
  return (
    <button
      onClick={toggle}
      aria-label={mode === 'popup' ? 'Open as side panel' : 'Switch back to popup'}
      title={mode === 'popup' ? 'Open as side panel' : 'Switch back to popup'}
      className="rounded-lg p-1 hover:bg-white/15 text-white"
    >
      {mode === 'popup' ? (
        // "Side panel" glyph: small box pinned to the right
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <line x1="15" y1="4" x2="15" y2="20" />
        </svg>
      ) : (
        // "Popup" glyph: small floating window
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="6" y="5" width="14" height="14" rx="2" />
          <polyline points="3 10 3 4 9 4" />
        </svg>
      )}
    </button>
  );
}

function PriceChangeLine({
  priceUsd,
  change24h,
  fallback,
}: {
  priceUsd: number;
  change24h: number | null;
  fallback?: string;
}) {
  if (priceUsd > 0) {
    const priceStr =
      priceUsd >= 1
        ? priceUsd.toLocaleString(undefined, { maximumFractionDigits: 4 })
        : priceUsd < 0.0001
        ? priceUsd.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')
        : priceUsd.toFixed(4);
    return (
      <div className="flex items-center gap-2 font-bold" style={{ fontSize: 16 }}>
        <span className="text-ink-faint">${priceStr}</span>
        {change24h != null && (
          <span className={change24h >= 0 ? 'text-success' : 'text-danger'}>
            {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%
          </span>
        )}
      </div>
    );
  }
  return <div className="text-ink-faint font-bold" style={{ fontSize: 16 }}>{fallback ?? '—'}</div>;
}

function NftGrid({
  nfts,
  loading,
  loaded,
  accountId,
  accountAddress,
  floors,
}: {
  nfts: OwnedNft[];
  loading: boolean;
  loaded: boolean;
  accountId: string | undefined;
  accountAddress: string | undefined;
  floors: Record<string, number | null>;
}) {
  if (loading) {
    return <div className="text-center text-white/85 text-sm py-6 font-bold">Loading NFTs…</div>;
  }
  if (loaded && nfts.length === 0) {
    return <div className="text-center text-white/85 text-sm py-6 font-bold">No NFTs found on ApeChain.</div>;
  }
  return (
    <div className="grid grid-cols-3 gap-2">
      {nfts.map((n) => (
        <NftCell
          key={`${n.contract}:${n.tokenId}`}
          n={n}
          accountId={accountId}
          accountAddress={accountAddress}
          floorApe={floors[n.contract.toLowerCase()] ?? null}
        />
      ))}
    </div>
  );
}

/**
 * One NFT in the grid. Hover state spawns a "Set PFP" popover above the
 * cell with the same gap-bridge pattern as the chat tip popover, so the
 * cursor can move from the NFT to the button without dismissing the
 * popover. Click → save the NFT image as the active account's PFP.
 *
 * The cell itself is a regular `<a>` to OpenSea; click on the button
 * stops propagation so the OpenSea link doesn't ALSO open in a new tab.
 */
function NftCell({
  n,
  accountId,
  accountAddress,
  floorApe,
}: {
  n: OwnedNft;
  accountId: string | undefined;
  accountAddress: string | undefined;
  floorApe: number | null;
}) {
  const [hover, setHover] = useState(false);
  const hideTimer = useRef<number | null>(null);
  const nav = useNavigate();
  // Per-NFT detail (rarity rank) — fetched lazily on first hover
  // so we don't pummel OpenSea for every NFT on initial render.
  const [detail, setDetail] = useState<{ rarityRank: number | null } | null>(null);
  useEffect(() => {
    if (!hover) return;
    if (detail) return;
    let cancelled = false;
    void rpc({ type: 'nft.detail', contract: n.contract, tokenId: n.tokenId })
      .then((d) => { if (!cancelled) setDetail({ rarityRank: d.rarityRank }); })
      .catch(() => { if (!cancelled) setDetail({ rarityRank: null }); });
    return () => { cancelled = true; };
  }, [hover, detail, n.contract, n.tokenId]);
  function show() {
    if (hideTimer.current) { window.clearTimeout(hideTimer.current); hideTimer.current = null; }
    setHover(true);
  }
  function scheduleHide() {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setHover(false), 250);
  }

  async function applyPfp(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!accountId || !n.image) return;
    await setAccountPfp(
      accountId,
      { contract: n.contract, tokenId: n.tokenId, image: n.image },
      accountAddress,
    );
    setHover(false);
  }

  function goSend(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setHover(false);
    // Pass the NFT identity through the URL so the Send-NFT screen can
    // render the artwork preview without re-fetching it.
    const params = new URLSearchParams({
      contract: n.contract,
      tokenId: n.tokenId,
    });
    if (n.image) params.set('image', n.image);
    if (n.name) params.set('name', n.name);
    if (n.contractName) params.set('collection', n.contractName);
    nav(`/send-nft?${params.toString()}`);
  }

  return (
    <div className="relative" onMouseEnter={show} onMouseLeave={scheduleHide}>
      {hover && n.image && accountId && (
        <div
          // Bottom padding (not margin) acts as a hover-bridge: the cursor
          // can transit through it from the cell to the button without
          // ever leaving an element bound to the hover handlers.
          className="absolute bottom-full left-1/2 -translate-x-1/2 z-20 flex items-center gap-2"
          style={{ paddingBottom: 6 }}
          onMouseEnter={show}
          onMouseLeave={scheduleHide}
        >
          <button
            onClick={applyPfp}
            className="px-3 py-1 rounded-lg font-bold text-white whitespace-nowrap shadow-lg"
            style={{ fontSize: 13, backgroundColor: '#5eccfa' }}
          >
            Set PFP
          </button>
          <button
            onClick={goSend}
            className="px-3 py-1 rounded-lg font-bold text-white whitespace-nowrap shadow-lg"
            style={{ fontSize: 13, backgroundColor: '#5eccfa' }}
          >
            Send
          </button>
        </div>
      )}
      <a
        href={`https://opensea.io/assets/ape_chain/${n.contract}/${n.tokenId}`}
        target="_blank"
        rel="noreferrer"
        className="aspect-square rounded-xl bg-bg-card border border-line overflow-hidden flex items-center justify-center hover:border-brand transition w-full h-full block"
        title={n.name ?? `${n.contractName ?? n.contractSymbol ?? 'NFT'} #${n.tokenId}`}
      >
        {n.image ? (
          <img
            src={n.image}
            alt={n.name ?? n.tokenId}
            className="w-full h-full object-cover"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <div className="text-center px-1">
            <div className="text-[11px] font-bold text-ink truncate">{n.contractSymbol ?? n.contractName ?? 'NFT'}</div>
            <div className="text-[10px] text-ink-faint font-bold">#{n.tokenId.length > 6 ? `${n.tokenId.slice(0, 6)}…` : n.tokenId}</div>
          </div>
        )}
      </a>
      {/* Hover detail: name + floor + rarity, rendered BELOW the
          cell so it doesn't fight with the Set PFP / Send buttons
          that float above on the same hover. */}
      {hover && (
        <div
          className="absolute top-full left-1/2 -translate-x-1/2 z-20 pointer-events-none"
          style={{ paddingTop: 6 }}
        >
          <div
            className="rounded-lg shadow-lg whitespace-nowrap text-ink"
            style={{
              fontSize: 11,
              padding: '6px 10px',
              backgroundColor: '#ffffff',
              border: '1px solid rgba(0,0,0,0.08)',
            }}
          >
            <div className="font-bold truncate" style={{ maxWidth: 180 }}>
              {n.name ?? `${n.contractSymbol ?? n.contractName ?? 'NFT'} #${n.tokenId.length > 6 ? `${n.tokenId.slice(0, 4)}…` : n.tokenId}`}
            </div>
            <div className="text-ink-faint font-bold">
              FP {floorApe != null ? `${trimFloor(floorApe)} APE` : '—'}
            </div>
            <div className="text-ink-faint font-bold">
              Rarity {detail?.rarityRank != null ? `#${detail.rarityRank}` : '—'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function trimFloor(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n < 0.001) return n.toExponential(2);
  if (n < 1) return n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}
