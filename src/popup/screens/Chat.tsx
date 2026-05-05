import { useEffect, useRef, useState } from 'react';
import { BottomNav, Page, Screen, TopBar } from '../components/Layout';
import { useApp } from '../store';
import { rpc } from '@/lib/messaging';
import { MAX_MESSAGE_LEN, type ChatMessage } from '@/lib/chat';
import { shortAddress } from '@/lib/wallet-utils';

const REFRESH_INTERVAL_MS = 12_000;

export default function Chat() {
  const { meta, unlocked } = useApp();
  const active = meta?.publicAccounts.find((a) => a.id === meta?.activeAccountId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Pull the most recent 15 messages on mount and poll periodically. The
  // backend reads via Etherscan `txlist` so this is purely indexer cost — no
  // wallet RPC budget consumed.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await rpc({ type: 'chat.list', limit: 15 });
        if (!cancelled) setMessages(r);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
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
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const overLength = text.length > MAX_MESSAGE_LEN;
  const canSend = !!active && unlocked && !sending && text.trim().length > 0 && !overLength;

  async function send() {
    if (!active || !canSend) return;
    setSending(true);
    setErr(null);
    const draft = text;
    setText('');
    try {
      const r = await rpc({ type: 'chat.send', account: active.address, text: draft });
      if (r.status !== 'success') throw new Error('Message reverted on-chain');
      // Optimistically add the new message so the user sees it without
      // waiting for the next poll. Etherscan typically catches up within a
      // block (~2s on ApeChain).
      const optimistic: ChatMessage = {
        hash: r.hash,
        from: active.address,
        text: draft.trim(),
        timestamp: Math.floor(Date.now() / 1000),
        blockNumber: r.blockNumber,
        status: 'success',
      };
      setMessages((m) => {
        if (m.some((x) => x.hash === optimistic.hash)) return m;
        // Newest at end: push for chronological order.
        return [...m, optimistic].slice(-50);
      });
    } catch (e) {
      setErr((e as Error).message);
      // Restore the draft so the user can retry.
      setText(draft);
    } finally {
      setSending(false);
    }
  }

  // Render messages oldest → newest so the input box at the bottom is next
  // to the latest message, like every familiar chat app.
  const ordered = [...messages].sort((a, b) => a.timestamp - b.timestamp);
  const myAddrLc = active?.address.toLowerCase() ?? '';

  return (
    <Screen>
      <TopBar title="Chat" tone="deck" />
      <Page tone="deck" className="!p-0 flex flex-col">
        <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          {loading && messages.length === 0 && (
            <div className="text-center text-white/80" style={{ fontSize: 14 }}>Loading on-chain messages…</div>
          )}
          {!loading && messages.length === 0 && (
            <div className="text-center text-white/80 mt-8" style={{ fontSize: 14 }}>
              No messages yet. Be the first to post.
            </div>
          )}
          {ordered.map((m) => {
            const mine = m.from.toLowerCase() === myAddrLc;
            const fromShort = shortAddress(m.from, 5, 3);
            return (
              <div key={m.hash} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`rounded-2xl px-3 py-2 max-w-[80%] break-words ${
                    mine ? 'bg-[#5eccfa] text-white' : 'bg-white text-ink'
                  }`}
                  style={{ fontSize: 14 }}
                >
                  <div
                    className={`font-mono mb-0.5 ${mine ? 'text-white/80' : 'text-ink-faint'}`}
                    style={{ fontSize: 11 }}
                  >
                    {fromShort}
                  </div>
                  <div className="whitespace-pre-wrap font-bold">{m.text}</div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-3 pb-2 pt-1">
          {err && <div className="text-danger mb-1" style={{ fontSize: 13 }}>{err}</div>}
          {!unlocked && (
            <div className="text-white/85 text-center mb-1" style={{ fontSize: 13 }}>
              Unlock the wallet to post a message.
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea
              className="flex-1 bg-white border-0 rounded-xl px-3 py-2 text-ink placeholder:text-ink-faint focus:outline-none resize-none"
              style={{ fontSize: 15, maxHeight: 88 }}
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
              }}
              placeholder="Say something on-chain…"
              disabled={!unlocked || sending}
              maxLength={MAX_MESSAGE_LEN * 2}
            />
            <button
              className="btn font-bold text-white bg-[#5eccfa] hover:bg-[#3eb8e8] disabled:opacity-60 px-4"
              style={{ fontSize: 15, height: 44 }}
              disabled={!canSend}
              onClick={send}
            >
              {sending ? 'Posting…' : 'Send'}
            </button>
          </div>
          <div className={`text-right mt-0.5 ${overLength ? 'text-danger' : 'text-white/80'}`} style={{ fontSize: 11 }}>
            {text.length}/{MAX_MESSAGE_LEN}
            {sending && ' · waiting for confirmation'}
          </div>
        </div>
      </Page>
      <BottomNav />
    </Screen>
  );
}
