import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen, TopBar, Page } from '../components/Layout';
import { PasswordField } from '../components/PasswordField';
import { rpc } from '@/lib/messaging';
import { passwordStrength } from '@/lib/security';
import { isValidMnemonic } from '@/lib/wallet-utils';
import { useApp } from '../store';
const MIN_PASSWORD_LEN = 12;
export default function ImportWallet() {
    const nav = useNavigate();
    const { refreshStatus } = useApp();
    const [mode, setMode] = useState('mnemonic');
    const [secret, setSecret] = useState('');
    const [pw, setPw] = useState('');
    const [pw2, setPw2] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState(null);
    async function go() {
        setErr(null);
        setBusy(true);
        try {
            if (mode === 'mnemonic') {
                if (!isValidMnemonic(secret.trim()))
                    throw new Error('Invalid recovery phrase');
                await rpc({ type: 'vault.create.mnemonic', password: pw, mnemonic: secret.trim() });
            }
            else {
                const trimmed = secret.trim();
                const pk = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
                if (!/^0x[0-9a-fA-F]{64}$/.test(pk))
                    throw new Error('Private key must be 32 bytes (64 hex chars)');
                await rpc({ type: 'vault.create.privateKey', password: pw, privateKey: pk });
            }
            await refreshStatus();
            nav('/');
        }
        catch (e) {
            setErr(e.message);
        }
        finally {
            setBusy(false);
        }
    }
    const validInput = mode === 'mnemonic' ? secret.trim().split(/\s+/).length >= 12 : secret.trim().length >= 64;
    return (_jsxs(Screen, { children: [_jsx(TopBar, { title: "Import wallet", onBack: () => nav('/') }), _jsxs(Page, { children: [_jsxs("div", { className: "grid grid-cols-2 gap-2 mb-3", children: [_jsx("button", { onClick: () => setMode('mnemonic'), className: `py-2 rounded-xl border text-sm ${mode === 'mnemonic' ? 'border-brand bg-brand/10 text-brand' : 'border-line bg-bg-soft text-ink-dim'}`, children: "Recovery phrase" }), _jsx("button", { onClick: () => setMode('privateKey'), className: `py-2 rounded-xl border text-sm ${mode === 'privateKey' ? 'border-brand bg-brand/10 text-brand' : 'border-line bg-bg-soft text-ink-dim'}`, children: "Private key" })] }), _jsx("label", { className: "label", children: mode === 'mnemonic' ? '12 / 24-word recovery phrase' : 'Private key (0x…)' }), _jsx("textarea", { className: "input min-h-[80px] font-mono text-xs", value: secret, onChange: (e) => setSecret(e.target.value), placeholder: mode === 'mnemonic' ? 'word1 word2 word3 …' : '0x…' }), _jsx("p", { className: "text-[11px] text-ink-faint mt-2", children: mode === 'mnemonic'
                            ? 'Standard BIP-39 phrase. Compatible with MetaMask, Rabby, Rainbow.'
                            : 'Hex-encoded EVM private key. Imported accounts cannot derive new accounts.' }), _jsx("label", { className: "label mt-3", children: "Wallet password" }), _jsx(PasswordField, { value: pw, onChange: setPw, showStrength: true }), _jsx("label", { className: "label mt-3", children: "Confirm password" }), _jsx("input", { className: "input", type: "password", value: pw2, onChange: (e) => setPw2(e.target.value) }), err && _jsx("div", { className: "text-danger text-xs mt-2", children: err }), _jsx("button", { className: "btn-primary w-full mt-4", disabled: busy || !validInput || pw.length < MIN_PASSWORD_LEN || passwordStrength(pw).score < 2 || pw !== pw2, onClick: go, children: busy ? 'Importing…' : 'Import' })] })] }));
}
