import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Page, Screen, TopBar } from '../components/Layout';
import { TokenLogo } from '../components/TokenLogo';
import { rpc } from '@/lib/messaging';
import { APE, safeChecksum } from '@/lib/tokens';
import { shortAddress } from '@/lib/wallet-utils';
import { NETWORKS } from '@/lib/networks';
const TRACKED_TOKENS_KEY = 'yacht.trackedTokens.v1';
export default function TokenDetail() {
    const params = useParams();
    const raw = decodeURIComponent(params.address ?? '');
    const native = raw === 'native' || raw.toLowerCase() === '0x0000000000000000000000000000000000000000';
    const address = native ? '' : safeChecksum(raw);
    const [pair, setPair] = useState(null);
    const [loading, setLoading] = useState(true);
    const [copied, setCopied] = useState(false);
    const [tracked, setTracked] = useState(false);
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
    useEffect(() => {
        if (native)
            return;
        void chrome.storage.local.get(TRACKED_TOKENS_KEY).then((r) => {
            const list = r[TRACKED_TOKENS_KEY] ?? [];
            setTracked(list.some((t) => t.toLowerCase() === address.toLowerCase()));
        });
    }, [address, native]);
    async function toggleTrack() {
        if (native)
            return;
        const r = await chrome.storage.local.get(TRACKED_TOKENS_KEY);
        const list = r[TRACKED_TOKENS_KEY] ?? [];
        const lower = address.toLowerCase();
        const isTracked = list.some((t) => t.toLowerCase() === lower);
        const next = isTracked ? list.filter((t) => t.toLowerCase() !== lower) : [...list, address];
        await chrome.storage.local.set({ [TRACKED_TOKENS_KEY]: next });
        setTracked(!isTracked);
    }
    async function copy(s) {
        await navigator.clipboard.writeText(s);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
    }
    const priceUsd = pair?.priceUsd ? parseFloat(pair.priceUsd) : null;
    const change24 = pair?.priceChange?.h24 ?? null;
    const vol24 = pair?.volume?.h24 ?? null;
    const mcap = pair?.marketCap ?? pair?.fdv ?? null;
    const liquidity = pair?.liquidity?.usd ?? null;
    const dsUrl = pair?.url ?? (pair?.pairAddress ? `https://dexscreener.com/apechain/${pair.pairAddress}` : null);
    const chartUrl = pair?.pairAddress
        ? `https://dexscreener.com/apechain/${pair.pairAddress}?embed=1&theme=dark&info=0&trades=0`
        : null;
    const explorerAddr = NETWORKS.mainnet.explorerAddr;
    return (_jsxs(Screen, { children: [_jsx(TopBar, { title: token.symbol, right: _jsxs("div", { className: "flex items-center gap-2", children: [!native && (_jsx("button", { onClick: toggleTrack, className: `text-xs ${tracked ? 'text-warn' : 'text-brand'} hover:underline`, children: tracked ? 'Untrack' : 'Track' })), _jsx(Link, { to: "/swap", className: "text-brand text-xs hover:underline", children: "Swap" })] }) }), _jsxs(Page, { children: [_jsxs("div", { className: "card text-center mb-3", children: [_jsx("div", { className: "flex justify-center mb-2", children: _jsx(TokenLogo, { token: token, size: 56 }) }), _jsx("div", { className: "text-lg font-semibold", children: pair?.baseToken?.name ?? token.symbol }), priceUsd != null && (_jsxs("div", { className: "mt-2 flex items-center justify-center gap-2", children: [_jsxs("div", { className: "text-2xl font-bold", children: ["$", priceUsd >= 1
                                                ? priceUsd.toLocaleString(undefined, { maximumFractionDigits: 4 })
                                                : priceUsd.toFixed(priceUsd < 0.0001 ? 8 : 4).replace(/0+$/, '').replace(/\.$/, '')] }), change24 != null && (_jsxs("span", { className: `text-sm font-medium ${change24 >= 0 ? 'text-success' : 'text-danger'}`, children: [change24 >= 0 ? '+' : '', change24.toFixed(2), "%"] }))] })), loading && _jsx("div", { className: "text-ink-dim text-sm mt-2", children: "Loading\u2026" }), !loading && !pair && _jsx("div", { className: "text-ink-dim text-sm mt-2", children: "No market data on DexScreener." })] }), chartUrl && (_jsx("div", { className: "card !p-0 overflow-hidden mb-3", style: { height: 260 }, children: _jsx("iframe", { src: chartUrl, title: `${token.symbol} chart`, className: "w-full h-full border-0" }) })), _jsxs("div", { className: "card mb-3 grid grid-cols-2 gap-3 text-xs", children: [_jsx(Stat, { label: "24h volume", value: vol24 != null ? `$${formatBig(vol24)}` : '—' }), _jsx(Stat, { label: "Liquidity", value: liquidity != null ? `$${formatBig(liquidity)}` : '—' }), _jsx(Stat, { label: "Market cap", value: mcap != null ? `$${formatBig(mcap)}` : '—' }), _jsx(Stat, { label: "24h change", value: change24 != null ? `${change24 >= 0 ? '+' : ''}${change24.toFixed(2)}%` : '—', tone: change24 == null ? undefined : change24 >= 0 ? 'ok' : 'bad' }), _jsx(Stat, { label: "1h change", value: pair?.priceChange?.h1 != null ? `${pair.priceChange.h1 >= 0 ? '+' : ''}${pair.priceChange.h1.toFixed(2)}%` : '—', tone: pair?.priceChange?.h1 == null ? undefined : pair.priceChange.h1 >= 0 ? 'ok' : 'bad' }), _jsx(Stat, { label: "6h change", value: pair?.priceChange?.h6 != null ? `${pair.priceChange.h6 >= 0 ? '+' : ''}${pair.priceChange.h6.toFixed(2)}%` : '—', tone: pair?.priceChange?.h6 == null ? undefined : pair.priceChange.h6 >= 0 ? 'ok' : 'bad' })] }), !native && (_jsxs("div", { className: "card mb-3", children: [_jsx("div", { className: "text-[11px] text-ink-dim mb-1", children: "Contract address" }), _jsxs("button", { onClick: () => copy(address), className: "w-full flex justify-between items-center hover:text-brand", title: "Copy", children: [_jsx("span", { className: "font-mono text-xs break-all text-left", children: address }), _jsx("span", { className: "text-xs text-ink-faint ml-2 shrink-0", children: copied ? 'Copied!' : '⧉' })] })] })), _jsxs("div", { className: "card mb-3", children: [_jsx("div", { className: "text-[11px] text-ink-dim mb-1", children: "More data" }), _jsxs("div", { className: "space-y-1", children: [dsUrl && (_jsx("a", { className: "block text-sm text-brand hover:underline", href: dsUrl, target: "_blank", rel: "noreferrer", children: "View on DexScreener \u2192" })), !native && (_jsx("a", { className: "block text-sm text-brand hover:underline", href: explorerAddr(address), target: "_blank", rel: "noreferrer", children: "View on Apescan \u2192" }))] })] }), !native && (_jsx("div", { className: "text-[11px] text-ink-faint text-center mt-3", children: _jsx("span", { className: "font-mono", children: shortAddress(address) }) }))] })] }));
}
function Stat({ label, value, tone }) {
    const color = tone === 'ok' ? 'text-success' : tone === 'bad' ? 'text-danger' : 'text-ink';
    return (_jsxs("div", { children: [_jsx("div", { className: "text-[10px] uppercase tracking-wider text-ink-dim", children: label }), _jsx("div", { className: `text-sm font-mono ${color}`, children: value })] }));
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
