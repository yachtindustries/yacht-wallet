import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Page, Screen, TopBar } from '../components/Layout';
import { useApp } from '../store';
import { rpc } from '@/lib/messaging';
function ResetWalletButton() {
    const [step, setStep] = useState('idle');
    const [pw, setPw] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState(null);
    if (step === 'idle') {
        return (_jsx("button", { className: "btn-danger w-full", onClick: () => setStep('confirm'), children: "Reset wallet" }));
    }
    return (_jsxs("div", { className: "card border-danger/30 bg-danger/5", children: [_jsx("div", { className: "text-sm font-semibold text-danger mb-2", children: "Reset wallet" }), _jsx("p", { className: "text-[11px] text-ink-dim mb-3", children: "This deletes all keys on this device. Make sure your recovery phrase is backed up. You will not be able to recover this wallet without it." }), _jsx("input", { className: "input mb-2", type: "password", placeholder: "Wallet password", value: pw, onChange: (e) => setPw(e.target.value) }), err && _jsx("div", { className: "text-danger text-xs mb-2", children: err }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { className: "btn-ghost flex-1", onClick: () => { setStep('idle'); setPw(''); setErr(null); }, children: "Cancel" }), _jsx("button", { className: "btn-danger flex-1", disabled: busy || !pw, onClick: async () => {
                            setBusy(true);
                            setErr(null);
                            try {
                                await rpc({ type: 'vault.destroy', password: pw });
                                location.reload();
                            }
                            catch (e) {
                                setErr(e.message);
                            }
                            finally {
                                setBusy(false);
                            }
                        }, children: busy ? 'Resetting…' : 'Reset wallet' })] })] }));
}
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
    return (_jsxs(Screen, { children: [_jsx(TopBar, { title: "Settings" }), _jsxs(Page, { children: [_jsxs("div", { className: "card mb-3", children: [_jsx("div", { className: "text-xs text-ink-dim mb-1", children: "Network" }), _jsx("div", { className: "text-sm", children: "ApeChain mainnet \u00B7 chain id 33139" }), _jsx("div", { className: "text-[11px] text-ink-faint mt-1", children: "RPC: rpc.apechain.com" })] }), _jsxs("div", { className: "card mb-3", children: [_jsx("div", { className: "text-xs text-ink-dim mb-2", children: "Auto-lock" }), _jsxs("select", { className: "input", value: settings.autoLockMinutes, onChange: (e) => setAutoLock(Number(e.target.value)), disabled: busy, children: [_jsx("option", { value: 0, children: "Never" }), _jsx("option", { value: 1, children: "1 minute" }), _jsx("option", { value: 5, children: "5 minutes" }), _jsx("option", { value: 15, children: "15 minutes" }), _jsx("option", { value: 60, children: "1 hour" })] })] }), _jsxs("div", { className: "card mb-3", children: [_jsx("div", { className: "text-xs text-ink-dim mb-2", children: "Display currency" }), _jsxs("select", { className: "input", value: settings.fiatCurrency, onChange: (e) => setFiat(e.target.value), disabled: busy, children: [_jsx("option", { value: "usd", children: "USD" }), _jsx("option", { value: "eur", children: "EUR" }), _jsx("option", { value: "gbp", children: "GBP" })] })] }), _jsxs(Link, { to: "/settings/sites", className: "card w-full flex items-center justify-between hover:border-brand mb-3", children: [_jsx("span", { className: "text-sm", children: "Connected sites" }), _jsx("span", { className: "text-ink-dim", children: "\u203A" })] }), _jsx("button", { className: "btn-ghost w-full mb-2", onClick: lock, children: "Lock wallet" }), _jsx(ResetWalletButton, {}), _jsx("p", { className: "text-[11px] text-ink-faint text-center mt-3", children: "Yacht v0.1.0" })] })] }));
}
