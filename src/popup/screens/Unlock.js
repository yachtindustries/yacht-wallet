import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Screen } from '../components/Layout';
import { rpc } from '@/lib/messaging';
import { useApp } from '../store';
const logoUrl = chrome.runtime.getURL('yacht-icon.png');
export default function Unlock() {
    const { refreshStatus } = useApp();
    const [pw, setPw] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState(null);
    async function unlock(e) {
        e.preventDefault();
        setErr(null);
        setBusy(true);
        try {
            await rpc({ type: 'vault.unlock', password: pw });
            await refreshStatus();
        }
        catch (e2) {
            setErr(e2.message || 'Incorrect password');
        }
        finally {
            setBusy(false);
        }
    }
    return (_jsx(Screen, { children: _jsxs("form", { onSubmit: unlock, className: "flex flex-col h-full px-6 py-5", style: { backgroundColor: '#f6c87e' }, children: [_jsx("div", { className: "text-center", children: _jsx("h1", { className: "text-2xl font-bold tracking-tight text-white", children: "Yacht" }) }), _jsxs("div", { className: "flex-1 flex flex-col items-center", style: { paddingTop: '10%' }, children: [_jsx("img", { src: logoUrl, alt: "Yacht", className: "mb-6 object-contain", style: { width: 250, height: 250 } }), _jsx("input", { autoFocus: true, className: "w-full max-w-xs rounded-xl px-3 py-3 text-center font-bold bg-white text-ink placeholder:text-ink-faint border border-white focus:outline-none focus:ring-2 focus:ring-white", style: { fontSize: 17 }, type: "password", autoComplete: "current-password", spellCheck: false, value: pw, onChange: (e) => setPw(e.target.value), placeholder: "Password" }), err && _jsx("div", { className: "text-danger text-xs mt-2", children: err })] }), _jsx("button", { className: "w-full max-w-xs mx-auto rounded-xl px-3 py-3 text-center font-bold text-white bg-[#5eccfa] hover:bg-[#3eb8e8] disabled:opacity-100 flex items-center justify-center mb-[10%]", style: { fontSize: 17 }, disabled: busy || !pw, children: busy ? _jsx(Spinner, {}) : 'Unlock' })] }) }));
}
function Spinner() {
    return (_jsx("span", { className: "inline-block animate-spin rounded-full", style: {
            width: 22,
            height: 22,
            border: '3px solid rgba(255,255,255,0.45)',
            borderTopColor: '#ffffff',
        }, "aria-label": "Unlocking" }));
}
