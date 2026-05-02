import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import { isNative, searchTokens, tokenKey, TOP_TOKENS, safeChecksum } from '@/lib/tokens';
import { rpc } from '@/lib/messaging';
import { isValidEvmAddress, shortAddress } from '@/lib/wallet-utils';
import { TokenLogo } from './TokenLogo';
export function TokenPicker({ open, onClose, onPick, walletTokens = [], exclude }) {
    const [query, setQuery] = useState('');
    const [trending, setTrending] = useState([]);
    const [searchHits, setSearchHits] = useState([]);
    const [searching, setSearching] = useState(false);
    const [pasteAddr, setPasteAddr] = useState('');
    const [pasteErr, setPasteErr] = useState(null);
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
    function tryAddPasted() {
        setPasteErr(null);
        try {
            if (!isValidEvmAddress(pasteAddr.trim()))
                throw new Error('Invalid contract address');
            const addr = safeChecksum(pasteAddr.trim());
            onPick({
                symbol: 'TOKEN',
                name: 'Custom token',
                address: addr,
                decimals: 18,
            });
            setPasteAddr('');
        }
        catch (e) {
            setPasteErr(e.message);
        }
    }
    const totalResults = sections.top.length + sections.yours.length + sections.trend.length + sections.hits.length;
    if (!open)
        return null;
    return (_jsx("div", { className: "fixed inset-0 bg-black/70 flex items-end z-30", onClick: onClose, children: _jsxs("div", { className: "bg-bg-card border-t border-line w-full rounded-t-2xl max-h-[90vh] flex flex-col", onClick: (e) => e.stopPropagation(), children: [_jsxs("div", { className: "p-4 border-b border-line", children: [_jsxs("div", { className: "flex items-center justify-between mb-3", children: [_jsx("h3", { className: "text-sm font-semibold", children: "Select a token" }), _jsx("button", { onClick: onClose, className: "text-ink-dim text-lg leading-none", children: "\u00D7" })] }), _jsx("input", { autoFocus: true, className: "input", placeholder: "Symbol, name, or paste contract (0x\u2026)", value: query, onChange: (e) => setQuery(e.target.value) })] }), _jsxs("div", { className: "flex-1 overflow-y-auto p-2", children: [sections.top.length > 0 && (_jsx(Section, { title: "Top tokens", tokens: sections.top, onPick: onPick })), sections.yours.length > 0 && (_jsx(Section, { title: "Your tokens", tokens: sections.yours, onPick: onPick })), sections.hits.length > 0 && (_jsx(Section, { title: "From DexScreener", tokens: sections.hits, onPick: onPick })), sections.trend.length > 0 && (_jsx(Section, { title: "\uD83D\uDD25 Trending on ApeChain", tokens: sections.trend, onPick: onPick })), searching && totalResults === 0 && (_jsx("div", { className: "text-center text-ink-dim text-sm py-6", children: "Searching DexScreener\u2026" })), !searching && totalResults === 0 && (_jsx("div", { className: "text-center text-ink-dim text-sm py-6", children: "No matches. Paste the contract address below." }))] }), _jsx("div", { className: "p-4 border-t border-line", children: _jsxs("details", { children: [_jsx("summary", { className: "text-xs text-ink-dim cursor-pointer", children: "Add by contract address" }), _jsxs("div", { className: "mt-2 space-y-2", children: [_jsx("input", { className: "input font-mono text-xs", placeholder: "0x\u2026", value: pasteAddr, onChange: (e) => setPasteAddr(e.target.value) }), pasteErr && _jsx("div", { className: "text-danger text-xs", children: pasteErr }), _jsx("button", { className: "btn-ghost w-full", onClick: tryAddPasted, children: "Use this token" }), _jsx("p", { className: "text-[10px] text-ink-faint", children: "Only add contracts you trust. Verify the address on the explorer first." })] })] }) })] }) }));
}
function Section({ title, tokens, onPick }) {
    return (_jsxs(_Fragment, { children: [_jsx("div", { className: "text-[10px] uppercase tracking-wider text-ink-faint px-3 mt-2 mb-1", children: title }), tokens.map((t) => (_jsxs("button", { onClick: () => onPick(t), className: "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-bg-soft text-left", children: [_jsx(TokenLogo, { token: t, size: 32 }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "font-medium", children: t.symbol }), t.verified && _jsx("span", { className: "text-[10px] text-brand", children: "\u2713" })] }), _jsxs("div", { className: "text-[11px] text-ink-faint truncate", children: [t.name, " ", !isNative(t) && _jsxs("span", { className: "font-mono", children: ["\u00B7 ", shortAddress(t.address)] })] })] })] }, tokenKey(t))))] }));
}
