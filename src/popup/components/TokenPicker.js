import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import { isNative, searchTokens, tokenKey, TOP_TOKENS, safeChecksum } from '@/lib/tokens';
import { rpc } from '@/lib/messaging';
import { shortAddress } from '@/lib/wallet-utils';
import { TokenLogo } from './TokenLogo';
const verifiedIconUrl = chrome.runtime.getURL('verified.png');
export function TokenPicker({ open, onClose, onPick, walletTokens = [], exclude, stats = {} }) {
    const [query, setQuery] = useState('');
    const [trending, setTrending] = useState([]);
    const [searchHits, setSearchHits] = useState([]);
    const [searching, setSearching] = useState(false);
    // Top trending ApeChain tokens via DexScreener
    useEffect(() => {
        if (!open)
            return;
        rpc({ type: 'dex.trending', limit: 50 })
            .then((pairs) => {
            const out = [];
            for (const p of pairs) {
                if (!p.baseToken?.address)
                    continue;
                out.push({
                    symbol: p.baseToken.symbol ?? 'TOKEN',
                    name: p.baseToken.name ?? p.baseToken.symbol ?? 'Token',
                    address: safeChecksum(p.baseToken.address),
                    decimals: 18,
                    logo: p.info?.imageUrl,
                });
            }
            setTrending(out);
        })
            .catch(() => { });
    }, [open]);
    // DexScreener search for typed input (symbol or 0x address)
    useEffect(() => {
        const q = query.trim();
        if (!q || q.length < 2) {
            setSearchHits([]);
            return;
        }
        setSearching(true);
        const t = window.setTimeout(async () => {
            try {
                const pair = await rpc({ type: 'dex.token', query: q });
                if (pair?.baseToken?.address) {
                    setSearchHits([{
                            symbol: pair.baseToken.symbol ?? q,
                            name: pair.baseToken.name ?? pair.baseToken.symbol ?? q,
                            address: safeChecksum(pair.baseToken.address),
                            decimals: 18,
                            logo: pair.info?.imageUrl,
                        }]);
                    return;
                }
                setSearchHits([]);
            }
            catch {
                setSearchHits([]);
            }
            finally {
                setSearching(false);
            }
        }, 350);
        return () => window.clearTimeout(t);
    }, [query]);
    const sections = useMemo(() => {
        const filtered = (xs) => searchTokens(query, xs).filter(t => !exclude || tokenKey(t) !== tokenKey(exclude));
        const seen = new Set();
        if (exclude)
            seen.add(tokenKey(exclude));
        const dedup = (xs) => xs.filter((t) => {
            const k = tokenKey(t);
            if (seen.has(k))
                return false;
            seen.add(k);
            return true;
        });
        const top = dedup(filtered(TOP_TOKENS));
        const yours = dedup(filtered(walletTokens));
        const trend = dedup(filtered(trending));
        const hits = dedup(searchHits.filter(t => !exclude || tokenKey(t) !== tokenKey(exclude)));
        return { top, yours, trend, hits };
    }, [query, trending, walletTokens, searchHits, exclude]);
    const totalResults = sections.top.length + sections.yours.length + sections.trend.length + sections.hits.length;
    if (!open)
        return null;
    return (_jsx("div", { className: "fixed inset-0 bg-black/70 flex items-end z-30", onClick: onClose, children: _jsxs("div", { className: "bg-bg-card border-t border-line w-full rounded-t-2xl max-h-[90vh] flex flex-col", onClick: (e) => e.stopPropagation(), children: [_jsxs("div", { className: "p-4 border-b border-line", children: [_jsxs("div", { className: "flex items-center justify-between mb-3", children: [_jsx("h3", { className: "font-bold", style: { fontSize: 18 }, children: "Select a token" }), _jsx("button", { onClick: onClose, className: "text-ink-dim leading-none", style: { fontSize: 22 }, children: "\u00D7" })] }), _jsx("input", { autoFocus: true, className: "input", style: { fontSize: 16 }, placeholder: "Search Tokens", value: query, onChange: (e) => setQuery(e.target.value) })] }), _jsxs("div", { className: "flex-1 overflow-y-auto p-2", children: [sections.top.length > 0 && (_jsx(Section, { title: "Top tokens", tokens: sections.top, onPick: onPick, stats: stats })), sections.yours.length > 0 && (_jsx(Section, { title: "Your tokens", tokens: sections.yours, onPick: onPick, stats: stats })), sections.hits.length > 0 && (_jsx(Section, { title: "From DexScreener", tokens: sections.hits, onPick: onPick, stats: stats })), sections.trend.length > 0 && (_jsx(Section, { title: "\uD83D\uDD25 Trending on ApeChain", tokens: sections.trend, onPick: onPick, stats: stats })), searching && totalResults === 0 && (_jsx("div", { className: "text-center text-ink-dim py-6", style: { fontSize: 16 }, children: "Searching DexScreener\u2026" })), !searching && totalResults === 0 && (_jsx("div", { className: "text-center text-ink-dim py-6", style: { fontSize: 16 }, children: "No matches." }))] })] }) }));
}
function Section({ title, tokens, onPick, stats, }) {
    return (_jsxs(_Fragment, { children: [_jsx("div", { className: "uppercase tracking-wider text-ink-faint px-3 mt-2 mb-1", style: { fontSize: 13 }, children: title }), tokens.map((t) => {
                const k = tokenKey(t);
                const s = stats[k];
                const balN = s?.balance ? parseFloat(s.balance) : null;
                const usd = balN != null && s?.priceUsd != null && s.priceUsd > 0 ? balN * s.priceUsd : null;
                return (_jsxs("button", { onClick: () => onPick(t), className: "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-bg-soft text-left", children: [_jsx(TokenLogo, { token: t, size: 42 }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsxs("div", { className: "flex items-center gap-1.5", children: [_jsx("span", { className: "font-bold", style: { fontSize: 16 }, children: t.symbol }), t.verified && (_jsx("img", { src: verifiedIconUrl, alt: "Verified", title: "Verified", className: "inline-block", style: { width: 14, height: 14 } }))] }), _jsxs("div", { className: "text-ink-faint truncate", style: { fontSize: 13 }, children: [t.name, " ", !isNative(t) && _jsxs("span", { className: "font-mono", children: ["\u00B7 ", shortAddress(t.address)] })] })] }), balN != null && balN > 0 && (_jsxs("div", { className: "text-right shrink-0", children: [_jsx("div", { className: "font-bold", style: { fontSize: 14 }, children: balN.toLocaleString(undefined, { maximumFractionDigits: 3 }) }), usd != null && (_jsxs("div", { className: "text-ink-faint", style: { fontSize: 12 }, children: ["$", usd.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })] }))] }))] }, k));
            })] }));
}
