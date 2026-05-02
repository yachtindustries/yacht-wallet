import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BottomNav, Page, Screen, TopBar } from '../components/Layout';
import { rpc } from '@/lib/messaging';
const APECHAIN_APPS = [
    { name: 'Camelot', url: 'https://app.camelot.exchange/?chain=apechain', tagline: 'DEX & liquidity' },
    { name: 'ApeBond', url: 'https://apebond.com', tagline: 'Bonds & yield' },
    { name: 'DexScreener', url: 'https://dexscreener.com/apechain', tagline: 'Live token charts' },
    { name: 'Apescan', url: 'https://apescan.io', tagline: 'Block explorer' },
];
export default function SearchScreen() {
    const [trending, setTrending] = useState([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState(null);
    const [query, setQuery] = useState('');
    const [searchResults, setSearchResults] = useState(null);
    const [searching, setSearching] = useState(false);
    useEffect(() => {
        setLoading(true);
        rpc({ type: 'dex.trending', limit: 15 })
            .then((t) => setTrending(t))
            .catch((e) => setErr(e.message))
            .finally(() => setLoading(false));
    }, []);
    useEffect(() => {
        const q = query.trim();
        if (!q) {
            setSearchResults(null);
            return;
        }
        setSearching(true);
        const t = window.setTimeout(async () => {
            try {
                const pair = await rpc({ type: 'dex.token', query: q });
                setSearchResults(pair ? [pair] : []);
            }
            catch {
                setSearchResults([]);
            }
            finally {
                setSearching(false);
            }
        }, 350);
        return () => window.clearTimeout(t);
    }, [query]);
    const showing = searchResults ?? trending;
    return (_jsxs(Screen, { children: [_jsx(TopBar, { title: "Discover", onBack: () => { }, tone: "deck" }), _jsxs(Page, { tone: "deck", children: [_jsx("input", { className: "w-full bg-white border border-white rounded-xl px-3 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-white mb-4", placeholder: "Search Tokens", value: query, onChange: (e) => setQuery(e.target.value) }), _jsx("h2", { className: "text-xs uppercase tracking-wider text-ink-dim mb-2 px-1", children: searchResults ? 'Search results' : 'Trending on ApeChain' }), (loading || searching) && _jsx("div", { className: "text-ink-dim text-sm", children: "Loading\u2026" }), err && _jsx("div", { className: "text-danger text-xs", children: err }), _jsxs("div", { className: "space-y-2", children: [showing.map((p) => {
                                const change = p.priceChange?.h24;
                                const changeColor = change == null ? 'text-ink-dim' : change >= 0 ? 'text-brand' : 'text-danger';
                                return (_jsxs(Link, { to: `/token/${encodeURIComponent(p.baseToken.address)}`, className: "card flex items-center gap-3 hover:border-brand", children: [p.info?.imageUrl ? (_jsx("img", { src: p.info.imageUrl, alt: p.baseToken.symbol, className: "w-9 h-9 rounded-full bg-bg-soft border border-line object-cover", onError: (e) => { e.currentTarget.style.display = 'none'; } })) : (_jsx("div", { className: "w-9 h-9 rounded-full bg-brand/15 border border-brand/30 flex items-center justify-center text-xs font-bold text-brand shrink-0", children: p.baseToken.symbol.slice(0, 2).toUpperCase() })), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("div", { className: "font-medium text-sm truncate", children: p.baseToken.symbol }), _jsx("div", { className: "text-sm font-mono", children: p.priceUsd ? `$${formatPrice(parseFloat(p.priceUsd))}` : '—' })] }), _jsxs("div", { className: "flex items-center justify-between text-[11px]", children: [_jsxs("span", { className: "text-ink-faint truncate", children: [p.baseToken.name ?? p.baseToken.symbol, " \u00B7 vol $", formatBig(p.volume?.h24 ?? 0)] }), _jsx("span", { className: `font-mono ${changeColor}`, children: change == null ? '' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` })] })] })] }, p.pairAddress));
                            }), showing.length === 0 && !loading && !searching && (_jsx("div", { className: "card text-center text-sm text-ink-dim py-6", children: searchResults ? 'No matching ApeChain token found.' : 'No trending tokens right now.' }))] }), _jsxs("div", { className: "mt-6", children: [_jsx("h2", { className: "text-xs uppercase tracking-wider text-ink-dim mb-2 px-1", children: "ApeChain apps" }), _jsx("div", { className: "grid grid-cols-2 gap-2", children: APECHAIN_APPS.map((a) => (_jsxs("a", { href: a.url, target: "_blank", rel: "noreferrer", className: "card hover:border-brand transition flex flex-col gap-1", children: [_jsx("span", { className: "font-medium text-sm", children: a.name }), _jsx("div", { className: "text-[11px] text-ink-faint", children: a.tagline }), _jsx("div", { className: "text-[10px] text-ink-faint mt-auto pt-1 truncate", children: a.url.replace(/^https?:\/\//, '') })] }, a.name))) })] }), _jsx("p", { className: "text-[10px] text-ink-faint mt-4 text-center", children: "Powered by DexScreener" })] }), _jsx(BottomNav, {})] }));
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
