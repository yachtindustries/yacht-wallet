import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { BottomNav, Page, Screen, TopBar } from '../components/Layout';
import { TokenLogo } from '../components/TokenLogo';
import { useApp } from '../store';
import { rpc } from '@/lib/messaging';
import { NETWORKS } from '@/lib/networks';
import { shortAddress } from '@/lib/wallet-utils';
import { APE, safeChecksum } from '@/lib/tokens';
import { TRADING_FEE_TREASURY } from '@/lib/constants';
import { YACHT_CHAT_INBOX } from '@/lib/chat';
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
const FILTERS = [
    { key: 'all', label: 'All' },
    { key: 'send', label: 'Send' },
    { key: 'swap', label: 'Swap' },
    { key: 'receive', label: 'Receive' },
];
export default function History() {
    const { meta, settings } = useApp();
    const active = meta?.publicAccounts.find((a) => a.id === meta?.activeAccountId);
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState(null);
    const [filter, setFilter] = useState('all');
    useEffect(() => {
        if (!active)
            return;
        setLoading(true);
        setErr(null);
        rpc({ type: 'evm.history', address: active.address })
            .then((all) => {
            // Hide implementation-detail sends from the activity feed:
            //   • the trading-fee skim that accompanies every swap, and
            //   • chat-message sends to the on-chain chat inbox.
            const treasuryLc = TRADING_FEE_TREASURY.toLowerCase();
            const chatInboxLc = YACHT_CHAT_INBOX.toLowerCase();
            const filtered = all.filter((t) => {
                // Hide chat sends regardless of value/transfer count — the activity
                // feed lists trading actions, and chat lives in its own screen.
                if ((t.to ?? '').toLowerCase() === chatInboxLc)
                    return false;
                // Drop sends whose only outgoing transfer is to the treasury.
                if (t.type !== 'send')
                    return true;
                if (t.transfers.length !== 1)
                    return true;
                const tr = t.transfers[0];
                if (tr.direction !== 'out')
                    return true;
                return tr.to.toLowerCase() !== treasuryLc;
            });
            setItems(filtered);
        })
            .catch((e) => setErr(e.message))
            .finally(() => setLoading(false));
    }, [active?.address, settings?.network]);
    const explorer = NETWORKS[settings?.network ?? 'mainnet'].explorerTx;
    // Apply current type filter, then group by calendar day.
    const visible = items.filter((t) => filter === 'all' || t.type === filter);
    const grouped = [];
    for (const t of visible) {
        const ts = t.timestamp ? t.timestamp * 1000 : Date.now();
        const label = formatDayHeader(ts);
        const last = grouped[grouped.length - 1];
        if (last && last.dayLabel === label)
            last.entries.push(t);
        else
            grouped.push({ dayLabel: label, entries: [t] });
    }
    return (_jsxs(Screen, { children: [_jsx(TopBar, { title: "Activity", tone: "deck" }), _jsxs(Page, { tone: "deck", children: [_jsx("div", { className: "flex gap-2 mb-3", children: FILTERS.map((f) => {
                            const active = f.key === filter;
                            return (_jsx("button", { onClick: () => setFilter(f.key), className: `flex-1 py-1.5 rounded-lg font-bold transition ${active ? 'bg-white text-ink' : 'bg-bg-soft text-ink-dim hover:bg-white/40'}`, style: { fontSize: 14 }, children: f.label }, f.key));
                        }) }), loading && _jsx("div", { className: "text-ink-dim text-sm", children: "Loading\u2026" }), err && _jsx("div", { className: "text-danger text-xs", children: err }), !loading && visible.length === 0 && (_jsxs("div", { className: "text-center text-ink-dim text-sm mt-12", children: [_jsx("div", { className: "text-3xl mb-2", children: "\u2261" }), "No transactions yet."] })), _jsx("div", { className: "space-y-2", children: grouped.flatMap((g, gi) => [
                            _jsx("div", { className: "font-bold text-white uppercase tracking-wider px-1 mt-3 first:mt-0", style: { fontSize: 12 }, children: g.dayLabel }, `hdr-${gi}`),
                            ...g.entries.map((t) => {
                                const label = t.type === 'swap' ? 'Swap' :
                                    t.type === 'receive' ? 'Receive' :
                                        t.type === 'send' ? 'Send' :
                                            t.type === 'self' ? 'Self transfer' : 'Contract';
                                const incoming = t.transfers.filter((x) => x.direction === 'in' && parseFloat(x.amount) > 0);
                                const outgoing = t.transfers.filter((x) => x.direction === 'out' && parseFloat(x.amount) > 0);
                                const counterparty = t.type === 'send' || t.type === 'contract' ? t.to : t.from;
                                const { primary, secondary } = rowTokens(t);
                                return (_jsx("a", { href: explorer(t.hash), target: "_blank", rel: "noreferrer", className: "card hover:border-brand block", children: _jsxs("div", { className: "flex justify-between items-start gap-3", children: [_jsxs("div", { className: "flex items-start gap-3 min-w-0", children: [_jsxs("div", { className: "relative shrink-0", children: [_jsx(TokenLogo, { token: primary, size: 36 }), secondary && (_jsx("div", { className: "absolute -right-1.5 -bottom-1.5 rounded-full ring-2 ring-bg-card", children: _jsx(TokenLogo, { token: secondary, size: 20 }) }))] }), _jsxs("div", { className: "min-w-0", children: [_jsxs("div", { className: "font-semibold flex items-center gap-1.5", style: { fontSize: 17 }, children: [_jsx(ActionGlyph, { type: t.type }), _jsx("span", { children: label })] }), counterparty && (_jsx("div", { className: "text-ink-faint font-mono truncate", style: { fontSize: 13 }, children: t.type === 'receive' ? `from ${shortAddress(counterparty)}` : `to ${shortAddress(counterparty)}` })), _jsx("div", { className: "text-ink-faint mt-0.5", style: { fontSize: 12 }, children: t.timestamp ? new Date(t.timestamp * 1000).toLocaleString() : '' })] })] }), _jsxs("div", { className: "text-right shrink-0", children: [t.type === 'swap' ? (_jsxs(_Fragment, { children: [outgoing.map((x, i) => (_jsx(Amount, { t: x, sign: "-" }, `o${i}`))), incoming.map((x, i) => (_jsx(Amount, { t: x, sign: "+" }, `i${i}`)))] })) : t.transfers.length > 0 ? (t.transfers.map((x, i) => (_jsx(Amount, { t: x, sign: x.direction === 'in' ? '+' : x.direction === 'out' ? '-' : '' }, i)))) : (_jsx("div", { className: "font-bold text-ink-dim", style: { fontSize: 16 }, children: "\u2014" })), _jsxs("div", { className: "mt-0.5 flex items-center justify-end gap-1", style: { fontSize: 12 }, children: [_jsx("span", { className: t.status === 'success' ? 'text-ink-faint' : 'text-danger', children: t.status === 'success' ? 'Success' : t.status === 'failed' ? 'Failed' : 'Pending' }), t.status !== 'pending' && _jsx(StatusBadge, { ok: t.status === 'success', sizeEm: 1.1 })] })] })] }) }, t.hash));
                            }),
                        ]) })] }), _jsx(BottomNav, {})] }));
}
function formatDayHeader(ms) {
    const d = new Date(ms);
    const today = new Date();
    const yest = new Date(today);
    yest.setDate(today.getDate() - 1);
    const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (sameDay(d, today))
        return 'Today';
    if (sameDay(d, yest))
        return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}
const activitySuccessUrl = chrome.runtime.getURL('activity-success.png');
function StatusBadge({ ok, sizeEm }) {
    if (ok) {
        return (_jsx("img", { src: activitySuccessUrl, alt: "Success", className: "inline-block", style: { width: `${sizeEm}em`, height: `${sizeEm}em` }, "aria-hidden": true }));
    }
    return (_jsx("span", { className: "inline-flex items-center justify-center rounded-full text-white font-bold leading-none", style: {
            width: `${sizeEm}em`,
            height: `${sizeEm}em`,
            backgroundColor: '#dc2626',
            fontSize: `${0.7 * sizeEm}em`,
        }, "aria-hidden": true, children: "\u2717" }));
}
function Amount({ t, sign }) {
    const symbol = t.native ? 'APE' : (t.tokenSymbol ?? 'TOKEN');
    const amount = parseFloat(t.amount).toLocaleString(undefined, { maximumFractionDigits: 3 });
    const color = sign === '+' ? 'text-success' : sign === '-' ? 'text-danger' : 'text-ink';
    return (_jsxs("div", { className: `font-bold ${color}`, style: { fontSize: 16 }, children: [sign, amount, " ", symbol] }));
}
