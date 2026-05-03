import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Page, Screen, TopBar } from '../components/Layout';
import { useApp } from '../store';
import { rpc } from '@/lib/messaging';
import { shortAddress } from '@/lib/wallet-utils';
import { CopyButton } from '../components/Copy';
const settingsIconUrl = chrome.runtime.getURL('public/actions/settings.png');
export default function Accounts() {
    const nav = useNavigate();
    const { meta, refreshStatus, lock } = useApp();
    const [mode, setMode] = useState('list');
    const [name, setName] = useState('');
    const [secret, setSecret] = useState('');
    const [revealId, setRevealId] = useState(null);
    const [revealPw, setRevealPw] = useState('');
    const [revealedPk, setRevealedPk] = useState(null);
    const [revealedMnemonic, setRevealedMnemonic] = useState(null);
    const [err, setErr] = useState(null);
    const [busy, setBusy] = useState(false);
    // Auto-clear revealed secrets after 60s of inactivity, on tab blur, and on
    // unmount. JS strings can't be securely zeroed; this just shrinks the
    // window during which the secret sits in popup memory.
    useEffect(() => {
        if (!revealedPk && !revealedMnemonic)
            return;
        const clear = () => { setRevealedPk(null); setRevealedMnemonic(null); };
        const timer = window.setTimeout(clear, 60_000);
        window.addEventListener('blur', clear);
        return () => {
            window.clearTimeout(timer);
            window.removeEventListener('blur', clear);
        };
    }, [revealedPk, revealedMnemonic]);
    async function activate(id) {
        await rpc({ type: 'vault.account.activate', id });
        await refreshStatus();
        nav('/');
    }
    async function add() {
        setErr(null);
        setBusy(true);
        try {
            if (mode === 'add-derived') {
                await rpc({ type: 'vault.account.add.derived', name: name || undefined });
            }
            else if (mode === 'add-pk') {
                const trimmed = secret.trim();
                const pk = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
                if (!/^0x[0-9a-fA-F]{64}$/.test(pk))
                    throw new Error('Private key must be 32 bytes (64 hex chars)');
                await rpc({ type: 'vault.account.add.privateKey', name: name || undefined, privateKey: pk });
            }
            setName('');
            setSecret('');
            setMode('list');
            await refreshStatus();
        }
        catch (e) {
            setErr(e.message);
        }
        finally {
            setBusy(false);
        }
    }
    async function revealPk() {
        if (!revealId)
            return;
        setErr(null);
        setBusy(true);
        try {
            const r = await rpc({ type: 'vault.account.reveal', id: revealId, password: revealPw });
            setRevealedPk(r.privateKey);
        }
        catch {
            setErr('Incorrect password');
        }
        finally {
            setBusy(false);
        }
    }
    async function revealMnemonic() {
        setErr(null);
        setBusy(true);
        try {
            const r = await rpc({ type: 'vault.mnemonic.reveal', password: revealPw });
            if (!r.mnemonic)
                throw new Error('No HD recovery phrase — all accounts were imported.');
            setRevealedMnemonic(r.mnemonic);
        }
        catch (e) {
            setErr(e.message || 'Incorrect password');
        }
        finally {
            setBusy(false);
        }
    }
    return (_jsxs(Screen, { children: [_jsx(TopBar, { title: "Accounts", right: _jsx("button", { onClick: () => nav('/settings'), "aria-label": "Settings", className: "hover:opacity-80", children: _jsx("span", { role: "img", "aria-hidden": true, className: "block", style: {
                            width: 24,
                            height: 24,
                            backgroundColor: '#ffffff',
                            WebkitMaskImage: `url(${settingsIconUrl})`,
                            maskImage: `url(${settingsIconUrl})`,
                            WebkitMaskRepeat: 'no-repeat',
                            maskRepeat: 'no-repeat',
                            WebkitMaskPosition: 'center',
                            maskPosition: 'center',
                            WebkitMaskSize: 'contain',
                            maskSize: 'contain',
                        } }) }) }), _jsxs(Page, { children: [mode === 'list' && (_jsxs(_Fragment, { children: [_jsx("div", { className: "space-y-2", children: meta?.publicAccounts.map((a) => (_jsxs("div", { className: `card flex justify-between items-center gap-2 ${a.id === meta.activeAccountId ? 'border-brand' : ''}`, children: [_jsxs("button", { className: "text-left flex-1 min-w-0", onClick: () => activate(a.id), children: [_jsx("div", { className: "font-bold", style: { fontSize: 17 }, children: a.name }), _jsxs("div", { className: "flex items-center gap-1.5", children: [_jsx("span", { className: "text-ink-faint font-mono truncate", style: { fontSize: 13 }, children: shortAddress(a.address) }), _jsx(AddressCopy, { address: a.address })] })] }), _jsx("button", { className: "text-ink-dim hover:text-ink font-bold", style: { fontSize: 14 }, onClick: () => {
                                                setRevealId(a.id);
                                                setMode('reveal-pk');
                                                setRevealPw('');
                                                setRevealedPk(null);
                                                setErr(null);
                                            }, children: "Reveal key" })] }, a.id))) }), _jsxs("div", { className: "grid grid-cols-2 gap-2 mt-4", children: [_jsxs("button", { className: "btn-ghost flex-col py-3", onClick: () => setMode('add-derived'), children: [_jsx("span", { style: { fontSize: 20 }, children: "+" }), _jsx("span", { style: { fontSize: 14 }, children: "New account" })] }), _jsxs("button", { className: "btn-ghost flex-col py-3", onClick: () => setMode('add-pk'), children: [_jsx("span", { style: { fontSize: 20 }, children: "\u21A7" }), _jsx("span", { style: { fontSize: 14 }, children: "Import private key" })] })] }), _jsxs("div", { className: "mt-6 space-y-2", children: [_jsx("button", { onClick: () => {
                                            setMode('reveal-mnemonic');
                                            setRevealPw('');
                                            setRevealedMnemonic(null);
                                            setErr(null);
                                        }, className: "btn w-full font-bold text-white", style: { backgroundColor: '#f6c87e' }, children: "Seed Phrase" }), _jsx("button", { onClick: lock, className: "btn w-full font-bold text-black bg-white", children: "Lock Wallet" })] })] })), (mode === 'add-derived' || mode === 'add-pk') && (_jsxs(_Fragment, { children: [_jsx("h3", { className: "font-bold mb-3", style: { fontSize: 17 }, children: mode === 'add-derived' ? 'New derived account' : 'Import private key' }), _jsx("label", { className: "label", children: "Account name (optional)" }), _jsx("input", { className: "input", value: name, onChange: (e) => setName(e.target.value), placeholder: "My account" }), mode === 'add-pk' && (_jsxs(_Fragment, { children: [_jsx("label", { className: "label mt-3", children: "Private key" }), _jsx("textarea", { className: "input min-h-[80px] font-mono text-xs", value: secret, onChange: (e) => setSecret(e.target.value), placeholder: "0x\u2026" })] })), mode === 'add-derived' && (_jsx("p", { className: "text-[11px] text-ink-faint mt-2", children: "Derives a new account from your existing recovery phrase at the next standard Ethereum HD path (m/44'/60'/0'/0/N)." })), err && _jsx("div", { className: "text-danger text-xs mt-2", children: err }), _jsxs("div", { className: "flex gap-2 mt-4", children: [_jsx("button", { className: "btn-ghost flex-1", onClick: () => setMode('list'), children: "Cancel" }), _jsx("button", { className: "btn-primary flex-1", disabled: busy, onClick: add, children: busy ? 'Adding…' : 'Add' })] })] })), mode === 'reveal-pk' && (_jsxs(_Fragment, { children: [_jsx("h3", { className: "font-bold mb-1", style: { fontSize: 17 }, children: "Reveal private key" }), _jsx("p", { className: "text-ink-dim mb-3", style: { fontSize: 14 }, children: "Enter your password to view this account's private key. Never share it." }), !revealedPk ? (_jsxs(_Fragment, { children: [_jsx("input", { className: "input", type: "password", autoComplete: "current-password", spellCheck: false, value: revealPw, onChange: (e) => setRevealPw(e.target.value), placeholder: "Wallet password" }), err && _jsx("div", { className: "text-danger text-xs mt-2", children: err }), _jsxs("div", { className: "flex gap-2 mt-4", children: [_jsx("button", { className: "btn-ghost flex-1", onClick: () => setMode('list'), children: "Cancel" }), _jsx("button", { className: "btn-primary flex-1", disabled: busy, onClick: revealPk, children: busy ? 'Verifying…' : 'Reveal' })] })] })) : (_jsxs(_Fragment, { children: [_jsx("div", { className: "card font-mono text-xs break-all select-all", children: revealedPk }), _jsx("div", { className: "text-center mt-2", children: _jsx(CopyButton, { text: revealedPk, label: "Copy private key", clearAfterMs: 60_000 }) }), _jsx("button", { className: "btn-ghost w-full mt-3", onClick: () => setMode('list'), children: "Done" })] }))] })), mode === 'reveal-mnemonic' && (_jsxs(_Fragment, { children: [_jsx("h3", { className: "font-bold mb-1", style: { fontSize: 17 }, children: "Reveal recovery phrase" }), _jsx("p", { className: "text-ink-dim mb-3", style: { fontSize: 14 }, children: "The recovery phrase derives every account in this wallet. Whoever holds it can spend all your funds." }), !revealedMnemonic ? (_jsxs(_Fragment, { children: [_jsx("input", { className: "input", type: "password", autoComplete: "current-password", spellCheck: false, value: revealPw, onChange: (e) => setRevealPw(e.target.value), placeholder: "Wallet password" }), err && _jsx("div", { className: "text-danger text-xs mt-2", children: err }), _jsxs("div", { className: "flex gap-2 mt-4", children: [_jsx("button", { className: "btn-ghost flex-1", onClick: () => setMode('list'), children: "Cancel" }), _jsx("button", { className: "btn-primary flex-1", disabled: busy, onClick: revealMnemonic, children: busy ? 'Verifying…' : 'Reveal' })] })] })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "card", children: [_jsx("div", { className: "grid grid-cols-3 gap-2", children: revealedMnemonic.split(/\s+/).map((w, i) => (_jsxs("div", { className: "bg-bg-soft border border-line rounded-lg px-2 py-1.5 text-xs", children: [_jsxs("span", { className: "text-ink-faint mr-1", children: [i + 1, "."] }), _jsx("span", { className: "font-mono", children: w })] }, i))) }), _jsx("div", { className: "text-center mt-3", children: _jsx(CopyButton, { text: revealedMnemonic, label: "Copy phrase", clearAfterMs: 60_000 }) })] }), _jsx("button", { className: "btn-ghost w-full mt-3", onClick: () => setMode('list'), children: "Done" })] }))] }))] })] }));
}
function AddressCopy({ address }) {
    const [copied, setCopied] = useState(false);
    return (_jsx("button", { onClick: async (e) => {
            e.stopPropagation();
            await navigator.clipboard.writeText(address);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
        }, title: copied ? 'Copied!' : 'Copy address', "aria-label": "Copy address", className: "text-ink-dim hover:text-brand shrink-0", style: { fontSize: 18 }, children: copied ? '✓' : '⧉' }));
}
