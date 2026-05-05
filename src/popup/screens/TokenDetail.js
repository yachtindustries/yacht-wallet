import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { Page, Screen, TopBar } from '../components/Layout';
import { TokenLogo } from '../components/TokenLogo';
import { AddressActions } from '../components/AddressActions';
import { rpc } from '@/lib/messaging';
import { APE, isNative, safeChecksum } from '@/lib/tokens';
import { shortAddress } from '@/lib/wallet-utils';
import { useApp } from '../store';
const TRACKED_TOKENS_KEY = 'yacht.trackedTokens.v1';
const arrowIcon = chrome.runtime.getURL('public/actions/sendreceive.png');
const swapIcon = chrome.runtime.getURL('public/actions/swap.png');
const dexLogoUrl = chrome.runtime.getURL('dexscreener-logo.png');
const TIME_BUTTONS = ['1H', '6H', '24H'];
export default function TokenDetail() {
    const params = useParams();
    const nav = useNavigate();
    const { meta } = useApp();
    const active = meta?.publicAccounts.find((a) => a.id === meta?.activeAccountId);
    const raw = decodeURIComponent(params.address ?? '');
    const native = raw === 'native' || raw.toLowerCase() === '0x0000000000000000000000000000000000000000';
    const address = native ? '' : safeChecksum(raw);
    const [pair, setPair] = useState(null);
    const [loading, setLoading] = useState(true);
    const [timeframe, setTimeframe] = useState('24H');
    const [balance, setBalance] = useState(0);
    const token = native
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
    // Pull this token's balance for the user — reused in the info card and
    // also in the action buttons' navigation state.
    useEffect(() => {
        if (!active)
            return;
        void (async () => {
            if (native) {
                const s = await rpc({ type: 'evm.account', address: active.address });
                setBalance(parseFloat(s.nativeBalance));
                return;
            }
            const r = await chrome.storage.local.get(TRACKED_TOKENS_KEY);
            const list = r[TRACKED_TOKENS_KEY] ?? [];
            const tracked = list.includes(address) ? list : [...list, address];
            const balances = await rpc({
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
    const activeChange = timeframe === '1H' ? change1 :
        timeframe === '6H' ? change6 :
            change24;
    return (_jsxs(Screen, { children: [_jsx(TopBar, { title: "", tone: "deck" }), _jsxs(Page, { tone: "deck", className: "!p-0", children: [_jsxs("div", { className: "flex flex-col items-center px-4 pt-2 pb-3", children: [_jsx(TokenLogo, { token: token, size: 56 }), _jsx("div", { className: "font-bold text-white mt-2", style: { fontSize: 18 }, children: pair?.baseToken?.name ?? token.symbol }), priceUsd != null && (_jsxs("div", { className: "mt-1 flex items-center gap-2", children: [_jsxs("div", { className: "font-bold text-white", style: { fontSize: 26 }, children: ["$", priceUsd >= 1
                                                ? priceUsd.toLocaleString(undefined, { maximumFractionDigits: 4 })
                                                : priceUsd.toFixed(priceUsd < 0.0001 ? 8 : 4).replace(/0+$/, '').replace(/\.$/, '')] }), activeChange != null && (_jsxs("span", { className: `font-bold ${activeChange >= 0 ? 'text-success' : 'text-danger'}`, style: { fontSize: 14 }, children: [activeChange >= 0 ? '+' : '', activeChange.toFixed(2), "%"] }))] })), loading && _jsx("div", { className: "text-white/80 text-sm mt-2", children: "Loading\u2026" }), !loading && !pair && _jsx("div", { className: "text-white/80 text-sm mt-2", children: "No market data on DexScreener." })] }), _jsx(Sparkline, { change: activeChange, basePrice: priceUsd ?? 0, timeframe: timeframe }), _jsx("div", { className: "flex gap-2 justify-center mt-2 mb-3 px-4", children: TIME_BUTTONS.map((t) => {
                            const active = t === timeframe;
                            return (_jsx("button", { onClick: () => setTimeframe(t), className: `px-4 py-1 rounded-lg font-bold transition ${active ? 'bg-[#5eccfa] text-white' : 'bg-white text-ink hover:bg-white/85'}`, style: { fontSize: 13 }, children: t }, t));
                        }) }), _jsxs("div", { className: "grid grid-cols-3 gap-2 mb-4 mx-auto px-4", style: { width: '85%' }, children: [_jsx(ActionBtn, { onClick: () => nav('/send', { state: { token: serializeToken(token) } }), icon: arrowIcon, label: "Send", iconSize: 22 }), _jsx(ActionBtn, { onClick: () => 
                                // Swap from APE → this token (skip if user is already on the
                                // APE detail page; just go straight to /swap).
                                nav('/swap', isNative(token) ? undefined : { state: { tokenIn: serializeToken(APE), tokenOut: serializeToken(token) } }), icon: swapIcon, label: "Swap", iconSize: 28 }), _jsx(ActionBtn, { to: "/receive", icon: arrowIcon, label: "Receive", rotate: 180, iconSize: 22 })] }), _jsxs("div", { className: "px-4 pb-4", children: [_jsxs("div", { className: "card mb-3 flex justify-between items-center", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx(TokenLogo, { token: token, size: 41 }), _jsx("div", { className: "font-bold", style: { fontSize: 16 }, children: token.symbol })] }), _jsxs("div", { className: "text-right", children: [_jsxs("div", { className: "font-bold", style: { fontSize: 16 }, children: ["$", (balance * (priceUsd ?? 0)).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })] }), _jsx("div", { className: "text-ink-faint font-bold", style: { fontSize: 13 }, children: balance.toLocaleString(undefined, { maximumFractionDigits: 3 }) })] })] }), _jsxs("div", { className: "card mb-3 grid grid-cols-2 gap-3", children: [_jsx(Stat, { label: "24h volume", value: vol24 != null ? `$${formatBig(vol24)}` : '—' }), _jsx(Stat, { label: "Liquidity", value: liquidity != null ? `$${formatBig(liquidity)}` : '—' }), _jsx(Stat, { label: "Market cap", value: mcap != null ? `$${formatBig(mcap)}` : '—' }), _jsx(Stat, { label: "24h change", value: change24 != null ? `${change24 >= 0 ? '+' : ''}${change24.toFixed(2)}%` : '—', tone: change24 == null ? undefined : change24 >= 0 ? 'ok' : 'bad' })] }), !native && (_jsxs("div", { className: "card mb-3 flex items-center justify-between gap-3", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("div", { className: "font-bold text-ink-dim mb-0.5", style: { fontSize: 14 }, children: "Contract" }), _jsx("div", { className: "font-mono font-bold", style: { fontSize: 16 }, children: shortAddress(address, 5, 5) })] }), _jsx(AddressActions, { address: address, color: "#2e2114", size: 20 })] })), dsUrl && (_jsx("a", { href: dsUrl, target: "_blank", rel: "noreferrer", "aria-label": "View on DexScreener", className: "flex items-center justify-center w-full rounded-xl bg-white hover:bg-white/85", style: { height: 60 }, children: _jsx("span", { role: "img", "aria-hidden": true, className: "block", style: {
                                        height: 36, // ~40% smaller than the original 60px button height
                                        width: '60%', // mask scales to fit
                                        backgroundColor: '#000000',
                                        WebkitMaskImage: `url(${dexLogoUrl})`,
                                        maskImage: `url(${dexLogoUrl})`,
                                        WebkitMaskRepeat: 'no-repeat',
                                        maskRepeat: 'no-repeat',
                                        WebkitMaskPosition: 'center',
                                        maskPosition: 'center',
                                        WebkitMaskSize: 'contain',
                                        maskSize: 'contain',
                                    } }) }))] })] })] }));
}
/**
 * Synthesized SVG line chart that spans the full screen width and supports
 * hover-to-show price + timestamp.
 */
function Sparkline({ change, basePrice, timeframe }) {
    const ref = useRef(null);
    const [hover, setHover] = useState(null);
    // Number of points and total time window in ms based on timeframe.
    const N = 64;
    const windowMs = timeframe === '1H' ? 60 * 60 * 1000 : timeframe === '6H' ? 6 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const now = Date.now();
    const points = useMemo(() => {
        const c = change ?? 0;
        const startPrice = basePrice / (1 + c / 100);
        const endPrice = basePrice;
        const arr = [];
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
    function onMove(e) {
        const svg = ref.current;
        if (!svg)
            return;
        const rect = svg.getBoundingClientRect();
        const xPx = e.clientX - rect.left;
        const ratio = Math.max(0, Math.min(1, xPx / rect.width));
        const idx = Math.round(ratio * (N - 1));
        const p = points[idx];
        setHover({ x: ratio, price: p.price, ts: p.t });
    }
    return (_jsxs("div", { className: "relative w-full", style: { height: HEIGHT + 26 }, children: [_jsxs("svg", { ref: ref, viewBox: `0 0 ${VIEW_W} ${HEIGHT}`, width: "100%", height: HEIGHT, preserveAspectRatio: "none", onMouseMove: onMove, onMouseLeave: () => setHover(null), style: { display: 'block' }, children: [_jsx("path", { d: areaPath, fill: fill, stroke: "none" }), _jsx("path", { d: path, stroke: stroke, strokeWidth: 2.5, fill: "none", strokeLinecap: "round", strokeLinejoin: "round", vectorEffect: "non-scaling-stroke" }), hover && (_jsx("line", { x1: hover.x * VIEW_W, y1: 0, x2: hover.x * VIEW_W, y2: HEIGHT, stroke: "#ffffffaa", strokeWidth: 1, strokeDasharray: "3 3", vectorEffect: "non-scaling-stroke" }))] }), hover && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "absolute font-bold text-white px-2 py-0.5 rounded", style: {
                            top: 2,
                            left: `calc(${(hover.x * 100).toFixed(1)}% + 6px)`,
                            transform: hover.x > 0.7 ? 'translateX(-110%)' : undefined,
                            fontSize: 13,
                            backgroundColor: '#1c130a99',
                        }, children: ["$", formatPrice(hover.price)] }), _jsx("div", { className: "absolute text-white text-center font-bold", style: { bottom: 2, left: 0, right: 0, fontSize: 14 }, children: new Date(hover.ts).toLocaleString() })] }))] }));
}
function Stat({ label, value, tone }) {
    const color = tone === 'ok' ? 'text-success' : tone === 'bad' ? 'text-danger' : 'text-ink';
    return (_jsxs("div", { children: [_jsx("div", { className: "font-bold text-ink-dim", style: { fontSize: 13 }, children: label }), _jsx("div", { className: `font-bold ${color}`, style: { fontSize: 16 }, children: value })] }));
}
function formatPrice(n) {
    if (n >= 1)
        return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
    if (n >= 0.01)
        return n.toFixed(4);
    return n.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
}
function formatBig(n) {
    if (n >= 1e9)
        return `${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6)
        return `${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3)
        return `${(n / 1e3).toFixed(1)}K`;
    return n.toFixed(0);
}
// Action button — white background, black icon, black label.
// Accepts either a route (`to`) or an `onClick` handler so the parent can
// preselect a token via navigation state without the Link API.
function ActionBtn({ to, onClick, icon, label, rotate = 0, iconSize = 28, }) {
    const inner = (_jsxs(_Fragment, { children: [_jsx("div", { className: "h-8 flex items-center justify-center", style: { marginTop: '10%' }, children: _jsx("span", { role: "img", "aria-hidden": true, className: "block", style: {
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
                    } }) }), _jsx("span", { className: "font-bold text-black mt-1", style: { fontSize: 13 }, children: label })] }));
    const className = 'aspect-square flex flex-col items-center justify-center rounded-2xl bg-white hover:bg-white/85 transition relative';
    if (onClick) {
        return (_jsx("button", { onClick: onClick, "aria-label": label, className: className, children: inner }));
    }
    return (_jsx(Link, { to: to ?? '#', "aria-label": label, className: className, children: inner }));
}
/** JSON-safe slim TokenMeta passed via react-router state. */
function serializeToken(t) {
    return {
        symbol: t.symbol,
        name: t.name,
        address: t.address,
        decimals: t.decimals,
        isNative: t.isNative,
        logo: t.logo,
    };
}
