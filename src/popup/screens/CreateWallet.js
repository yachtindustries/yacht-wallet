import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen, TopBar, Page } from '../components/Layout';
import { PasswordField } from '../components/PasswordField';
import { CopyButton } from '../components/Copy';
import { rpc } from '@/lib/messaging';
import { passwordStrength } from '@/lib/security';
import { useApp } from '../store';
const MIN_PASSWORD_LEN = 12;
export default function CreateWallet() {
    const nav = useNavigate();
    const { refreshStatus, setBackupNotice } = useApp();
    const [step, setStep] = useState('password');
    const [pw, setPw] = useState('');
    const [pw2, setPw2] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState(null);
    const [mnemonic, setMnemonic] = useState(null);
    const [acknowledged, setAcknowledged] = useState(false);
    async function createWallet() {
        setErr(null);
        setBusy(true);
        try {
            const r = await rpc({ type: 'vault.create.new', password: pw });
            setMnemonic(r.mnemonic);
            setStep('showSeed');
        }
        catch (e) {
            setErr(e.message);
        }
        finally {
            setBusy(false);
        }
    }
    async function finalize() {
        setBackupNotice(true);
        await refreshStatus();
        nav('/');
    }
    const strength = passwordStrength(pw).score;
    const tooShort = pw.length < MIN_PASSWORD_LEN;
    const tooWeak = strength < 2;
    const mismatch = pw !== pw2;
    const disabled = busy || tooShort || tooWeak || mismatch;
    if (step === 'password') {
        return (_jsxs(Screen, { children: [_jsx(TopBar, { title: "Create wallet", onBack: () => nav('/') }), _jsxs(Page, { children: [_jsx("h2", { className: "text-lg font-semibold mb-4", children: "Set a password" }), _jsx("p", { className: "text-xs text-ink-dim mb-3", children: "This password encrypts your recovery phrase on this device. Yacht never stores or transmits it." }), _jsx("label", { className: "label", children: "Password" }), _jsx("div", { className: "mb-3", children: _jsx(PasswordField, { value: pw, onChange: setPw, autoFocus: true, showStrength: true }) }), _jsx("label", { className: "label", children: "Confirm password" }), _jsx("input", { className: "input mb-4", type: "password", autoComplete: "new-password", spellCheck: false, value: pw2, onChange: (e) => setPw2(e.target.value) }), err && _jsx("div", { className: "text-danger text-xs mb-2", children: err }), _jsx("button", { className: "btn-primary w-full", disabled: disabled, onClick: createWallet, children: busy ? 'Creating…' : 'Continue' })] })] }));
    }
    if (step === 'showSeed' && mnemonic) {
        const words = mnemonic.split(/\s+/);
        return (_jsxs(Screen, { children: [_jsx(TopBar, { title: "Backup phrase", onBack: () => setStep('password') }), _jsxs(Page, { children: [_jsx("div", { className: "card border-warn/30 bg-warn/5 mb-3 text-xs text-warn", children: "\u26A0 This 12-word phrase is the ONLY way to recover your wallet. Write it down on paper and store it safely. Anyone with this phrase can spend your funds." }), _jsxs("div", { className: "card mb-3", children: [_jsx("div", { className: "grid grid-cols-3 gap-2", children: words.map((w, i) => (_jsxs("div", { className: "bg-bg-soft border border-line rounded-lg px-2 py-1.5 text-xs", children: [_jsxs("span", { className: "text-ink-faint mr-1", children: [i + 1, "."] }), _jsx("span", { className: "font-mono", children: w })] }, i))) }), _jsx("div", { className: "text-center mt-3", children: _jsx(CopyButton, { text: mnemonic, label: "Copy phrase", clearAfterMs: 60_000 }) })] }), _jsxs("label", { className: "flex items-start gap-2 text-xs text-ink-dim mt-2 mb-3 cursor-pointer", children: [_jsx("input", { type: "checkbox", checked: acknowledged, onChange: (e) => setAcknowledged(e.target.checked), className: "mt-0.5" }), _jsx("span", { children: "I have saved my recovery phrase. I understand Yacht cannot recover it for me." })] }), _jsx("button", { className: "btn-primary w-full", disabled: !acknowledged, onClick: finalize, children: "Open wallet" })] })] }));
    }
    return null;
}
