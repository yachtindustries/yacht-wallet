import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { Page, Screen, TopBar } from '../components/Layout';
import { TokenLogo } from '../components/TokenLogo';
import { AddressActions } from '../components/AddressActions';
import { rpc } from '@/lib/messaging';
import type { DexPair } from '@/lib/dexscreener';
import type { Erc20Balance, AccountSummary } from '@/lib/evm';
import type { TradeEntry } from '@/lib/trades';
import { APE, TokenMeta, isNative, safeChecksum } from '@/lib/tokens';
import { shortAddress } from '@/lib/wallet-utils';
import { useApp } from '../store';

const TRACKED_TOKENS_KEY = 'yacht.trackedTokens.v1';

const arrowIcon = chrome.runtime.getURL('public/actions/sendreceive.png');
const swapIcon = chrome.runtime.getURL('public/actions/swap.png');
const dexLogoUrl = chrome.runtime.getURL('dexscreener-logo.png');

type TimeKey = '1H' | '6H' | '24H';
const TIME_BUTTONS: TimeKey[] = ['1H', '6H', '24H'];

export default function TokenDetail() {
  const params = useParams<{ address: string }>();
  const nav = useNavigate();
  const { meta } = useApp();
  const active = meta?.publicAccounts.find((a) => a.id === meta?.activeAccountId);
  const raw = decodeURIComponent(params.address ?? '');
  const native = raw === 'native' || raw.toLowerCase() === '0x0000000000000000000000000000000000000000';
  const address = native ? '' : safeChecksum(raw);

  const [pair, setPair] = useState<DexPair | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeframe, setTimeframe] = useState<TimeKey>('24H');
  const [balance, setBalance] = useState<number>(0);
  const [trades, setTrades] = useState<TradeEntry[]>([]);
  const [tradesLoading, setTradesLoading] = useState(false);
  const [tradesErr, setTradesErr] = useState<string | null>(null);

  const token: TokenMeta = native
    ? APE
    : { symbol: pair?.baseToken.symbol ?? 'TOKEN', name: pair?.baseToken.name ?? 'Token', address, decimals: 18, logo: pair?.info?.imageUrl };

  useEffect(() => {
    setLoading(true);
    const q = native ? 'apecoin' : address;
    rpc({ type: 'dex.token', query: q })
      .then(setPair)
      .catch(() => setPair(null))
      .finally(() => setLoading(false));
  }, [address, native]);

  // Recent trades — pulled once the pair address is known. Each
  // page load is 4 RPC calls (token0 + getBlockNumber +
  // getBlock(latest) + getLogs); subsequent re-mounts re-fetch
  // because trades change rapidly.
  useEffect(() => {
    const pairAddr = pair?.pairAddress;
    const baseAddr = pair?.baseToken?.address;
    if (!pairAddr || !baseAddr) return;
    setTradesLoading(true);
    setTradesErr(null);
    void rpc({
      type: 'dex.recentTrades',
      pairAddress: pairAddr,
      baseTokenAddress: baseAddr,
      baseDecimals: 18,
      quoteDecimals: 18,
      limit: 25,
    })
      .then((list) => { setTrades(list); setTradesErr(null); })
      .catch((e) => { setTrades([]); setTradesErr((e as Error).message); })
      .finally(() => setTradesLoading(false));
  }, [pair?.pairAddress, pair?.baseToken?.address]);

  // Pull this token's balance for the user — reused in the info card and
  // also in the action buttons' navigation state.
  useEffect(() => {
    if (!active) return;
    void (async () => {
      if (native) {
        const s: AccountSummary = await rpc({ type: 'evm.account', address: active.address });
        setBalance(parseFloat(s.nativeBalance));
        return;
      }
      const r = await chrome.storage.local.get(TRACKED_TOKENS_KEY);
      const list: string[] = r[TRACKED_TOKENS_KEY] ?? [];
      const tracked = list.includes(address) ? list : [...list, address];
      const balances: Erc20Balance[] = await rpc({
        type: 'evm.erc20.balances',
        tokens: tracked,
        address: active.address,
      });
      const mine = balances.find((b) => b.token.address.toLowerCase() === address.toLowerCase());
      setBalance(mine ? parseFloat(mine.balance) : 0);
    })().catch(() => setBalance(0));
  }, [active?.address, address, native]);

  const priceUsd = pair?.priceUsd ? parseFloat(pair.priceUsd) : null;
  const change1 = pair?.priceChange?.h1 ?? null;
  const change6 = pair?.priceChange?.h6 ?? null;
  const change24 = pair?.priceChange?.h24 ?? null;
  const vol24 = pair?.volume?.h24 ?? null;
  const mcap = pair?.marketCap ?? pair?.fdv ?? null;
  const liquidity = pair?.liquidity?.usd ?? null;
  const dsUrl = pair?.url ?? (pair?.pairAddress ? `https://dexscreener.com/apechain/${pair.pairAddress}` : null);

  const activeChange =
    timeframe === '1H' ? change1 :
    timeframe === '6H' ? change6 :
    change24;

  return (
    <Screen>
      {/* Top bar with no title (deck-tone, just back arrow + spacer) */}
      <TopBar title="" tone="deck" />
      <Page tone="deck" className="!p-0">
        <div className="flex flex-col items-center px-4 pt-2 pb-3">
          <TokenLogo token={token} size={56} />
          <div className="font-bold text-white mt-2" style={{ fontSize: 18 }}>
            {pair?.baseToken?.name ?? token.symbol}
          </div>
          {priceUsd != null && (
            <div className="mt-1 flex items-center gap-2">
              <div className="font-bold text-white" style={{ fontSize: 26 }}>
                ${priceUsd >= 1
                  ? priceUsd.toLocaleString(undefined, { maximumFractionDigits: 4 })
                  : priceUsd.toFixed(priceUsd < 0.0001 ? 8 : 4).replace(/0+$/, '').replace(/\.$/, '')}
              </div>
              {activeChange != null && (
                <span className={`font-bold ${activeChange >= 0 ? 'text-success' : 'text-danger'}`} style={{ fontSize: 14 }}>
                  {activeChange >= 0 ? '+' : ''}{activeChange.toFixed(2)}%
                </span>
              )}
            </div>
          )}
          {loading && <div className="text-white/80 text-sm mt-2">Loading…</div>}
          {!loading && !pair && <div className="text-white/80 text-sm mt-2">No market data on DexScreener.</div>}
        </div>

        {/* Sparkline — flush against the screen edges, no card box */}
        <Sparkline change={activeChange} basePrice={priceUsd ?? 0} timeframe={timeframe} />

        {/* Timeframe selector — white default, water-blue when selected */}
        <div className="flex gap-2 justify-center mt-2 mb-3 px-4">
          {TIME_BUTTONS.map((t) => {
            const active = t === timeframe;
            return (
              <button
                key={t}
                onClick={() => setTimeframe(t)}
                className={`px-4 py-1 rounded-lg font-bold transition ${
                  active ? 'bg-[#5eccfa] text-white' : 'bg-white text-ink hover:bg-white/85'
                }`}
                style={{ fontSize: 13 }}
              >
                {t}
              </button>
            );
          })}
        </div>

        {/* Send / Swap / Receive — white back, black icons + black text */}
        <div className="grid grid-cols-3 gap-2 mb-4 mx-auto px-4" style={{ width: '85%' }}>
          <ActionBtn
            onClick={() => nav('/send', { state: { token: serializeToken(token) } })}
            icon={arrowIcon}
            label="Send"
            iconSize={22}
          />
          <ActionBtn
            onClick={() =>
              // Swap from APE → this token (skip if user is already on the
              // APE detail page; just go straight to /swap).
              nav('/swap', isNative(token) ? undefined : { state: { tokenIn: serializeToken(APE), tokenOut: serializeToken(token) } })
            }
            icon={swapIcon}
            label="Swap"
            iconSize={28}
          />
          <ActionBtn to="/receive" icon={arrowIcon} label="Receive" rotate={180} iconSize={22} />
        </div>

        <div className="px-4 pb-4">
          {/* Token info card — same shape as Dashboard rows but not clickable
              and without the price/price-change line. */}
          <div className="card mb-3 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <TokenLogo token={token} size={41} />
              <div className="font-bold" style={{ fontSize: 16 }}>{token.symbol}</div>
            </div>
            <div className="text-right">
              <div className="font-bold" style={{ fontSize: 16 }}>
                ${(balance * (priceUsd ?? 0)).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}
              </div>
              <div className="text-ink-faint font-bold" style={{ fontSize: 13 }}>
                {balance.toLocaleString(undefined, { maximumFractionDigits: 3 })}
              </div>
            </div>
          </div>

          {/* Stats grid — bigger + bold, no 1h/6h change */}
          <div className="card mb-3 grid grid-cols-2 gap-3">
            <Stat label="24h volume"   value={vol24 != null ? `$${formatBig(vol24)}` : '—'} />
            <Stat label="Liquidity"    value={liquidity != null ? `$${formatBig(liquidity)}` : '—'} />
            <Stat label="Market cap"   value={mcap != null ? `$${formatBig(mcap)}` : '—'} />
            <Stat
              label="24h change"
              value={change24 != null ? `${change24 >= 0 ? '+' : ''}${change24.toFixed(2)}%` : '—'}
              tone={change24 == null ? undefined : change24 >= 0 ? 'ok' : 'bad'}
            />
          </div>

          {/* Recent trades — last ~25 Camelot V2 swaps for the pair.
              Trader column links to apescan. */}
          <div className="card mb-3">
            <div className="font-bold mb-2" style={{ fontSize: 15 }}>Recent trades</div>
            {tradesLoading && trades.length === 0 ? (
              <div className="text-ink-faint font-bold text-center py-2" style={{ fontSize: 12 }}>
                Loading trades…
              </div>
            ) : tradesErr ? (
              <div className="text-danger font-bold text-center py-2" style={{ fontSize: 11 }}>
                {tradesErr}
              </div>
            ) : trades.length === 0 ? (
              <div className="text-ink-faint font-bold text-center py-2" style={{ fontSize: 12 }}>
                No recent trades.
              </div>
            ) : (
              <div className="space-y-1">
                {trades.map((t) => {
                  const usd = priceUsd != null ? t.baseAmount * priceUsd : null;
                  return (
                    <a
                      key={t.txHash}
                      href={`https://apescan.io/tx/${t.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between hover:bg-bg-soft rounded px-1.5 py-1"
                    >
                      <span
                        className={`font-bold uppercase tracking-wider ${t.type === 'buy' ? 'text-success' : 'text-danger'}`}
                        style={{ fontSize: 11, width: 36 }}
                      >
                        {t.type}
                      </span>
                      <span className="font-bold flex-1 text-right" style={{ fontSize: 12 }}>
                        {trimNum(t.baseAmount)} {token.symbol}
                      </span>
                      <span className="font-bold text-ink-faint text-right" style={{ fontSize: 12, width: 80 }}>
                        {usd != null ? `$${formatBig(usd)}` : `${trimNum(t.quoteAmount)} APE`}
                      </span>
                      <span className="font-bold text-ink-faint text-right" style={{ fontSize: 11, width: 56 }}>
                        {formatRelTime(t.timestamp)}
                      </span>
                    </a>
                  );
                })}
              </div>
            )}
          </div>

          {/* Contract row: short address + copy + apescan icons */}
          {!native && (
            <div className="card mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-bold text-ink-dim mb-0.5" style={{ fontSize: 14 }}>Contract</div>
                <div className="font-mono font-bold" style={{ fontSize: 16 }}>{shortAddress(address, 5, 5)}</div>
              </div>
              <AddressActions address={address} color="#2e2114" size={20} />
            </div>
          )}

          {/* DexScreener external — black logo on white pill, sized 40% smaller. */}
          {dsUrl && (
            <a
              href={dsUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="View on DexScreener"
              className="flex items-center justify-center w-full rounded-xl bg-white hover:bg-white/85"
              style={{ height: 60 }}
            >
              <span
                role="img"
                aria-hidden
                className="block"
                style={{
                  height: 36,           // ~40% smaller than the original 60px button height
                  width: '60%',         // mask scales to fit
                  backgroundColor: '#000000',
                  WebkitMaskImage: `url(${dexLogoUrl})`,
                  maskImage: `url(${dexLogoUrl})`,
                  WebkitMaskRepeat: 'no-repeat',
                  maskRepeat: 'no-repeat',
                  WebkitMaskPosition: 'center',
                  maskPosition: 'center',
                  WebkitMaskSize: 'contain',
                  maskSize: 'contain',
                }}
              />
            </a>
          )}
        </div>
      </Page>
    </Screen>
  );
}

/**
 * Synthesized SVG line chart that spans the full screen width and supports
 * hover-to-show price + timestamp.
 */
function Sparkline({ change, basePrice, timeframe }: { change: number | null; basePrice: number; timeframe: TimeKey }) {
  const ref = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<{ x: number; price: number; ts: number } | null>(null);

  // Number of points and total time window in ms based on timeframe.
  const N = 64;
  const windowMs = timeframe === '1H' ? 60 * 60 * 1000 : timeframe === '6H' ? 6 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const now = Date.now();

  const points = useMemo(() => {
    const c = change ?? 0;
    const startPrice = basePrice / (1 + c / 100);
    const endPrice = basePrice;
    const arr: { t: number; price: number }[] = [];
    let seed = Math.floor((c + 100) * 1000);
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let i = 0; i < N; i++) {
      const tFrac = i / (N - 1);
      const base = startPrice + (endPrice - startPrice) * tFrac;
      const noise = (rand() - 0.5) * Math.abs(endPrice - startPrice) * 0.18;
      arr.push({ t: now - windowMs + tFrac * windowMs, price: base + noise });
    }
    return arr;
  }, [change, basePrice, timeframe]);

  const HEIGHT = 130;
  const VIEW_W = 1000; // virtual viewBox width — preserveAspectRatio="none" stretches to full screen

  const prices = points.map((p) => p.price);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const range = Math.max(1e-12, maxP - minP);

  const path = points
    .map((p, i) => {
      const x = (i / (N - 1)) * VIEW_W;
      const y = HEIGHT - ((p.price - minP) / range) * (HEIGHT - 16) - 8;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  const isUp = (change ?? 0) >= 0;
  const stroke = isUp ? '#16a34a' : '#dc2626';
  const fill = isUp ? '#16a34a33' : '#dc262633';
  const areaPath = `${path} L ${VIEW_W} ${HEIGHT} L 0 ${HEIGHT} Z`;

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = ref.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const xPx = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, xPx / rect.width));
    const idx = Math.round(ratio * (N - 1));
    const p = points[idx];
    setHover({ x: ratio, price: p.price, ts: p.t });
  }

  return (
    <div className="relative w-full" style={{ height: HEIGHT + 26 }}>
      <svg
        ref={ref}
        viewBox={`0 0 ${VIEW_W} ${HEIGHT}`}
        width="100%"
        height={HEIGHT}
        preserveAspectRatio="none"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        style={{ display: 'block' }}
      >
        <path d={areaPath} fill={fill} stroke="none" />
        <path d={path} stroke={stroke} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {hover && (
          <line
            x1={hover.x * VIEW_W}
            y1={0}
            x2={hover.x * VIEW_W}
            y2={HEIGHT}
            stroke="#ffffffaa"
            strokeWidth={1}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {hover && (
        <>
          <div
            className="absolute font-bold text-white px-2 py-0.5 rounded"
            style={{
              top: 2,
              left: `calc(${(hover.x * 100).toFixed(1)}% + 6px)`,
              transform: hover.x > 0.7 ? 'translateX(-110%)' : undefined,
              fontSize: 13,
              backgroundColor: '#1c130a99',
            }}
          >
            ${formatPrice(hover.price)}
          </div>
          <div
            className="absolute text-white text-center font-bold"
            style={{ bottom: 2, left: 0, right: 0, fontSize: 14 }}
          >
            {new Date(hover.ts).toLocaleString()}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'bad' }) {
  const color = tone === 'ok' ? 'text-success' : tone === 'bad' ? 'text-danger' : 'text-ink';
  return (
    <div>
      <div className="font-bold text-ink-dim" style={{ fontSize: 13 }}>{label}</div>
      <div className={`font-bold ${color}`} style={{ fontSize: 16 }}>{value}</div>
    </div>
  );
}

function formatPrice(n: number): string {
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  if (n >= 0.01) return n.toFixed(4);
  return n.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
}

function trimNum(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '0';
  if (n < 0.001) return n.toExponential(2);
  if (n < 1) return n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  if (n < 1000) return n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return formatBig(n);
}

function formatRelTime(unixSec: number): string {
  if (!Number.isFinite(unixSec) || unixSec <= 0) return '';
  const diff = Math.floor(Date.now() / 1000) - unixSec;
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86_400)}d`;
}

function formatBig(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

// Action button — white background, black icon, black label.
// Accepts either a route (`to`) or an `onClick` handler so the parent can
// preselect a token via navigation state without the Link API.
function ActionBtn({
  to,
  onClick,
  icon,
  label,
  rotate = 0,
  iconSize = 28,
}: {
  to?: string;
  onClick?: () => void;
  icon: string;
  label: string;
  rotate?: number;
  iconSize?: number;
}) {
  const inner = (
    <>
      <div className="h-8 flex items-center justify-center" style={{ marginTop: '10%' }}>
        <span
          role="img"
          aria-hidden
          className="block"
          style={{
            width: iconSize,
            height: iconSize,
            backgroundColor: '#000000',
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
      <span className="font-bold text-black mt-1" style={{ fontSize: 13 }}>{label}</span>
    </>
  );
  const className =
    'aspect-square flex flex-col items-center justify-center rounded-2xl bg-white hover:bg-white/85 transition relative';
  if (onClick) {
    return (
      <button onClick={onClick} aria-label={label} className={className}>
        {inner}
      </button>
    );
  }
  return (
    <Link to={to ?? '#'} aria-label={label} className={className}>
      {inner}
    </Link>
  );
}

/** JSON-safe slim TokenMeta passed via react-router state. */
function serializeToken(t: TokenMeta) {
  return {
    symbol: t.symbol,
    name: t.name,
    address: t.address,
    decimals: t.decimals,
    isNative: t.isNative,
    logo: t.logo,
  };
}
