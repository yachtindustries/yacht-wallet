import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BottomNav, Page, Screen, TopBar } from '../components/Layout';
import { TokenLogo } from '../components/TokenLogo';
import { OnChainPfpAvatar } from '../components/OnChainPfpAvatar';
import { useApp } from '../store';
import { rpc } from '@/lib/messaging';
import type { DexPair } from '@/lib/dexscreener';
import { APE, isVerifiedAddress, safeChecksum, type TokenMeta } from '@/lib/tokens';
import type { TopNftRow } from '@/lib/topnfts';
import type { TopUser } from '@/lib/topusers';
import { VOTE_AMOUNTS } from '@/lib/voting';

interface ApeChainApp {
  name: string;
  url: string;
  imgUrl: string;
}

const APECHAIN_APPS: ApeChainApp[] = [
  // 2x2 grid: Otherside / OpenSea on top, DexScreener / Camelot below.
  { name: 'Otherside',   url: 'https://www.otherside.xyz',                       imgUrl: chrome.runtime.getURL('app-otherside.png') },
  { name: 'OpenSea',     url: 'https://opensea.io/collections?chains=ape_chain', imgUrl: chrome.runtime.getURL('app-opensea.png') },
  { name: 'DexScreener', url: 'https://dexscreener.com/apechain',                imgUrl: chrome.runtime.getURL('app-dexscreener.png') },
  { name: 'Camelot',     url: 'https://app.camelot.exchange',                    imgUrl: chrome.runtime.getURL('app-camelot.png') },
];

type TopTokenRow = DexPair & { apeVoted: number; voteCount: number };

const TOP_LIMIT_NFTS = 8;
const TOP_LIMIT_TOKENS = 7;

export default function SearchScreen() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<DexPair[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [topNfts, setTopNfts] = useState<TopNftRow[]>([]);
  const [topNftsLoading, setTopNftsLoading] = useState(true);
  const [topTokens, setTopTokens] = useState<TopTokenRow[]>([]);
  const [topTokensLoading, setTopTokensLoading] = useState(true);
  const [topUsers, setTopUsers] = useState<TopUser[]>([]);
  const [topUsersLoading, setTopUsersLoading] = useState(true);

  const [showAllNfts, setShowAllNfts] = useState(false);
  const [showAllTokens, setShowAllTokens] = useState(false);

  // Username search index — built from the recent chat backlog so
  // typing a username surfaces the matching profile.
  const [usernameIndex, setUsernameIndex] = useState<{ username: string; address: string }[]>([]);
  const [usernameMatches, setUsernameMatches] = useState<{ username: string; address: string }[]>([]);

  async function refreshTopNfts() {
    try {
      const list = await rpc({ type: 'nft.topcollections' });
      setTopNfts(list);
    } catch { /* leave previous list */ }
  }

  async function refreshTopTokens() {
    try {
      const list = await rpc({ type: 'tokens.top', limit: 30 });
      setTopTokens(list);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  useEffect(() => {
    setLoading(true);
    setTopNftsLoading(true);
    setTopTokensLoading(true);
    void refreshTopNfts().finally(() => setTopNftsLoading(false));
    void refreshTopTokens().finally(() => {
      setTopTokensLoading(false);
      setLoading(false);
    });
    setTopUsersLoading(true);
    void rpc({ type: 'users.top' })
      .then(setTopUsers)
      .catch(() => setTopUsers([]))
      .finally(() => setTopUsersLoading(false));
    // Username → address index from chat backlog.
    void rpc({ type: 'chat.list', limit: 200 })
      .then((msgs) => {
        const byUsername = new Map<string, { username: string; address: string }>();
        for (const m of msgs) {
          if (!m.username || !m.from) continue;
          const k = m.username.toLowerCase();
          if (!byUsername.has(k)) byUsername.set(k, { username: m.username, address: m.from });
        }
        setUsernameIndex([...byUsername.values()]);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSearchResults(null);
      setUsernameMatches([]);
      return;
    }
    const stripped = q.replace(/^@/, '').toLowerCase();
    const userHits = usernameIndex
      .filter((u) => u.username.toLowerCase().includes(stripped))
      .slice(0, 8);
    setUsernameMatches(userHits);
    setSearching(true);
    const t = window.setTimeout(async () => {
      try {
        const pair = await rpc({ type: 'dex.token', query: q });
        setSearchResults(pair ? [pair] : []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => window.clearTimeout(t);
  }, [query, usernameIndex]);

  // Slice top-7 vs full list per user toggle. Tokens additionally
  // bubble verified ApeChain tokens above the noise tier.
  const visibleNfts = useMemo(
    () => (showAllNfts ? topNfts : topNfts.slice(0, TOP_LIMIT_NFTS)),
    [topNfts, showAllNfts],
  );
  const visibleTokens = useMemo(() => {
    const sorted = [...topTokens].sort((a, b) => {
      // primary: votes desc
      if (b.apeVoted !== a.apeVoted) return b.apeVoted - a.apeVoted;
      // secondary: verified bubbles above noise
      const av = isVerifiedAddress(a.baseToken?.address) ? 1 : 0;
      const bv = isVerifiedAddress(b.baseToken?.address) ? 1 : 0;
      if (av !== bv) return bv - av;
      // tertiary: FDV / mcap
      return (b.fdv ?? b.marketCap ?? 0) - (a.fdv ?? a.marketCap ?? 0);
    });
    return showAllTokens ? sorted : sorted.slice(0, TOP_LIMIT_TOKENS);
  }, [topTokens, showAllTokens]);

  return (
    <Screen>
      <TopBar title="Discover" onBack={() => nav('/')} tone="deck" />
      <Page tone="deck">
        <input
          className="w-full bg-white border border-white rounded-xl px-3 py-2.5 text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-white mb-4"
          style={{ fontSize: 17 }}
          placeholder="Search tokens or @username"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        {searchResults && usernameMatches.length > 0 && (
          <div className="mb-4">
            <SectionHeader>People</SectionHeader>
            <div className="space-y-2">
              {usernameMatches.map((u) => (
                <Link
                  key={u.address}
                  to={`/profile/${u.address}`}
                  className="card flex items-center justify-between hover:border-brand"
                >
                  <div className="min-w-0">
                    <div className="font-bold truncate" style={{ fontSize: 16 }}>@{u.username}</div>
                    <div className="text-ink-faint font-mono truncate font-bold" style={{ fontSize: 12 }}>
                      {u.address.slice(0, 6)}…{u.address.slice(-4)}
                    </div>
                  </div>
                  <div className="text-[#5eccfa] font-bold" style={{ fontSize: 13 }}>View →</div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {searchResults ? (
          <>
            <SectionHeader>Search results</SectionHeader>
            {(loading || searching) && (
              <div className="text-white/85" style={{ fontSize: 17 }}>Loading…</div>
            )}
            <TokenList rows={searchResults.map((p) => ({ ...p, apeVoted: 0, voteCount: 0 }))} hoverable={false} onAfterVote={refreshTopTokens} />
          </>
        ) : (
          <>
            {/* ─── Top NFTs ─── */}
            <div className="mb-4">
              <SectionHeader>Top NFTs</SectionHeader>
              <TopNftList rows={visibleNfts} loading={topNftsLoading} onAfterVote={refreshTopNfts} />
              {topNfts.length > TOP_LIMIT_NFTS && (
                <SeeAllToggle
                  expanded={showAllNfts}
                  onToggle={() => setShowAllNfts((v) => !v)}
                  expandedLabel="Show fewer"
                  collapsedLabel="See All NFTs"
                />
              )}
            </div>

            {/* ─── Top Tokens ─── */}
            <div className="mb-4">
              <SectionHeader>Top Tokens</SectionHeader>
              {topTokensLoading && topTokens.length === 0 && (
                <div className="text-white/85 font-bold" style={{ fontSize: 14 }}>Loading…</div>
              )}
              {err && <div className="text-danger font-bold" style={{ fontSize: 14 }}>{err}</div>}
              <TokenList rows={visibleTokens} hoverable onAfterVote={refreshTopTokens} />
              {topTokens.length > TOP_LIMIT_TOKENS && (
                <SeeAllToggle
                  expanded={showAllTokens}
                  onToggle={() => setShowAllTokens((v) => !v)}
                  expandedLabel="Show fewer"
                  collapsedLabel="See All Tokens"
                />
              )}
            </div>

            {/* ─── Top Users ─── */}
            <div className="mb-4">
              <SectionHeader>Top Users</SectionHeader>
              {topUsersLoading && topUsers.length === 0 ? (
                <div className="text-white/85 font-bold py-2" style={{ fontSize: 14 }}>Loading top users…</div>
              ) : topUsers.length === 0 ? (
                <div className="text-white/85 font-bold py-2" style={{ fontSize: 14 }}>
                  No tipping or voting activity from chat users yet.
                </div>
              ) : (
                <TopUsersList rows={topUsers} />
              )}
            </div>

            {/* ─── ApeChain Apps ─── */}
            <div className="mb-2">
              <SectionHeader>ApeChain Apps</SectionHeader>
              <div className="grid grid-cols-2 gap-2">
                {APECHAIN_APPS.map((a) => (
                  <a
                    key={a.name}
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-2xl overflow-hidden hover:opacity-80 transition"
                    title={a.name}
                    aria-label={a.name}
                  >
                    <img src={a.imgUrl} alt={a.name} className="w-full h-auto block" />
                  </a>
                ))}
              </div>
            </div>
          </>
        )}
      </Page>
      <BottomNav />
    </Screen>
  );
}

// ─── Reusable section pieces ──────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="uppercase tracking-wider text-white/70 mb-2 px-1 font-bold" style={{ fontSize: 13 }}>
      {children}
    </h2>
  );
}

function SeeAllToggle({
  expanded, onToggle, expandedLabel, collapsedLabel,
}: { expanded: boolean; onToggle: () => void; expandedLabel: string; collapsedLabel: string }) {
  return (
    <div className="mt-2 text-center">
      <button
        onClick={onToggle}
        className="text-[#5eccfa] hover:underline font-bold"
        style={{ fontSize: 13 }}
      >
        {expanded ? expandedLabel : collapsedLabel}
      </button>
    </div>
  );
}

// ─── Top NFTs (hover-to-vote) ─────────────────────────────────────────────

function TopNftList({
  rows,
  loading,
  onAfterVote,
}: {
  rows: TopNftRow[];
  loading: boolean;
  onAfterVote: () => void;
}) {
  const { meta, unlocked } = useApp();
  const active = meta?.publicAccounts.find((a) => a.id === meta?.activeAccountId);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pendingFor, setPendingFor] = useState<string | null>(null);
  const [errFor, setErrFor] = useState<{ contract: string; message: string } | null>(null);
  const [optimisticApe, setOptimisticApe] = useState<Record<string, number>>({});
  const hideTimer = useRef<number | null>(null);

  function show(c: string) {
    if (hideTimer.current) { window.clearTimeout(hideTimer.current); hideTimer.current = null; }
    setHovered(c);
  }
  function scheduleHide() {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setHovered(null), 250);
  }

  async function vote(contract: string, amount: string) {
    if (!active || !unlocked) {
      setErrFor({ contract, message: 'Unlock the wallet first.' });
      return;
    }
    setPendingFor(contract);
    setErrFor(null);
    try {
      const r = await rpc({
        type: 'nft.vote',
        account: active.address,
        collection: contract,
        apeAmount: amount,
      });
      if (r.status !== 'success') throw new Error('Vote tx failed on-chain');
      const apeNum = parseFloat(amount);
      setOptimisticApe((p) => ({ ...p, [contract.toLowerCase()]: (p[contract.toLowerCase()] ?? 0) + apeNum }));
      setHovered(null);
      window.setTimeout(onAfterVote, 8000);
      window.setTimeout(onAfterVote, 20000);
    } catch (e) {
      setErrFor({ contract, message: (e as Error).message });
    } finally {
      setPendingFor(null);
    }
  }

  if (loading && rows.length === 0) {
    return <div className="text-white/85 font-bold py-2" style={{ fontSize: 14 }}>Loading top NFTs…</div>;
  }
  if (rows.length === 0) {
    return <div className="text-white/85 font-bold py-2" style={{ fontSize: 14 }}>No collections to show.</div>;
  }

  // 2-up vertical card grid. Each card showcases the collection
  // image as the primary visual; metadata (name, FP, MC) sits
  // underneath. Vote chip lives in the artwork's top-left corner so
  // it doesn't compete with the image for attention.
  return (
    <div className="grid grid-cols-2 gap-2">
      {rows.map((row) => {
        const lc = row.contract.toLowerCase();
        const liveApe = row.apeVoted + (optimisticApe[lc] ?? 0);
        const isHovered = hovered === lc;
        const isPending = pendingFor === lc;
        return (
          <div
            key={row.contract}
            className="relative"
            onMouseEnter={() => show(lc)}
            onMouseLeave={scheduleHide}
          >
            {(isHovered || isPending) && (
              <VotePopover
                onVote={(amt) => vote(row.contract, amt)}
                pending={isPending}
                onMouseEnter={() => show(lc)}
                onMouseLeave={scheduleHide}
              />
            )}
            <Link
              to={`/collection/${row.contract}`}
              className="card flex flex-col hover:border-brand"
              style={{ padding: 8 }}
            >
              <div className="relative rounded-xl overflow-hidden aspect-square bg-bg-soft border border-line mb-2 flex items-center justify-center">
                {row.imageUrl ? (
                  <img
                    src={row.imageUrl}
                    alt={row.name}
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : (
                  <span className="font-bold text-ink-faint" style={{ fontSize: 17 }}>
                    {row.name.slice(0, 3).toUpperCase()}
                  </span>
                )}
                {liveApe > 0 && (
                  <div
                    className="absolute font-bold rounded-md text-white"
                    style={{
                      top: 6,
                      left: 6,
                      fontSize: 13,
                      padding: '2px 6px',
                      backgroundColor: '#5eccfa',
                    }}
                  >
                    {trimNum(liveApe)} APE
                  </div>
                )}
              </div>
              <div className="font-bold truncate" style={{ fontSize: 17 }}>{row.name}</div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="font-bold" style={{ fontSize: 16 }}>
                  {row.floorApe != null ? formatFloorWhole(row.floorApe) : '—'}
                </span>
                <TokenLogo token={APE} size={17} />
              </div>
              <div className="text-ink-faint font-bold" style={{ fontSize: 13 }}>
                {row.mcapUsd != null ? `$${formatBig(row.mcapUsd)} MC` : 'MC —'}
              </div>
            </Link>
            {errFor?.contract.toLowerCase() === lc && (
              <div className="mt-1 px-3 py-1 rounded-lg bg-danger/20 text-danger font-bold" style={{ fontSize: 11 }}>
                {errFor.message}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Floor-price renderer for the new vertical NFT cards: whole
 * number, no decimals, no "APE" suffix (an APE token logo sits
 * beside it in the layout). Sub-1-APE floors round up to 1 so the
 * card never reads "0". */
function formatFloorWhole(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n < 1) return '< 1';
  return Math.round(n).toLocaleString();
}

// ─── Top Tokens ───────────────────────────────────────────────────────────

function TokenList({
  rows,
  hoverable,
  onAfterVote,
}: {
  rows: TopTokenRow[];
  hoverable: boolean;
  onAfterVote: () => void;
}) {
  const { meta, unlocked } = useApp();
  const active = meta?.publicAccounts.find((a) => a.id === meta?.activeAccountId);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pendingFor, setPendingFor] = useState<string | null>(null);
  const [errFor, setErrFor] = useState<{ contract: string; message: string } | null>(null);
  const [optimisticApe, setOptimisticApe] = useState<Record<string, number>>({});
  const hideTimer = useRef<number | null>(null);

  function show(c: string) {
    if (hideTimer.current) { window.clearTimeout(hideTimer.current); hideTimer.current = null; }
    setHovered(c);
  }
  function scheduleHide() {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setHovered(null), 250);
  }

  async function vote(contract: string, amount: string) {
    if (!active || !unlocked) {
      setErrFor({ contract, message: 'Unlock the wallet first.' });
      return;
    }
    setPendingFor(contract);
    setErrFor(null);
    try {
      const r = await rpc({
        type: 'nft.vote',                    // Reused — vote handler is contract-agnostic.
        account: active.address,
        collection: contract,
        apeAmount: amount,
      });
      if (r.status !== 'success') throw new Error('Vote tx failed on-chain');
      const apeNum = parseFloat(amount);
      setOptimisticApe((p) => ({ ...p, [contract.toLowerCase()]: (p[contract.toLowerCase()] ?? 0) + apeNum }));
      setHovered(null);
      window.setTimeout(onAfterVote, 8000);
      window.setTimeout(onAfterVote, 20000);
    } catch (e) {
      setErrFor({ contract, message: (e as Error).message });
    } finally {
      setPendingFor(null);
    }
  }

  return (
    <div className="space-y-2">
      {rows.map((p) => {
        const addr = p.baseToken?.address ?? '';
        const lc = addr.toLowerCase();
        const liveApe = p.apeVoted + (optimisticApe[lc] ?? 0);
        const isHovered = hovered === lc;
        const isPending = pendingFor === lc;
        const change = p.priceChange?.h24;
        const changeColor = change == null ? 'text-ink-dim' : change >= 0 ? 'text-success' : 'text-danger';
        return (
          <div
            key={p.pairAddress}
            className="relative"
            onMouseEnter={() => hoverable && show(lc)}
            onMouseLeave={() => hoverable && scheduleHide()}
          >
            {hoverable && (isHovered || isPending) && (
              <VotePopover
                onVote={(amt) => vote(addr, amt)}
                pending={isPending}
                onMouseEnter={() => show(lc)}
                onMouseLeave={scheduleHide}
              />
            )}
            <Link
              to={`/token/${encodeURIComponent(p.baseToken.address)}`}
              className="card flex items-center gap-3 hover:border-brand relative"
            >
              {/* Vote-count chip in the upper-left corner. Tucked into
                  the card's rounded edge so it reads as a badge, not a
                  separate row element. */}
              {hoverable && liveApe > 0 && (
                <div
                  className="absolute font-bold rounded-md text-white"
                  style={{
                    top: 6,
                    left: 6,
                    fontSize: 10,
                    padding: '2px 6px',
                    backgroundColor: '#5eccfa',
                  }}
                >
                  {trimNum(liveApe)} APE
                </div>
              )}
              <TokenLogo
                token={{
                  symbol: p.baseToken.symbol,
                  name: p.baseToken.name ?? p.baseToken.symbol,
                  address: safeChecksum(p.baseToken.address),
                  decimals: 18,
                  logo: p.info?.imageUrl,
                } as TokenMeta}
                size={44}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <div className="font-bold truncate" style={{ fontSize: 17 }}>{p.baseToken.symbol}</div>
                  <div className="font-bold" style={{ fontSize: 17 }}>
                    {p.priceUsd ? `$${formatPrice(parseFloat(p.priceUsd))}` : '—'}
                  </div>
                </div>
                <div className="flex items-center justify-between" style={{ fontSize: 13 }}>
                  <span className="text-ink-faint truncate">
                    {p.baseToken.name ?? p.baseToken.symbol} · MC ${formatBig(p.fdv ?? p.marketCap ?? 0)}
                  </span>
                  <span className={changeColor}>
                    {change == null ? '' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`}
                  </span>
                </div>
              </div>
            </Link>
            {errFor?.contract.toLowerCase() === lc && (
              <div className="mt-1 px-3 py-1 rounded-lg bg-danger/20 text-danger font-bold" style={{ fontSize: 11 }}>
                {errFor.message}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Top Users ────────────────────────────────────────────────────────────

function TopUsersList({ rows }: { rows: TopUser[] }) {
  return (
    <div className="space-y-2">
      {rows.map((u, i) => (
        <Link
          key={u.address}
          to={`/profile/${u.address}`}
          className="card flex items-center hover:border-brand"
          style={{ padding: '8px 12px', gap: 10 }}
        >
          <div className="font-bold text-white/55 shrink-0 text-center" style={{ fontSize: 12, width: 14 }}>
            #{i + 1}
          </div>
          <OnChainPfpAvatar
            address={u.address}
            rank={u.rank ?? 1}
            fraction={u.rankFraction ?? 0}
            size={40}
            showRing={false}
            backgroundColor="#002849"
          />
          <div className="min-w-0 flex-1">
            <div className="font-bold truncate" style={{ fontSize: 15 }}>
              {u.username ? `@${u.username}` : `${u.address.slice(0, 6)}…${u.address.slice(-4)}`}
            </div>
            <div className="text-ink-faint font-bold truncate" style={{ fontSize: 11 }}>
              {u.rank != null ? `Rank ${u.rank}` : '—'}
              {u.username && (
                <>
                  <span className="mx-1">·</span>
                  <span className="font-mono">{u.address.slice(0, 6)}…{u.address.slice(-4)}</span>
                </>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="font-bold text-[#5eccfa]" style={{ fontSize: 14 }}>
              {trimNum(u.totalApe)} APE
            </div>
            <div className="text-ink-faint font-bold uppercase tracking-wider" style={{ fontSize: 9 }}>
              sent
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

// ─── Vote popover ─────────────────────────────────────────────────────────

function VotePopover({
  onVote,
  pending,
  onMouseEnter,
  onMouseLeave,
}: {
  onVote: (amount: string) => void;
  pending: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  return (
    <div
      className="absolute bottom-full left-1/2 -translate-x-1/2 z-20"
      style={{ paddingBottom: 8 }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-2xl bg-bg-card border border-line shadow-lg whitespace-nowrap"
        style={{ fontSize: 14 }}
      >
        <div className="flex items-center gap-1 font-bold text-ink">
          <span>Vote</span>
          <TokenLogo token={APE} size={18} />
        </div>
        <div className="flex items-center gap-1">
          {VOTE_AMOUNTS.map((amt) => (
            <button
              key={amt}
              disabled={pending}
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); onVote(amt); }}
              className="px-2 py-0.5 rounded-lg bg-[#5eccfa] hover:bg-[#3eb8e8] disabled:opacity-60 text-white font-bold"
              style={{ fontSize: 13 }}
            >
              {pending ? '…' : amt}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function trimNum(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '0';
  if (n < 0.001) return n.toExponential(2);
  if (n < 1) return n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function formatPrice(n: number): string {
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  if (n >= 0.01) return n.toFixed(4);
  return n.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
}

function formatBig(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

// Re-export for any consumer who might still import these (kept for
// internal type stability across the discovery refactor).
export { type TokenMeta, safeChecksum };
