import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Screen, BottomNav } from '../components/Layout';
import { TokenLogo } from '../components/TokenLogo';
import { YachtBackground } from '../components/YachtBackground';
import { useApp } from '../store';
import { rpc } from '@/lib/messaging';
import { shortAddress } from '@/lib/wallet-utils';
import { APE, safeChecksum } from '@/lib/tokens';
const arrowIcon = chrome.runtime.getURL('public/actions/sendreceive.png');
const swapIcon = chrome.runtime.getURL('public/actions/swap.png');
const TRACKED_TOKENS_KEY = 'yacht.trackedTokens.v1';
function accountInitial(name) {
    const trimmed = name.trim();
    const accountMatch = /^account\s*(\d+)$/i.exec(trimmed);
    if (accountMatch)
        return `A${accountMatch[1]}`;
    return (trimmed[0] ?? 'A').toUpperCase();
}
async function loadTrackedTokens() {
    const r = await chrome.storage.local.get(TRACKED_TOKENS_KEY);
    const list = r[TRACKED_TOKENS_KEY] ?? [];
    return list;
}
export default function Dashboard() {
    const nav = useNavigate();
    const { meta, settings, showBackupNotice, setBackupNotice } = useApp();
    const active = meta?.publicAccounts.find((a) => a.id === meta?.activeAccountId) ?? meta?.publicAccounts[0];
    const [summary, setSummary] = useState(null);
    const [tokens, setTokens] = useState([]);
    const [apeUsd, setApeUsd] = useState(0);
    const [apeChange, setApeChange] = useState(null);
    const [tokenStats, setTokenStats] = useState({});
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [err, setErr] = useState(null);
    const [copied, setCopied] = useState(false);
    const [view, setView] = useState('tokens');
    const [nfts, setNfts] = useState([]);
    const [nftsLoading, setNftsLoading] = useState(false);
    const [nftsLoaded, setNftsLoaded] = useState(false);
    const loadAll = useCallback(async () => {
        if (!active)
            return;
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
                    if (tr.native || !tr.tokenAddress || tr.direction === 'out')
                        continue;
                    const a = tr.tokenAddress;
                    if (!lower.has(a.toLowerCase())) {
                        tracked.push(a);
                        lower.add(a.toLowerCase());
                        added = true;
                    }
                }
            }
            if (added)
                await chrome.storage.local.set({ [TRACKED_TOKENS_KEY]: tracked });
            const balances = tracked.length
                ? await rpc({ type: 'evm.erc20.balances', tokens: tracked, address: active.address })
                : [];
            setSummary(s);
            setTokens(balances);
            setApeUsd(p.usd);
            setApeChange(apePair?.priceChange?.h24 ?? null);
        }
        catch (e) {
            setErr(e.message);
        }
    }, [active?.address]);
    const loadNfts = useCallback(async () => {
        if (!active)
            return;
        setNftsLoading(true);
        try {
            const list = await rpc({ type: 'evm.nfts', address: active.address });
            setNfts(list);
        }
        catch {
            setNfts([]);
        }
        finally {
            setNftsLoading(false);
            setNftsLoaded(true);
        }
    }, [active?.address]);
    useEffect(() => {
        if (!active)
            return;
        setLoading(true);
        loadAll().finally(() => setLoading(false));
        setNftsLoaded(false);
        setNfts([]);
    }, [active?.address, settings?.network, loadAll]);
    useEffect(() => {
        if (view === 'nfts' && !nftsLoaded && !nftsLoading) {
            void loadNfts();
        }
    }, [view, nftsLoaded, nftsLoading, loadNfts]);
    // Fetch USD price + 24h change for each ERC-20 (lazy, per token)
    useEffect(() => {
        if (!tokens.length)
            return;
        for (const t of tokens) {
            const k = t.token.address.toLowerCase();
            if (tokenStats[k] !== undefined)
                continue;
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
    const totalUsd = useMemo(() => {
        let total = apeValue;
        for (const t of tokens) {
            const k = t.token.address.toLowerCase();
            const stat = tokenStats[k];
            if (!stat)
                continue;
            total += parseFloat(t.balance) * stat.priceUsd;
        }
        return total;
    }, [apeValue, tokens, tokenStats]);
    const nonZero = tokens.filter((t) => parseFloat(t.balance) !== 0);
    const zero = tokens.filter((t) => parseFloat(t.balance) === 0);
    async function copyAddress() {
        if (!active)
            return;
        await navigator.clipboard.writeText(active.address);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
    }
    async function untrackToken(addr) {
        const tracked = await loadTrackedTokens();
        const next = tracked.filter((t) => t.toLowerCase() !== addr.toLowerCase());
        await chrome.storage.local.set({ [TRACKED_TOKENS_KEY]: next });
        setTokens((xs) => xs.filter((x) => x.token.address.toLowerCase() !== addr.toLowerCase()));
    }
    if (!active)
        return null;
    return (_jsxs(Screen, { children: [_jsxs("div", { className: "relative flex-1 overflow-y-auto", style: { backgroundColor: '#f6c87e' }, children: [_jsx(YachtBackground, {}), _jsxs("div", { className: "relative z-10", children: [_jsx("div", { className: "flex items-center justify-between px-4 pt-3 pb-2", children: _jsxs("div", { className: "flex items-center gap-3 min-w-0", children: [_jsx(Link, { to: "/accounts", "aria-label": "Accounts", children: _jsx("span", { className: "rounded-full bg-[#3a87b8]/55 hover:bg-[#3a87b8]/75 transition flex items-center justify-center font-bold text-white", style: { width: 32, height: 32, fontSize: 11 }, children: accountInitial(active.name) }) }), _jsx("button", { onClick: copyAddress, className: "font-bold text-white hover:text-white/80 transition truncate", style: { fontSize: 15 }, title: "Copy address", children: copied ? 'Copied!' : shortAddress(active.address, 5, 4) })] }) }), _jsxs("div", { className: "px-4 pb-4", children: [showBackupNotice && (_jsxs("div", { className: "mb-3 p-3 rounded-xl bg-warn/10 border border-warn/30 text-xs text-warn flex items-start gap-2", children: [_jsx("span", { children: "\u26A0" }), _jsxs("div", { className: "flex-1", children: [_jsx("div", { className: "font-medium", children: "Back up your recovery phrase" }), _jsxs("div", { className: "text-warn/80 mt-0.5", children: ["Open ", _jsx(Link, { to: "/accounts", className: "underline", children: "Accounts" }), " \u2192 Reveal phrase to copy your seed somewhere safe."] })] }), _jsx("button", { onClick: () => setBackupNotice(false), className: "text-warn/70 hover:text-warn text-base leading-none", children: "\u00D7" })] })), _jsxs("div", { className: "text-center mb-4 mt-2", children: [_jsxs("div", { className: "text-[44px] leading-tight font-bold text-white", children: ["$", totalUsd.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })] }), err && _jsx("div", { className: "mt-2 text-xs text-danger", children: err })] }), _jsxs("div", { className: "grid grid-cols-3 gap-2 mb-5 mx-auto", style: { width: '75%' }, children: [_jsx(ActionBtn, { to: "/send", icon: arrowIcon, label: "Send", iconSize: 22 }), _jsx(ActionBtn, { to: "/swap", icon: swapIcon, label: "Swap", iconSize: 28 }), _jsx(ActionBtn, { to: "/receive", icon: arrowIcon, label: "Receive", rotate: 180, iconSize: 22 })] }), _jsxs("div", { className: "flex items-center gap-4 px-1 mb-3 pb-2", children: [_jsxs("button", { onClick: () => setView('tokens'), className: `text-[18px] font-bold transition ${view === 'tokens' ? 'text-white' : 'text-white/55 hover:text-white/80'}`, children: ["Tokens ", _jsxs("span", { className: "text-[14px] font-bold opacity-80", children: ["(", tokens.length + 1, ")"] })] }), _jsxs("button", { onClick: () => setView('nfts'), className: `text-[18px] font-bold transition ${view === 'nfts' ? 'text-white' : 'text-white/55 hover:text-white/80'}`, children: ["NFTs ", nftsLoaded && _jsxs("span", { className: "text-[14px] font-bold opacity-80", children: ["(", nfts.length, ")"] })] }), _jsxs("div", { className: "ml-auto flex items-center gap-1.5", children: [view === 'tokens' && (_jsx(Link, { to: "/search", title: "Add token", className: "w-9 h-9 rounded-lg flex items-center justify-center text-white hover:bg-white/15", children: _jsx("span", { className: "text-2xl leading-none font-bold", children: "+" }) })), _jsx("button", { onClick: refresh, disabled: refreshing, title: "Refresh", className: `w-9 h-9 rounded-lg flex items-center justify-center text-white hover:bg-white/15 ${refreshing ? 'animate-spin' : ''}`, children: _jsx("span", { className: "text-xl leading-none font-bold", children: "\u21BB" }) })] })] }), view === 'tokens' ? (_jsxs("div", { className: "space-y-2", children: [_jsxs("button", { onClick: () => nav('/token/native'), className: "card flex justify-between items-center w-full text-left hover:border-brand", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx(TokenLogo, { token: APE, size: 41 }), _jsxs("div", { children: [_jsx("div", { className: "font-bold", style: { fontSize: 16 }, children: "APE" }), _jsx(PriceChangeLine, { priceUsd: apeUsd, change24h: apeChange })] })] }), _jsxs("div", { className: "text-right", children: [_jsx("div", { className: "font-bold", style: { fontSize: 16 }, children: ape.toLocaleString(undefined, { maximumFractionDigits: 3 }) }), _jsxs("div", { className: "text-ink-faint font-bold", style: { fontSize: 13 }, children: ["$", apeValue.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })] })] })] }), nonZero.map((t) => {
                                                const tm = {
                                                    symbol: t.token.symbol,
                                                    name: t.token.name,
                                                    address: safeChecksum(t.token.address),
                                                    decimals: t.token.decimals,
                                                };
                                                const k = t.token.address.toLowerCase();
                                                const stat = tokenStats[k];
                                                const bal = parseFloat(t.balance);
                                                const value = (stat?.priceUsd ?? 0) * bal;
                                                return (_jsxs("button", { onClick: () => nav(`/token/${encodeURIComponent(t.token.address)}`), className: "card flex justify-between items-center w-full text-left hover:border-brand", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx(TokenLogo, { token: tm, size: 41 }), _jsxs("div", { children: [_jsx("div", { className: "font-bold", style: { fontSize: 16 }, children: t.token.symbol }), _jsx(PriceChangeLine, { priceUsd: stat?.priceUsd ?? 0, change24h: stat?.priceChange24h ?? null, fallback: shortAddress(t.token.address) })] })] }), _jsxs("div", { className: "text-right", children: [_jsx("div", { className: "font-bold", style: { fontSize: 16 }, children: bal.toLocaleString(undefined, { maximumFractionDigits: 3 }) }), _jsx("div", { className: "text-ink-faint font-bold", style: { fontSize: 13 }, children: stat?.priceUsd != null && stat.priceUsd > 0
                                                                        ? `$${value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`
                                                                        : '—' })] })] }, k));
                                            }), zero.length > 0 && (_jsxs("details", { className: "mt-2", children: [_jsxs("summary", { className: "text-xs text-white/80 cursor-pointer px-1 font-bold", children: [zero.length, " empty balance", zero.length === 1 ? '' : 's'] }), _jsx("div", { className: "space-y-2 mt-2", children: zero.map((t) => {
                                                            const tm = {
                                                                symbol: t.token.symbol,
                                                                name: t.token.name,
                                                                address: safeChecksum(t.token.address),
                                                                decimals: t.token.decimals,
                                                            };
                                                            return (_jsxs("div", { className: "card flex justify-between items-center opacity-80", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx(TokenLogo, { token: tm, size: 32 }), _jsxs("div", { children: [_jsx("div", { className: "font-bold text-sm", children: t.token.symbol }), _jsx("div", { className: "text-[11px] text-ink-faint font-bold", children: shortAddress(t.token.address) })] })] }), _jsx("button", { className: "text-xs text-ink-dim hover:text-danger font-bold", onClick: (e) => { e.stopPropagation(); void untrackToken(t.token.address); }, children: "Hide" })] }, t.token.address));
                                                        }) })] })), !loading && tokens.length === 0 && (_jsx("div", { className: "text-center text-xs text-white/85 py-4 font-bold", children: "No tracked ERC-20 tokens. Tap + to add one." }))] })) : (_jsx(NftGrid, { nfts: nfts, loading: nftsLoading, loaded: nftsLoaded }))] })] })] }), _jsx(BottomNav, {})] }));
}
function ActionBtn({ to, icon, label, rotate = 0, iconSize = 28, }) {
    return (_jsxs(Link, { to: to, "aria-label": label, className: "aspect-square flex flex-col items-center justify-center gap-1 rounded-2xl bg-[#3a87b8]/55 hover:bg-[#3a87b8]/75 transition", children: [_jsx("span", { role: "img", "aria-hidden": true, className: "block", style: {
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
                } }), _jsx("span", { className: "text-[11px] font-bold text-white", children: label })] }));
}
function PriceChangeLine({ priceUsd, change24h, fallback, }) {
    if (priceUsd > 0) {
        const priceStr = priceUsd >= 1
            ? priceUsd.toLocaleString(undefined, { maximumFractionDigits: 4 })
            : priceUsd < 0.0001
                ? priceUsd.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')
                : priceUsd.toFixed(4);
        return (_jsxs("div", { className: "flex items-center gap-2 font-bold", style: { fontSize: 13 }, children: [_jsxs("span", { className: "text-ink-faint", children: ["$", priceStr] }), change24h != null && (_jsxs("span", { className: change24h >= 0 ? 'text-success' : 'text-danger', children: [change24h >= 0 ? '+' : '', change24h.toFixed(2), "%"] }))] }));
    }
    return _jsx("div", { className: "text-ink-faint font-bold", style: { fontSize: 13 }, children: fallback ?? '—' });
}
function NftGrid({ nfts, loading, loaded }) {
    if (loading) {
        return _jsx("div", { className: "text-center text-white/85 text-sm py-6 font-bold", children: "Loading NFTs\u2026" });
    }
    if (loaded && nfts.length === 0) {
        return _jsx("div", { className: "text-center text-white/85 text-sm py-6 font-bold", children: "No NFTs found on ApeChain." });
    }
    return (_jsx("div", { className: "grid grid-cols-3 gap-2", children: nfts.map((n) => (_jsx("a", { href: `https://apescan.io/nft/${n.contract}/${n.tokenId}`, target: "_blank", rel: "noreferrer", className: "aspect-square rounded-xl bg-bg-card border border-line overflow-hidden flex items-center justify-center hover:border-brand transition", title: n.name ?? `${n.contractName ?? n.contractSymbol ?? 'NFT'} #${n.tokenId}`, children: n.image ? (_jsx("img", { src: n.image, alt: n.name ?? n.tokenId, className: "w-full h-full object-cover", onError: (e) => { e.currentTarget.style.display = 'none'; } })) : (_jsxs("div", { className: "text-center px-1", children: [_jsx("div", { className: "text-[11px] font-bold text-ink truncate", children: n.contractSymbol ?? n.contractName ?? 'NFT' }), _jsxs("div", { className: "text-[10px] text-ink-faint font-bold", children: ["#", n.tokenId.length > 6 ? `${n.tokenId.slice(0, 6)}…` : n.tokenId] })] })) }, `${n.contract}:${n.tokenId}`))) }));
}
