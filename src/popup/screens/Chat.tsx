import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BottomNav, Screen, TopBar } from '../components/Layout';
import { TokenLogo } from '../components/TokenLogo';
import { PfpAvatar } from '../components/PfpAvatar';
import { OnChainPfpAvatar } from '../components/OnChainPfpAvatar';
import { useApp } from '../store';
import { rpc } from '@/lib/messaging';
import {
  MAX_MESSAGE_LEN,
  validateChatMessage,
  type ChatMessage,
} from '@/lib/chat';
import { APE } from '@/lib/tokens';
import { shortAddress } from '@/lib/wallet-utils';

const REFRESH_INTERVAL_MS = 12_000;
const TIP_AMOUNTS = ['0.1', '1', '10'] as const;

const sendArrowIcon = chrome.runtime.getURL('public/actions/sendreceive.png');

export default function Chat() {
  const { meta, unlocked } = useApp();
  const active = meta?.publicAccounts.find((a) => a.id === meta?.activeAccountId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tipsByMsg, setTipsByMsg] = useState<Record<string, bigint>>({});
  // Per-sender rank info, keyed by lowercase address. rank.get is cached on
  // the background side (5-min TTL) so re-mounts and re-renders are cheap.
  const [ranksByAddr, setRanksByAddr] = useState<Record<string, { rank: number; fraction: number }>>({});
  const [hoveredHash, setHoveredHash] = useState<string | null>(null);
  const [tippingHash, setTippingHash] = useState<string | null>(null);
  const [tipErr, setTipErr] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // The hover popover sits 8 px above each message bubble, but the user has
  // to traverse that gap to click a tip button — and a naive React
  // mouseEnter/mouseLeave on the bubble alone fires "leave" mid-traversal,
  // hiding the popover before the click lands. We add a short hide-delay
  // and let the popover itself cancel the timer if hovered, which is the
  // standard "hoverable tooltip" pattern.
  const hideTimer = useRef<number | null>(null);

  function scheduleHide() {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setHoveredHash(null), 250);
  }
  function cancelHide() {
    if (hideTimer.current) { window.clearTimeout(hideTimer.current); hideTimer.current = null; }
  }
  function showHover(hash: string) {
    cancelHide();
    setHoveredHash(hash);
  }

  // Pull recent messages on mount + poll. Etherscan-backed; no wallet RPC
  // budget consumed.
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

  // Refresh tip totals whenever the visible-hash set changes.
  const visibleHashKey = messages.map((m) => m.hash).join(',');
  useEffect(() => {
    if (messages.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const entries = messages.map((m) => ({ messageHash: m.hash, author: m.from }));
        const totals = await rpc({ type: 'chat.tips', entries });
        if (cancelled) return;
        setTipsByMsg((prev) => {
          const next: Record<string, bigint> = {};
          for (const t of totals) {
            try { next[t.messageHash] = BigInt(t.totalWei); } catch { /* skip */ }
          }
          // Preserve any optimistic local total that's still ahead of chain.
          for (const [hash, wei] of Object.entries(prev)) {
            const onchain = next[hash] ?? 0n;
            if (wei > onchain) next[hash] = wei;
          }
          return next;
        });
      } catch { /* leave as-is */ }
    })();
    return () => { cancelled = true; };
  }, [visibleHashKey]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // Fetch a rank avatar for every distinct sender on screen. We only kick
  // off requests for addresses we haven't already seen; rank.get itself is
  // background-cached so a repeat sender across refreshes hits the cache.
  useEffect(() => {
    if (messages.length === 0) return;
    const unique = Array.from(new Set(messages.map((m) => m.from.toLowerCase())));
    const missing = unique.filter((addr) => !ranksByAddr[addr]);
    if (missing.length === 0) return;
    let cancelled = false;
    void (async () => {
      const results = await Promise.all(
        missing.map(async (addr) => {
          try {
            const r = await rpc({ type: 'rank.get', address: addr });
            return [addr, { rank: r.rank, fraction: r.fraction }] as const;
          } catch {
            return [addr, { rank: 1, fraction: 0 }] as const;
          }
        }),
      );
      if (cancelled) return;
      setRanksByAddr((prev) => {
        const next = { ...prev };
        for (const [a, v] of results) next[a] = v;
        return next;
      });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleHashKey]);

  const liveValidation = useMemo(() => {
    if (!text.trim()) return null;
    const v = validateChatMessage(text);
    return v.ok ? null : v.reason ?? null;
  }, [text]);

  const overLength = new TextEncoder().encode(text).length > MAX_MESSAGE_LEN;
  const canSend = !!active && unlocked && !sending && text.trim().length > 0 && !liveValidation;

  async function send() {
    if (!active || !canSend) return;
    setSending(true);
    setErr(null);
    const draft = text;
    setText('');
    try {
      const r = await rpc({ type: 'chat.send', account: active.address, text: draft });
      if (r.status !== 'success') throw new Error('Message reverted on-chain');
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
        return [...m, optimistic].slice(-50);
      });
    } catch (e) {
      setErr((e as Error).message);
      setText(draft);
    } finally {
      setSending(false);
    }
  }

  async function tip(msg: ChatMessage, amount: string) {
    if (!active) return;
    if (msg.from.toLowerCase() === active.address.toLowerCase()) return;
    setTippingHash(msg.hash);
    setTipErr(null);
    try {
      const r = await rpc({
        type: 'chat.tip',
        account: active.address,
        toAuthor: msg.from,
        messageHash: msg.hash,
        apeAmount: amount,
      });
      if (r.status !== 'success') throw new Error('Tip reverted on-chain');
      setTipsByMsg((prev) => {
        const wei = parseApeToWei(amount);
        return { ...prev, [msg.hash]: (prev[msg.hash] ?? 0n) + wei };
      });
      cancelHide();
      setHoveredHash(null);
    } catch (e) {
      setTipErr((e as Error).message);
    } finally {
      setTippingHash(null);
    }
  }

  const groups = useMemo(() => {
    const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp);
    const out: { dayLabel: string; entries: ChatMessage[] }[] = [];
    for (const m of sorted) {
      const label = formatDayLabel(m.timestamp * 1000);
      const last = out[out.length - 1];
      if (last && last.dayLabel === label) last.entries.push(m);
      else out.push({ dayLabel: label, entries: [m] });
    }
    return out;
  }, [messages]);

  const myAddrLc = active?.address.toLowerCase() ?? '';

  return (
    <Screen>
      <TopBar title="Chat" tone="deck" />
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto px-3 py-3 space-y-2"
        style={{ backgroundColor: '#002849' }}
      >
        {loading && messages.length === 0 && (
          <div className="text-center text-white/85 font-bold" style={{ fontSize: 18 }}>
            Loading on-chain messages…
          </div>
        )}
        {!loading && messages.length === 0 && (
          <div className="text-center text-white/85 mt-8 font-bold" style={{ fontSize: 18 }}>
            No messages yet. Be the first to post.
          </div>
        )}
        {err && messages.length === 0 && (
          <div className="text-center text-danger" style={{ fontSize: 16 }}>{err}</div>
        )}
        {groups.map((g, gi) => (
          <div key={`g-${gi}`} className="space-y-2">
            <div className="text-center text-white/70 font-bold pt-1 pb-1" style={{ fontSize: 15 }}>
              {g.dayLabel}
            </div>
            {g.entries.map((m) => {
              const mine = m.from.toLowerCase() === myAddrLc;
              // Prefer the Yacht username embedded in the on-chain payload;
              // fall back to a short address for messages from non-Yacht
              // clients or pre-username messages. The on-chain `from` is
              // still the source of truth for tipping.
              const fromShort = m.username ? `@${m.username}` : shortAddress(m.from, 5, 3);
              const time = formatTimeAmPm(m.timestamp * 1000);
              const tipWei = tipsByMsg[m.hash] ?? 0n;
              const tipLabel = tipWei > 0n ? formatApeFromWei(tipWei) : null;
              const showHoverFor = !mine && hoveredHash === m.hash;
              const senderRank = ranksByAddr[m.from.toLowerCase()] ?? { rank: 1, fraction: 0 };
              return (
                <div
                  key={m.hash}
                  className={`flex items-end gap-2 ${mine ? 'justify-end' : 'justify-start'} relative`}
                >
                  {!mine && (
                    // Click another user's avatar → /profile/<their address>.
                    // Their wallet snapshot, NFTs, rank, and Otherside data
                    // (where available) all render server-side; nothing
                    // about the click reveals the viewer to the chain.
                    <Link
                      to={`/profile/${m.from}`}
                      aria-label={`View ${fromShort}'s profile`}
                      title={`View ${fromShort}'s profile`}
                      className="hover:opacity-90 transition shrink-0"
                    >
                      <OnChainPfpAvatar
                        address={m.from}
                        rank={senderRank.rank}
                        fraction={senderRank.fraction}
                        size={42}
                        showRing={false}
                        backgroundColor="#002849"
                      />
                    </Link>
                  )}
                  <div
                    className="relative"
                    style={{ maxWidth: '78%' }}
                    onMouseEnter={() => !mine && showHover(m.hash)}
                    onMouseLeave={() => !mine && scheduleHide()}
                  >
                    {showHoverFor && (
                      <TipPopover
                        onTip={(amt) => tip(m, amt)}
                        tipping={tippingHash === m.hash}
                        onMouseEnter={cancelHide}
                        onMouseLeave={scheduleHide}
                      />
                    )}
                    <div
                      className="rounded-2xl px-3 py-2 break-words"
                      style={{
                        fontSize: 18,
                        backgroundColor: mine ? '#5eccfa' : '#ffffff',
                      }}
                    >
                      <div
                        className={`flex items-baseline justify-between gap-3 mb-0.5 font-mono ${
                          mine ? 'text-white/85' : 'text-ink-faint'
                        }`}
                        style={{ fontSize: 14 }}
                      >
                        <span>{fromShort}</span>
                        <span>{time}</span>
                      </div>
                      <div
                        className={`whitespace-pre-wrap font-bold ${
                          mine ? 'text-white' : 'text-black'
                        }`}
                      >
                        {m.text}
                      </div>
                      {tipLabel && (
                        <div
                          className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-bold ${
                            mine ? 'bg-white/30 text-white' : 'bg-[#5eccfa]/20 text-ink'
                          }`}
                          style={{ fontSize: 13 }}
                        >
                          <TokenLogo token={APE} size={14} />
                          <span>{tipLabel} APE tipped</span>
                        </div>
                      )}
                    </div>
                  </div>
                  {mine && active && (
                    // Our own bubble can use PfpAvatar — we know our own
                    // accountId so we can look up the saved PFP. Other
                    // users' bubbles only render the rank-shaped avatar
                    // because their PFP, if any, is stored on their device.
                    <PfpAvatar
                      accountId={active.id}
                      rank={senderRank.rank}
                      fraction={senderRank.fraction}
                      size={42}
                      withRankBelow
                      rankSize={20}
                      showRing={false}
                      backgroundColor="#002849"
                    />
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {tipErr && <div className="text-center text-danger mt-1" style={{ fontSize: 15 }}>{tipErr}</div>}
      </div>

      <div className="px-3 py-2" style={{ backgroundColor: '#002849' }}>
        {err && messages.length > 0 && (
          <div className="text-danger mb-1" style={{ fontSize: 16 }}>{err}</div>
        )}
        {!unlocked && (
          <div className="text-white/85 text-center mb-1 font-bold" style={{ fontSize: 16 }}>
            Unlock the wallet to post a message.
          </div>
        )}
        {liveValidation && (
          <div className="text-danger mb-1" style={{ fontSize: 14 }}>{liveValidation}</div>
        )}
        {/* Single white pill — the send button lives inside it as a circular
            water-blue button so the input + button read as one element. */}
        <div className="relative">
          <input
            className="w-full rounded-full pl-4 pr-12 py-2 font-bold text-black bg-white placeholder:text-black/60 focus:outline-none"
            style={{ fontSize: 18 }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void send(); }
            }}
            placeholder="chat onchain.."
            disabled={!unlocked || sending}
            maxLength={MAX_MESSAGE_LEN * 2}
          />
          <button
            className="absolute top-1/2 -translate-y-1/2 right-1 rounded-full bg-[#5eccfa] hover:bg-[#3eb8e8] disabled:opacity-60 flex items-center justify-center"
            style={{ width: 32, height: 32 }}
            disabled={!canSend}
            onClick={send}
            aria-label="Send message"
          >
            <span
              role="img"
              aria-hidden
              className="block"
              style={{
                width: 16,
                height: 16,
                backgroundColor: '#ffffff',
                WebkitMaskImage: `url(${sendArrowIcon})`,
                maskImage: `url(${sendArrowIcon})`,
                WebkitMaskRepeat: 'no-repeat',
                maskRepeat: 'no-repeat',
                WebkitMaskPosition: 'center',
                maskPosition: 'center',
                WebkitMaskSize: 'contain',
                maskSize: 'contain',
              }}
            />
          </button>
        </div>
        {text.length > 0 && (
          <div
            className={`text-right mt-0.5 font-bold ${overLength ? 'text-danger' : 'text-white/70'}`}
            style={{ fontSize: 13 }}
          >
            {text.length}/{MAX_MESSAGE_LEN}
            {sending && ' · waiting for confirmation'}
          </div>
        )}
      </div>
      <BottomNav />
    </Screen>
  );
}

function TipPopover({
  onTip,
  tipping,
  onMouseEnter,
  onMouseLeave,
}: {
  onTip: (amount: string) => void;
  tipping: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  // The wrapper has 8 px of bottom padding rather than a margin, so the
  // mouse can transit from the bubble up to the buttons without ever
  // leaving an element bound to the hover handlers.
  return (
    <div
      className="absolute bottom-full left-1/2 -translate-x-1/2 z-20"
      style={{ paddingBottom: 8 }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-2xl bg-bg-card border border-line shadow-lg whitespace-nowrap"
        style={{ fontSize: 14 }}
      >
        <div className="flex items-center gap-1 font-bold text-ink">
          <span>Tip</span>
          <TokenLogo token={APE} size={18} />
        </div>
        <div className="flex items-center gap-1">
          {TIP_AMOUNTS.map((amt) => (
            <button
              key={amt}
              onClick={(e) => { e.stopPropagation(); onTip(amt); }}
              disabled={tipping}
              className="px-2 py-0.5 rounded-lg bg-[#5eccfa] hover:bg-[#3eb8e8] disabled:opacity-60 text-white font-bold"
              style={{ fontSize: 13 }}
            >
              {tipping ? '…' : amt}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatDayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}

function formatTimeAmPm(ms: number): string {
  const d = new Date(ms);
  const h12 = ((d.getHours() + 11) % 12) + 1;
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ap = d.getHours() < 12 ? 'am' : 'pm';
  return `${h12}:${mm}${ap}`;
}

function parseApeToWei(s: string): bigint {
  const [intPart, fracPart = ''] = s.trim().split('.');
  const padded = (fracPart + '0'.repeat(18)).slice(0, 18);
  const norm = (intPart || '0') + padded;
  return BigInt(norm);
}

function formatApeFromWei(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = wei % 10n ** 18n;
  if (frac === 0n) return whole.toString();
  let s = (frac + 10n ** 18n).toString().slice(1);
  s = s.slice(0, 4).replace(/0+$/, '');
  return s ? `${whole}.${s}` : whole.toString();
}
