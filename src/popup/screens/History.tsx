import { useEffect, useState } from 'react';
import { BottomNav, Page, Screen, TopBar } from '../components/Layout';
import { TokenLogo } from '../components/TokenLogo';
import { useApp } from '../store';
import { rpc } from '@/lib/messaging';
import type { HistoryEntry, HistoryTransfer } from '@/lib/evm';
import { NETWORKS } from '@/lib/networks';
import { shortAddress } from '@/lib/wallet-utils';
import { APE, TokenMeta, safeChecksum } from '@/lib/tokens';
import { TRADING_FEE_TREASURY } from '@/lib/constants';
import { YACHT_CHAT_INBOX } from '@/lib/chat';

const arrowIcon = chrome.runtime.getURL('public/actions/sendreceive.png');
const swapIcon = chrome.runtime.getURL('public/actions/swap.png');

function transferToken(t: HistoryTransfer): TokenMeta {
  if (t.native) return APE;
  return {
    symbol: t.tokenSymbol ?? 'TOKEN',
    name: t.tokenSymbol ?? 'Token',
    address: t.tokenAddress ? safeChecksum(t.tokenAddress) : '',
    decimals: t.tokenDecimals ?? 18,
  };
}

function rowTokens(t: HistoryEntry): { primary: TokenMeta; secondary?: TokenMeta } {
  // Pick the most informative token(s) for the row icon.
  if (t.type === 'swap') {
    const out = t.transfers.find((x) => x.direction === 'out' && parseFloat(x.amount) > 0);
    const inn = t.transfers.find((x) => x.direction === 'in' && parseFloat(x.amount) > 0);
    return {
      primary: out ? transferToken(out) : APE,
      secondary: inn ? transferToken(inn) : undefined,
    };
  }
  if (t.type === 'receive') {
    const inn = t.transfers.find((x) => x.direction === 'in' && parseFloat(x.amount) > 0);
    return { primary: inn ? transferToken(inn) : APE };
  }
  if (t.type === 'send') {
    const out = t.transfers.find((x) => x.direction === 'out' && parseFloat(x.amount) > 0);
    return { primary: out ? transferToken(out) : APE };
  }
  // self / contract: prefer first non-zero transfer, else APE.
  const any = t.transfers.find((x) => parseFloat(x.amount) > 0);
  return { primary: any ? transferToken(any) : APE };
}

interface ActionGlyphProps {
  type: HistoryEntry['type'];
}

function ActionGlyph({ type }: ActionGlyphProps) {
  const isSwap = type === 'swap' || type === 'self';
  const url = isSwap ? swapIcon : arrowIcon;
  const rotate = type === 'receive' ? 180 : 0;
  return (
    <span
      role="img"
      aria-hidden
      className="block w-3.5 h-3.5"
      style={{
        backgroundColor: '#000000',
        WebkitMaskImage: `url(${url})`,
        maskImage: `url(${url})`,
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        transform: rotate ? `rotate(${rotate}deg)` : undefined,
      }}
    />
  );
}

type FilterKey = 'all' | 'send' | 'swap' | 'receive';
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'send', label: 'Send' },
  { key: 'swap', label: 'Swap' },
  { key: 'receive', label: 'Receive' },
];

export default function History() {
  const { meta, settings } = useApp();
  const active = meta?.publicAccounts.find((a) => a.id === meta?.activeAccountId);
  const [items, setItems] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');

  useEffect(() => {
    if (!active) return;
    setLoading(true);
    setErr(null);
    rpc({ type: 'evm.history', address: active.address })
      .then((all) => {
        // Hide implementation-detail sends from the activity feed:
        //   • the trading-fee skim that accompanies every swap, and
        //   • chat-message sends to the on-chain chat inbox.
        const treasuryLc = TRADING_FEE_TREASURY.toLowerCase();
        const chatInboxLc = YACHT_CHAT_INBOX.toLowerCase();
        const filtered = all.filter((t) => {
          // Hide chat sends regardless of value/transfer count — the activity
          // feed lists trading actions, and chat lives in its own screen.
          if ((t.to ?? '').toLowerCase() === chatInboxLc) return false;
          // Drop sends whose only outgoing transfer is to the treasury.
          if (t.type !== 'send') return true;
          if (t.transfers.length !== 1) return true;
          const tr = t.transfers[0];
          if (tr.direction !== 'out') return true;
          return tr.to.toLowerCase() !== treasuryLc;
        });
        setItems(filtered);
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, [active?.address, settings?.network]);

  const explorer = NETWORKS[settings?.network ?? 'mainnet'].explorerTx;

  // Apply current type filter, then group by calendar day.
  const visible = items.filter((t) => filter === 'all' || t.type === filter);
  const grouped: { dayLabel: string; entries: HistoryEntry[] }[] = [];
  for (const t of visible) {
    const ts = t.timestamp ? t.timestamp * 1000 : Date.now();
    const label = formatDayHeader(ts);
    const last = grouped[grouped.length - 1];
    if (last && last.dayLabel === label) last.entries.push(t);
    else grouped.push({ dayLabel: label, entries: [t] });
  }

  return (
    <Screen>
      <TopBar title="Activity" tone="deck" />
      <Page tone="deck">
        {/* Type-filter buttons */}
        <div className="flex gap-2 mb-3">
          {FILTERS.map((f) => {
            const active = f.key === filter;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`flex-1 py-1.5 rounded-lg font-bold transition ${
                  active ? 'bg-white text-ink' : 'bg-white/10 text-white/85 hover:bg-white/20'
                }`}
                style={{ fontSize: 14 }}
              >
                {f.label}
              </button>
            );
          })}
        </div>
        {loading && <div className="text-white/85 text-sm">Loading…</div>}
        {err && <div className="text-danger text-xs">{err}</div>}
        {!loading && visible.length === 0 && (
          <div className="text-center text-white/85 text-sm mt-12">
            <div className="text-3xl mb-2">≡</div>
            No transactions yet.
          </div>
        )}
        <div className="space-y-2">
          {grouped.flatMap((g, gi) => [
            <div
              key={`hdr-${gi}`}
              className="font-bold text-white uppercase tracking-wider px-1 mt-3 first:mt-0"
              style={{ fontSize: 12 }}
            >
              {g.dayLabel}
            </div>,
            ...g.entries.map((t) => {
            const label =
              t.type === 'swap' ? 'Swap' :
              t.type === 'receive' ? 'Receive' :
              t.type === 'send' ? 'Send' :
              t.type === 'self' ? 'Self transfer' : 'Contract';

            const incoming = t.transfers.filter((x) => x.direction === 'in' && parseFloat(x.amount) > 0);
            const outgoing = t.transfers.filter((x) => x.direction === 'out' && parseFloat(x.amount) > 0);
            const counterparty = t.type === 'send' || t.type === 'contract' ? t.to : t.from;
            const { primary, secondary } = rowTokens(t);

            return (
              <a
                key={t.hash}
                href={explorer(t.hash)}
                target="_blank"
                rel="noreferrer"
                className="card hover:border-brand block"
              >
                <div className="flex justify-between items-start gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="relative shrink-0">
                      <TokenLogo token={primary} size={36} />
                      {secondary && (
                        <div className="absolute -right-1.5 -bottom-1.5 rounded-full ring-2 ring-bg-card">
                          <TokenLogo token={secondary} size={20} />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold flex items-center gap-1.5" style={{ fontSize: 17 }}>
                        <ActionGlyph type={t.type} />
                        <span>{label}</span>
                      </div>
                      {counterparty && (
                        <div className="text-ink-faint font-mono truncate" style={{ fontSize: 13 }}>
                          {t.type === 'receive' ? `from ${shortAddress(counterparty)}` : `to ${shortAddress(counterparty)}`}
                        </div>
                      )}
                      <div className="text-ink-faint mt-0.5" style={{ fontSize: 12 }}>
                        {t.timestamp ? new Date(t.timestamp * 1000).toLocaleString() : ''}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {t.type === 'swap' ? (
                      <>
                        {outgoing.map((x, i) => (
                          <Amount key={`o${i}`} t={x} sign="-" />
                        ))}
                        {incoming.map((x, i) => (
                          <Amount key={`i${i}`} t={x} sign="+" />
                        ))}
                      </>
                    ) : t.transfers.length > 0 ? (
                      t.transfers.map((x, i) => (
                        <Amount key={i} t={x} sign={x.direction === 'in' ? '+' : x.direction === 'out' ? '-' : ''} />
                      ))
                    ) : (
                      <div className="font-bold text-ink-dim" style={{ fontSize: 16 }}>—</div>
                    )}
                    <div className="mt-0.5 flex items-center justify-end gap-1" style={{ fontSize: 12 }}>
                      <span className={t.status === 'success' ? 'text-ink-faint' : 'text-black font-bold'}>
                        {t.status === 'success' ? 'Success' : t.status === 'failed' ? 'Failed' : 'Pending'}
                      </span>
                      {t.status !== 'pending' && <StatusBadge ok={t.status === 'success'} sizeEm={1.1} />}
                    </div>
                  </div>
                </div>
              </a>
            );
            }),
          ])}
        </div>
      </Page>
      <BottomNav />
    </Screen>
  );
}

function formatDayHeader(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const yest = new Date(today);
  yest.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, yest)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

const activitySuccessUrl = chrome.runtime.getURL('activity-success.png');

function StatusBadge({ ok, sizeEm }: { ok: boolean; sizeEm: number }) {
  if (ok) {
    return (
      <img
        src={activitySuccessUrl}
        alt="Success"
        className="inline-block"
        style={{ width: `${sizeEm}em`, height: `${sizeEm}em` }}
        aria-hidden
      />
    );
  }
  return (
    <span
      className="inline-flex items-center justify-center rounded-full text-white font-bold leading-none"
      style={{
        width: `${sizeEm}em`,
        height: `${sizeEm}em`,
        backgroundColor: '#dc2626',
        fontSize: `${0.7 * sizeEm}em`,
      }}
      aria-hidden
    >
      ✗
    </span>
  );
}

function Amount({ t, sign }: { t: HistoryTransfer; sign: string }) {
  const symbol = t.native ? 'APE' : (t.tokenSymbol ?? 'TOKEN');
  const amount = parseFloat(t.amount).toLocaleString(undefined, { maximumFractionDigits: 3 });
  // Receive (+) renders water blue; Send (−) is plain black; self / swap-leg
  // labels stay black. The previous green-on-red palette read as
  // gain/loss; the new colour pair feels neutral and brand-aligned.
  const color = sign === '+' ? 'text-[#5eccfa]' : 'text-black';
  return (
    <div className={`font-bold ${color}`} style={{ fontSize: 16 }}>
      {sign}{amount} {symbol}
    </div>
  );
}
