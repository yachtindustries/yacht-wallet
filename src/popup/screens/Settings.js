import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Page, Screen, TopBar } from '../components/Layout';
import { useApp } from '../store';
import { rpc } from '@/lib/messaging';
export default function Settings() {
    const { settings, refreshSettings, lock } = useApp();
    const [busy, setBusy] = useState(false);
    async function setAutoLock(autoLockMinutes) {
        setBusy(true);
        await rpc({ type: 'settings.set', settings: { autoLockMinutes } });
        await refreshSettings();
        setBusy(false);
    }
    async function setFiat(fiatCurrency) {
        setBusy(true);
        await rpc({ type: 'settings.set', settings: { fiatCurrency } });
        await refreshSettings();
        setBusy(false);
    }
    if (!settings)
        return null;
    // Tailwind's `appearance-none` strips the native dropdown arrow on
    // <select>. Used on every select in this menu.
    const selectClasses = 'w-full bg-bg-soft border border-line rounded-xl px-3 py-2.5 font-bold text-ink focus:outline-none focus:border-brand appearance-none';
    return (_jsxs(Screen, { children: [_jsx(TopBar, { title: "Settings" }), _jsxs(Page, { children: [_jsxs("div", { className: "card mb-3", children: [_jsx("div", { className: "text-ink-dim mb-1 font-bold", style: { fontSize: 15 }, children: "Network" }), _jsx("div", { className: "font-bold", style: { fontSize: 18 }, children: "ApeChain mainnet" }), _jsx("div", { className: "text-ink-faint mt-1 font-bold", style: { fontSize: 14 }, children: "RPC: rpc.apechain.com" })] }), _jsxs("div", { className: "card mb-3", children: [_jsx("div", { className: "text-ink-dim mb-2 font-bold", style: { fontSize: 15 }, children: "Auto-lock" }), _jsxs("select", { className: selectClasses, style: { fontSize: 16 }, value: settings.autoLockMinutes, onChange: (e) => setAutoLock(Number(e.target.value)), disabled: busy, children: [_jsx("option", { value: 0, children: "Never" }), _jsx("option", { value: 1, children: "1 minute" }), _jsx("option", { value: 5, children: "5 minutes" }), _jsx("option", { value: 15, children: "15 minutes" }), _jsx("option", { value: 60, children: "1 hour" })] })] }), _jsxs("div", { className: "card mb-3", children: [_jsx("div", { className: "text-ink-dim mb-2 font-bold", style: { fontSize: 15 }, children: "Display currency" }), _jsxs("select", { className: selectClasses, style: { fontSize: 16 }, value: settings.fiatCurrency, onChange: (e) => setFiat(e.target.value), disabled: busy, children: [_jsx("option", { value: "usd", children: "USD" }), _jsx("option", { value: "eur", children: "EUR" }), _jsx("option", { value: "gbp", children: "GBP" })] })] }), _jsx(Link, { to: "/settings/sites", className: "card w-full flex items-center hover:border-brand mb-3 font-bold", style: { fontSize: 18 }, children: "Connected sites" }), _jsx("button", { className: "btn w-full font-bold text-white", style: { backgroundColor: '#f6c87e' }, onClick: lock, children: "Lock wallet" }), _jsx("p", { className: "text-ink-faint text-center mt-3 font-bold", style: { fontSize: 14 }, children: "Yacht v0.1.0" })] })] }));
}
