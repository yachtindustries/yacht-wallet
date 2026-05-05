import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BottomNav, Page, Screen, TopBar } from '../components/Layout';
import { rpc } from '@/lib/messaging';
const APECHAIN_APPS = [
    // 2x2 grid; row order is Otherside / OpenSea on top, DexScreener / Camelot below.
    { name: 'Otherside', url: 'https://www.otherside.xyz', imgUrl: chrome.runtime.getURL('app-otherside.png') },
    { name: 'OpenSea', url: 'https://opensea.io/collections?chains=ape_chain', imgUrl: chrome.runtime.getURL('app-opensea.png') },
    { name: 'DexScreener', url: 'https://dexscreener.com/apechain', imgUrl: chrome.runtime.getURL('app-dexscreener.png') },
    { name: 'Camelot', url: 'https://app.camelot.exchange', imgUrl: chrome.runtime.getURL('app-camelot.png') },
];
export default function SearchScreen() {
    const nav = useNavigate();
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
    return (_jsxs(Screen, { children: [_jsx(TopBar, { title: "Discover", onBack: () => nav('/'), tone: "deck" }), _jsxs(Page, { tone: "deck", children: [_jsx("input", { className: "w-full bg-white border border-white rounded-xl px-3 py-2.5 text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-white mb-4", style: { fontSize: 17 }, placeholder: "Search Tokens", value: query, onChange: (e) => setQuery(e.target.value) }), !searchResults && (_jsxs("div", { className: "mb-4", children: [_jsx("h2", { className: "uppercase tracking-wider text-ink-dim mb-2 px-1 font-bold", style: { fontSize: 13 }, children: "ApeChain Apps" }), _jsx("div", { className: "grid grid-cols-2 gap-2", children: APECHAIN_APPS.map((a) => (_jsx("a", { href: a.url, target: "_blank", rel: "noreferrer", className: "rounded-2xl overflow-hidden hover:opacity-80 transition", title: a.name, "aria-label": a.name, children: _jsx("img", { src: a.imgUrl, alt: a.name, className: "w-full h-auto block" }) }, a.name))) })] })), _jsx("h2", { className: "uppercase tracking-wider text-ink-dim mb-2 px-1 font-bold", style: { fontSize: 13 }, children: searchResults ? 'Search results' : 'Trending on ApeChain' }), (loading || searching) && _jsx("div", { className: "text-ink-dim", style: { fontSize: 17 }, children: "Loading\u2026" }), err && _jsx("div", { className: "text-danger", style: { fontSize: 14 }, children: err }), _jsxs("div", { className: "space-y-2", children: [showing.map((p) => {
                                const change = p.priceChange?.h24;
                                const changeColor = change == null ? 'text-ink-dim' : change >= 0 ? 'text-brand' : 'text-danger';
                                return (_jsxs(Link, { to: `/token/${encodeURIComponent(p.baseToken.address)}`, className: "card flex items-center gap-3 hover:border-brand", children: [p.info?.imageUrl ? (_jsx("img", { src: p.info.imageUrl, alt: p.baseToken.symbol, className: "w-11 h-11 rounded-full bg-bg-soft border border-line object-cover", onError: (e) => { e.currentTarget.style.display = 'none'; } })) : (_jsx("div", { className: "w-11 h-11 rounded-full bg-brand/15 border border-brand/30 flex items-center justify-center font-bold text-brand shrink-0", style: { fontSize: 14 }, children: p.baseToken.symbol.slice(0, 2).toUpperCase() })), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("div", { className: "font-bold truncate", style: { fontSize: 17 }, children: p.baseToken.symbol }), _jsx("div", { className: "font-bold", style: { fontSize: 17 }, children: p.priceUsd ? `$${formatPrice(parseFloat(p.priceUsd))}` : '—' })] }), _jsxs("div", { className: "flex items-center justify-between", style: { fontSize: 13 }, children: [_jsxs("span", { className: "text-ink-faint truncate", children: [p.baseToken.name ?? p.baseToken.symbol, " \u00B7 vol $", formatBig(p.volume?.h24 ?? 0)] }), _jsx("span", { className: `${changeColor}`, children: change == null ? '' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` })] })] })] }, p.pairAddress));
                            }), showing.length === 0 && !loading && !searching && (_jsx("div", { className: "card text-center text-ink-dim py-6", style: { fontSize: 16 }, children: searchResults ? 'No matching ApeChain token found.' : 'No trending tokens right now.' }))] })] }), _jsx(BottomNav, {})] }));
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
