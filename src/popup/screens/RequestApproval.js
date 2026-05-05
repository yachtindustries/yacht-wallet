import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { formatUnits } from 'ethers';
import { rpc } from '@/lib/messaging';
import { useApp } from '../store';
import { hostFromOrigin } from '@/lib/security';
import { checkHost } from '@/lib/phishing';
import { labelFor, lookupContract } from '@/lib/known-contracts';
export default function RequestApproval() {
    const { id } = useParams();
    const { meta, unlocked } = useApp();
    const [req, setReq] = useState(null);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState(null);
    useEffect(() => {
        if (!id)
            return;
        rpc({ type: 'request.get', id }).then(setReq);
    }, [id]);
    if (!id)
        return null;
    if (!unlocked) {
        return (_jsx("div", { className: "p-6 text-center text-sm text-ink-dim", children: "Unlock the wallet from the toolbar to approve this request." }));
    }
    if (!req)
        return _jsx("div", { className: "p-6 text-ink-dim", children: "Loading request\u2026" });
    const active = meta?.publicAccounts.find((a) => a.id === meta?.activeAccountId);
    const host = hostFromOrigin(req.origin);
    const verdict = checkHost(host);
    async function approve() {
        if (!req || !active)
            return;
        setBusy(true);
        setErr(null);
        try {
            // SECURITY: we send only the request ID. The background re-reads its
            // own copy of the pending payload and signs that — never the version
            // this popup is showing. So a compromised popup renderer can't make us
            // sign a different tx than what the user saw.
            await rpc({ type: 'request.approve', id: req.id });
            window.close();
        }
        catch (e) {
            setErr(e.message);
        }
        finally {
            setBusy(false);
        }
    }
    async function reject() {
        if (!req)
            return;
        await rpc({ type: 'request.reject', id: req.id, error: 'User rejected' });
        window.close();
    }
    return (_jsxs("div", { className: "p-4 flex flex-col h-full", style: { fontSize: 14 }, children: [_jsxs("div", { className: "text-center mb-3", children: [_jsx("div", { className: "text-ink-dim font-bold", style: { fontSize: 14 }, children: "Request from" }), _jsxs("div", { className: "font-bold break-all flex items-center justify-center gap-1", style: { fontSize: 17 }, children: [_jsx("span", { children: host || req.origin }), verdict.level === 'verified' && _jsx("span", { className: "text-success", style: { fontSize: 14 }, children: "\u2713" })] }), verdict.level === 'verified' && (_jsx("div", { className: "text-success mt-1 font-bold", style: { fontSize: 13 }, children: "Verified ApeChain app" })), verdict.level === 'known-bad' && (_jsx("div", { className: "mt-2 mx-auto inline-block px-3 py-2 rounded-md bg-danger/10 text-danger border border-danger/30 font-bold", style: { fontSize: 13 }, children: "\u26A0 This domain is on a known phishing list. REJECT this request." })), verdict.level === 'suspicious' && (_jsxs("div", { className: "mt-2 mx-auto px-3 py-2 rounded-md bg-warn/10 text-warn border border-warn/30 space-y-1", style: { fontSize: 13 }, children: [_jsx("div", { className: "font-bold", children: "\u26A0 Suspicious domain" }), verdict.reasons.map((r, i) => _jsxs("div", { children: ["\u2022 ", r] }, i))] }))] }), req.type === 'connect' && (_jsxs("div", { className: "card flex-1", children: [_jsx("h2", { className: "font-bold mb-2", style: { fontSize: 19 }, children: "Connect wallet" }), _jsx("p", { className: "text-ink-dim", style: { fontSize: 17 }, children: "This site is requesting your ApeChain address. It cannot move funds without a separate, explicit approval for each transaction." }), active && (_jsxs("div", { className: "mt-4 p-3 rounded-xl bg-bg-soft border border-line", children: [_jsx("div", { className: "text-ink-dim font-bold", style: { fontSize: 14 }, children: "Account" }), _jsx("div", { className: "font-bold", style: { fontSize: 17 }, children: active.name }), _jsx("div", { className: "font-mono text-ink-faint break-all", style: { fontSize: 13 }, children: active.address })] }))] })), req.type === 'signTx' && _jsx(SignTxPanel, { payload: req.payload }), req.type === 'personalSign' && _jsx(PersonalSignPanel, { payload: req.payload }), req.type === 'signTypedData' && _jsx(TypedDataPanel, { payload: req.payload }), err && _jsx("div", { className: "text-danger mt-2", style: { fontSize: 14 }, children: err }), _jsxs("div", { className: "flex gap-2 mt-3", children: [_jsx("button", { className: "btn-ghost flex-1 font-bold", style: { fontSize: 16 }, onClick: reject, disabled: busy, children: "Reject" }), _jsx("button", { className: "btn flex-1 text-white font-bold bg-[#5eccfa] hover:bg-[#3eb8e8] disabled:opacity-60", style: { fontSize: 16 }, onClick: approve, disabled: busy, children: busy ? 'Working…' : req.type === 'connect' ? 'Connect' : 'Approve' })] })] }));
}
function SignTxPanel({ payload }) {
    const p = payload;
    const tx = p.tx;
    const warnings = p.warnings ?? [];
    const labelFromData = p.dataAnalysis?.label;
    const valueWei = (() => {
        const v = tx.value;
        if (v == null)
            return 0n;
        try {
            if (typeof v === 'string')
                return v.startsWith('0x') ? BigInt(v) : BigInt(v);
            return BigInt(v);
        }
        catch {
            return 0n;
        }
    })();
    const valueApe = formatUnits(valueWei, 18);
    const hasData = typeof tx.data === 'string' && tx.data.length > 2 && tx.data !== '0x';
    const toLabel = labelFor(tx.to);
    const known = lookupContract(tx.to);
    return (_jsxs("div", { className: "card flex-1 overflow-y-auto", children: [_jsx("h2", { className: "font-bold mb-1", style: { fontSize: 19 }, children: labelFromData ?? (hasData ? 'Contract interaction' : 'Send APE') }), _jsx("div", { className: "text-ink-faint mb-3", style: { fontSize: 13 }, children: "Sign transaction" }), warnings.length > 0 && (_jsx("div", { className: "mb-3 p-2 rounded-lg bg-warn/10 border border-warn/30 text-warn space-y-1", style: { fontSize: 13 }, children: warnings.map((w, i) => _jsxs("div", { children: ["\u26A0 ", w] }, i)) })), p.simulation?.ok === false && (_jsxs("div", { className: "mb-3 p-2 rounded-lg bg-danger/10 border border-danger/30 text-danger", style: { fontSize: 13 }, children: ["Simulation failed", p.simulation.revertReason ? ` — “${p.simulation.revertReason}”` : '', ". The transaction will revert and consume gas."] })), _jsxs("div", { className: "space-y-1.5", style: { fontSize: 14 }, children: [_jsx(Row, { label: "To", value: toLabel === tx.to ? (tx.to ?? '—') : `${known?.name} (${tx.to})`, mono: true }), _jsx(Row, { label: "Value", value: `${valueApe} APE` }), p.dataAnalysis?.spender && (_jsx(Row, { label: "Spender", value: `${labelFor(p.dataAnalysis.spender)} ${p.dataAnalysis.spender}`, mono: true })), hasData && _jsx(Row, { label: "Data", value: trimMid(tx.data), mono: true })] }), _jsxs("details", { className: "mt-3", children: [_jsx("summary", { className: "text-ink-faint cursor-pointer", style: { fontSize: 13 }, children: "Raw transaction" }), _jsx("pre", { className: "bg-bg-soft border border-line rounded-xl p-2 overflow-auto font-mono whitespace-pre-wrap mt-1 max-h-48", style: { fontSize: 12 }, children: JSON.stringify(tx, null, 2) })] })] }));
}
function PersonalSignPanel({ payload }) {
    const p = payload;
    let display = p.message;
    if (typeof display === 'string' && display.startsWith('0x')) {
        try {
            const bytes = display.slice(2).match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) ?? [];
            const decoded = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
            if (decoded && /^[\x20-\x7E\s]*$/.test(decoded))
                display = decoded;
        }
        catch { /* keep hex */ }
    }
    return (_jsxs("div", { className: "card flex-1 overflow-y-auto", children: [_jsx("h2", { className: "font-bold mb-1", style: { fontSize: 19 }, children: "Sign message" }), _jsx("div", { className: "text-ink-faint mb-3", style: { fontSize: 13 }, children: "personal_sign" }), p.warnings && p.warnings.length > 0 && (_jsx("div", { className: "mb-3 p-2 rounded-lg bg-danger/10 border border-danger/30 text-danger space-y-1", style: { fontSize: 13 }, children: p.warnings.map((w, i) => _jsxs("div", { children: ["\u26A0 ", w] }, i)) })), _jsx("pre", { className: "bg-bg-soft border border-line rounded-xl p-3 whitespace-pre-wrap break-words max-h-64 overflow-auto", style: { fontSize: 14 }, children: display })] }));
}
function TypedDataPanel({ payload }) {
    const p = payload;
    const a = p.analysis;
    return (_jsxs("div", { className: "card flex-1 overflow-y-auto", children: [_jsx("h2", { className: "font-bold mb-1", style: { fontSize: 19 }, children: a?.summary ?? 'Sign typed data (EIP-712)' }), _jsx("div", { className: "text-ink-faint mb-3", style: { fontSize: 13 }, children: a?.primaryType ?? p.typedData.primaryType ?? '—' }), a?.isDrainerPattern && (_jsxs("div", { className: "mb-3 p-2 rounded-lg bg-danger/10 border border-danger/30 text-danger space-y-1", style: { fontSize: 13 }, children: [_jsx("div", { className: "font-bold", children: "\u26A0 Drainer pattern" }), _jsx("div", { children: "This signature is a known type that, once submitted on-chain, lets the spender move your assets without any further action from you." })] })), a?.warnings && a.warnings.length > 0 && (_jsx("div", { className: "mb-3 p-2 rounded-lg bg-warn/10 border border-warn/30 text-warn space-y-1", style: { fontSize: 13 }, children: a.warnings.map((w, i) => _jsxs("div", { children: ["\u26A0 ", w] }, i)) })), a?.spender && (_jsx(Row, { label: "Spender", value: `${labelFor(a.spender)}${labelFor(a.spender) !== a.spender ? ` (${a.spender})` : ''}`, mono: true })), a?.token && _jsx(Row, { label: "Token", value: a.token, mono: true }), a?.amount && _jsx(Row, { label: "Amount", value: a.amount }), a?.deadline && _jsx(Row, { label: "Deadline", value: new Date(a.deadline * 1000).toLocaleString() }), _jsxs("details", { className: "mt-3", children: [_jsx("summary", { className: "text-ink-faint cursor-pointer", style: { fontSize: 13 }, children: "Raw typed data" }), _jsx("pre", { className: "bg-bg-soft border border-line rounded-xl p-2 overflow-auto font-mono whitespace-pre-wrap max-h-64", style: { fontSize: 12 }, children: JSON.stringify(p.typedData, null, 2) })] })] }));
}
function Row({ label, value, mono }) {
    return (_jsxs("div", { className: "flex justify-between gap-3", style: { fontSize: 14 }, children: [_jsx("span", { className: "text-ink-dim shrink-0", children: label }), _jsx("span", { className: `text-right break-all ${mono ? 'font-mono' : ''} text-ink`, children: value })] }));
}
function trimMid(s) {
    if (s.length <= 24)
        return s;
    return `${s.slice(0, 12)}…${s.slice(-8)}`;
}
