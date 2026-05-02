import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { BottomNav, Page, Screen, TopBar } from '../components/Layout';
import { TokenLogo } from '../components/TokenLogo';
import { useApp } from '../store';
import { rpc } from '@/lib/messaging';
import { NETWORKS } from '@/lib/networks';
import { shortAddress } from '@/lib/wallet-utils';
import { APE, safeChecksum } from '@/lib/tokens';
const arrowIcon = chrome.runtime.getURL('public/actions/sendreceive.png');
const swapIcon = chrome.runtime.getURL('public/actions/swap.png');
function transferToken(t) {
    if (t.native)
        return APE;
    return {
        symbol: t.tokenSymbol ?? 'TOKEN',
        name: t.tokenSymbol ?? 'Token',
        address: t.tokenAddress ? safeChecksum(t.tokenAddress) : '',
        decimals: t.tokenDecimals ?? 18,
    };
}
function rowTokens(t) {
    // Pick the most informative token(s) for the row icon.
    if (t.type === 'swap') {
        const out = t.transfers.find((x) => x.direction === 'out' && parseFloat(x.amount) > 0);
        const inn = t.transfers.find((x) => x.direction === 'in' && parseFloat(x.amount) > 0);
        return {
            primary: out ? transferToken(out) : APE,
            secondary: inn ? transferToken(inn) : undefined,
        };
    }
    if (t.type === 'receive') {
        const inn = t.transfers.find((x) => x.direction === 'in' && parseFloat(x.amount) > 0);
        return { primary: inn ? transferToken(inn) : APE };
    }
    if (t.type === 'send') {
        const out = t.transfers.find((x) => x.direction === 'out' && parseFloat(x.amount) > 0);
        return { primary: out ? transferToken(out) : APE };
    }
    // self / contract: prefer first non-zero transfer, else APE.
    const any = t.transfers.find((x) => parseFloat(x.amount) > 0);
    return { primary: any ? transferToken(any) : APE };
}
function ActionGlyph({ type }) {
    const isSwap = type === 'swap' || type === 'self';
    const url = isSwap ? swapIcon : arrowIcon;
    const rotate = type === 'receive' ? 180 : 0;
    return (_jsx("span", { role: "img", "aria-hidden": true, className: "block w-3.5 h-3.5", style: {
            backgroundColor: '#6b4423',
            WebkitMaskImage: `url(${url})`,
            maskImage: `url(${url})`,
            WebkitMaskRepeat: 'no-repeat',
            maskRepeat: 'no-repeat',
            WebkitMaskPosition: 'center',
            maskPosition: 'center',
            WebkitMaskSize: 'contain',
            maskSize: 'contain',
            transform: rotate ? `rotate(${rotate}deg)` : undefined,
        } }));
}
export default function History() {
    const { meta, settings } = useApp();
    const active = meta?.publicAccounts.find((a) => a.id === meta?.activeAccountId);
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState(null);
    useEffect(() => {
        if (!active)
            return;
        setLoading(true);
        setErr(null);
        rpc({ type: 'evm.history', address: active.address })
            .then(setItems)
            .catch((e) => setErr(e.message))
            .finally(() => setLoading(false));
    }, [active?.address, settings?.network]);
    const explorer = NETWORKS[settings?.network ?? 'mainnet'].explorerTx;
    return (_jsxs(Screen, { children: [_jsx(TopBar, { title: "Activity", tone: "deck" }), _jsxs(Page, { tone: "deck", children: [loading && _jsx("div", { className: "text-ink-dim text-sm", children: "Loading\u2026" }), err && _jsx("div", { className: "text-danger text-xs", children: err }), !loading && items.length === 0 && (_jsxs("div", { className: "text-center text-ink-dim text-sm mt-12", children: [_jsx("div", { className: "text-3xl mb-2", children: "\u2261" }), "No transactions yet."] })), _jsx("div", { className: "space-y-2", children: items.map((t) => {
                            const label = t.type === 'swap' ? 'Swap' :
                                t.type === 'receive' ? 'Receive' :
                                    t.type === 'send' ? 'Send' :
                                        t.type === 'self' ? 'Self transfer' : 'Contract';
                            const incoming = t.transfers.filter((x) => x.direction === 'in' && parseFloat(x.amount) > 0);
                            const outgoing = t.transfers.filter((x) => x.direction === 'out' && parseFloat(x.amount) > 0);
                            const counterparty = t.type === 'send' || t.type === 'contract' ? t.to : t.from;
                            const { primary, secondary } = rowTokens(t);
                            return (_jsx("a", { href: explorer(t.hash), target: "_blank", rel: "noreferrer", className: "card hover:border-brand block", children: _jsxs("div", { className: "flex justify-between items-start gap-3", children: [_jsxs("div", { className: "flex items-start gap-3 min-w-0", children: [_jsxs("div", { className: "relative shrink-0", children: [_jsx(TokenLogo, { token: primary, size: 36 }), secondary && (_jsx("div", { className: "absolute -right-1.5 -bottom-1.5 rounded-full ring-2 ring-bg-card", children: _jsx(TokenLogo, { token: secondary, size: 20 }) }))] }), _jsxs("div", { className: "min-w-0", children: [_jsxs("div", { className: "text-sm font-semibold flex items-center gap-1.5", children: [_jsx(ActionGlyph, { type: t.type }), _jsx("span", { children: label })] }), counterparty && (_jsx("div", { className: "text-[11px] text-ink-faint font-mono truncate", children: t.type === 'receive' ? `from ${shortAddress(counterparty)}` : `to ${shortAddress(counterparty)}` })), _jsx("div", { className: "text-[10px] text-ink-faint mt-0.5", children: t.timestamp ? new Date(t.timestamp * 1000).toLocaleString() : '' })] })] }), _jsxs("div", { className: "text-right shrink-0", children: [t.type === 'swap' ? (_jsxs(_Fragment, { children: [outgoing.map((x, i) => (_jsx(Amount, { t: x, sign: "-" }, `o${i}`))), incoming.map((x, i) => (_jsx(Amount, { t: x, sign: "+" }, `i${i}`)))] })) : t.transfers.length > 0 ? (t.transfers.map((x, i) => (_jsx(Amount, { t: x, sign: x.direction === 'in' ? '+' : x.direction === 'out' ? '-' : '' }, i)))) : (_jsx("div", { className: "text-sm font-mono text-ink-dim", children: "\u2014" })), _jsxs("div", { className: "text-[10px] mt-0.5 flex items-center justify-end gap-1", children: [_jsx("span", { className: t.status === 'success' ? 'text-ink-faint' : 'text-danger', children: t.status === 'success' ? 'Success' : t.status === 'failed' ? 'Failed' : 'Pending' }), t.status !== 'pending' && _jsx(StatusBadge, { ok: t.status === 'success', sizeEm: 2 })] })] })] }) }, t.hash));
                        }) })] }), _jsx(BottomNav, {})] }));
}
function StatusBadge({ ok, sizeEm }) {
    return (_jsx("span", { className: "inline-flex items-center justify-center rounded-full text-white font-bold leading-none", style: {
            width: `${sizeEm}em`,
            height: `${sizeEm}em`,
            backgroundColor: ok ? '#16a34a' : '#dc2626',
            fontSize: `${0.7 * sizeEm}em`,
        }, "aria-hidden": true, children: ok ? '✓' : '✗' }));
}
function Amount({ t, sign }) {
    const symbol = t.native ? 'APE' : (t.tokenSymbol ?? 'TOKEN');
    const amount = parseFloat(t.amount).toLocaleString(undefined, { maximumFractionDigits: 3 });
    const color = sign === '+' ? 'text-success' : sign === '-' ? 'text-danger' : 'text-ink';
    return (_jsxs("div", { className: `text-sm font-mono ${color}`, children: [sign, amount, " ", symbol] }));
}
