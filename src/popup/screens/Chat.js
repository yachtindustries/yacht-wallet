import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { BottomNav, Page, Screen, TopBar } from '../components/Layout';
import { useApp } from '../store';
import { rpc } from '@/lib/messaging';
import { MAX_MESSAGE_LEN } from '@/lib/chat';
import { shortAddress } from '@/lib/wallet-utils';
const REFRESH_INTERVAL_MS = 12_000;
export default function Chat() {
    const { meta, unlocked } = useApp();
    const active = meta?.publicAccounts.find((a) => a.id === meta?.activeAccountId);
    const [messages, setMessages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [text, setText] = useState('');
    const [sending, setSending] = useState(false);
    const [err, setErr] = useState(null);
    const listRef = useRef(null);
    // Pull the most recent 15 messages on mount and poll periodically. The
    // backend reads via Etherscan `txlist` so this is purely indexer cost — no
    // wallet RPC budget consumed.
    useEffect(() => {
        let cancelled = false;
        async function load() {
            try {
                const r = await rpc({ type: 'chat.list', limit: 15 });
                if (!cancelled)
                    setMessages(r);
            }
            catch (e) {
                if (!cancelled)
                    setErr(e.message);
            }
            finally {
                if (!cancelled)
                    setLoading(false);
            }
        }
        void load();
        const t = window.setInterval(load, REFRESH_INTERVAL_MS);
        return () => { cancelled = true; window.clearInterval(t); };
    }, []);
    // Auto-scroll the list to the bottom when new messages arrive — the
    // newest is at the end since we render in chronological order below.
    useEffect(() => {
        const el = listRef.current;
        if (el)
            el.scrollTop = el.scrollHeight;
    }, [messages.length]);
    const overLength = text.length > MAX_MESSAGE_LEN;
    const canSend = !!active && unlocked && !sending && text.trim().length > 0 && !overLength;
    async function send() {
        if (!active || !canSend)
            return;
        setSending(true);
        setErr(null);
        const draft = text;
        setText('');
        try {
            const r = await rpc({ type: 'chat.send', account: active.address, text: draft });
            if (r.status !== 'success')
                throw new Error('Message reverted on-chain');
            // Optimistically add the new message so the user sees it without
            // waiting for the next poll. Etherscan typically catches up within a
            // block (~2s on ApeChain).
            const optimistic = {
                hash: r.hash,
                from: active.address,
                text: draft.trim(),
                timestamp: Math.floor(Date.now() / 1000),
                blockNumber: r.blockNumber,
                status: 'success',
            };
            setMessages((m) => {
                if (m.some((x) => x.hash === optimistic.hash))
                    return m;
                // Newest at end: push for chronological order.
                return [...m, optimistic].slice(-50);
            });
        }
        catch (e) {
            setErr(e.message);
            // Restore the draft so the user can retry.
            setText(draft);
        }
        finally {
            setSending(false);
        }
    }
    // Render messages oldest → newest so the input box at the bottom is next
    // to the latest message, like every familiar chat app.
    const ordered = [...messages].sort((a, b) => a.timestamp - b.timestamp);
    const myAddrLc = active?.address.toLowerCase() ?? '';
    return (_jsxs(Screen, { children: [_jsx(TopBar, { title: "Chat", tone: "deck" }), _jsxs(Page, { tone: "deck", className: "!p-0 flex flex-col", children: [_jsxs("div", { ref: listRef, className: "flex-1 overflow-y-auto px-3 py-3 space-y-2", children: [loading && messages.length === 0 && (_jsx("div", { className: "text-center text-white/80", style: { fontSize: 14 }, children: "Loading on-chain messages\u2026" })), !loading && messages.length === 0 && (_jsx("div", { className: "text-center text-white/80 mt-8", style: { fontSize: 14 }, children: "No messages yet. Be the first to post." })), ordered.map((m) => {
                                const mine = m.from.toLowerCase() === myAddrLc;
                                const fromShort = shortAddress(m.from, 5, 3);
                                return (_jsx("div", { className: `flex ${mine ? 'justify-end' : 'justify-start'}`, children: _jsxs("div", { className: `rounded-2xl px-3 py-2 max-w-[80%] break-words ${mine ? 'bg-[#5eccfa] text-white' : 'bg-white text-ink'}`, style: { fontSize: 14 }, children: [_jsx("div", { className: `font-mono mb-0.5 ${mine ? 'text-white/80' : 'text-ink-faint'}`, style: { fontSize: 11 }, children: fromShort }), _jsx("div", { className: "whitespace-pre-wrap font-bold", children: m.text })] }) }, m.hash));
                            })] }), _jsxs("div", { className: "px-3 pb-2 pt-1", children: [err && _jsx("div", { className: "text-danger mb-1", style: { fontSize: 13 }, children: err }), !unlocked && (_jsx("div", { className: "text-white/85 text-center mb-1", style: { fontSize: 13 }, children: "Unlock the wallet to post a message." })), _jsxs("div", { className: "flex items-end gap-2", children: [_jsx("textarea", { className: "flex-1 bg-white border-0 rounded-xl px-3 py-2 text-ink placeholder:text-ink-faint focus:outline-none resize-none", style: { fontSize: 15, maxHeight: 88 }, rows: 2, value: text, onChange: (e) => setText(e.target.value), onKeyDown: (e) => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault();
                                                void send();
                                            }
                                        }, placeholder: "Say something on-chain\u2026", disabled: !unlocked || sending, maxLength: MAX_MESSAGE_LEN * 2 }), _jsx("button", { className: "btn font-bold text-white bg-[#5eccfa] hover:bg-[#3eb8e8] disabled:opacity-60 px-4", style: { fontSize: 15, height: 44 }, disabled: !canSend, onClick: send, children: sending ? 'Posting…' : 'Send' })] }), _jsxs("div", { className: `text-right mt-0.5 ${overLength ? 'text-danger' : 'text-white/80'}`, style: { fontSize: 11 }, children: [text.length, "/", MAX_MESSAGE_LEN, sending && ' · waiting for confirmation'] })] })] }), _jsx(BottomNav, {})] }));
}
