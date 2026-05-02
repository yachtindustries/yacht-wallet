import { useEffect, useState } from 'react';
import { BottomNav, Page, Screen, TopBar } from '../components/Layout';
import { TokenLogo } from '../components/TokenLogo';
import { useApp } from '../store';
import { rpc } from '@/lib/messaging';
import type { HistoryEntry, HistoryTransfer } from '@/lib/evm';
import { NETWORKS } from '@/lib/networks';
import { shortAddress } from '@/lib/wallet-utils';
import { APE, TokenMeta, safeChecksum } from '@/lib/tokens';

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
        backgroundColor: '#6b4423',
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

export default function History() {
  const { meta, settings } = useApp();
  const active = meta?.publicAccounts.find((a) => a.id === meta?.activeAccountId);
  const [items, setItems] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    setLoading(true);
    setErr(null);
    rpc({ type: 'evm.history', address: active.address })
      .then(setItems)
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, [active?.address, settings?.network]);

  const explorer = NETWORKS[settings?.network ?? 'mainnet'].explorerTx;

  return (
    <Screen>
      <TopBar title="Activity" tone="deck" />
      <Page tone="deck">
        {loading && <div className="text-ink-dim text-sm">Loading…</div>}
        {err && <div className="text-danger text-xs">{err}</div>}
        {!loading && items.length === 0 && (
          <div className="text-center text-ink-dim text-sm mt-12">
            <div className="text-3xl mb-2">≡</div>
            No transactions yet.
          </div>
        )}
        <div className="space-y-2">
          {items.map((t) => {
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
                      <div className="text-sm font-semibold flex items-center gap-1.5">
                        <ActionGlyph type={t.type} />
                        <span>{label}</span>
                      </div>
                      {counterparty && (
                        <div className="text-[11px] text-ink-faint font-mono truncate">
                          {t.type === 'receive' ? `from ${shortAddress(counterparty)}` : `to ${shortAddress(counterparty)}`}
                        </div>
                      )}
                      <div className="text-[10px] text-ink-faint mt-0.5">
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
                      <div className="text-sm font-mono text-ink-dim">—</div>
                    )}
                    <div className="text-[10px] mt-0.5 flex items-center justify-end gap-1">
                      <span className={t.status === 'success' ? 'text-ink-faint' : 'text-danger'}>
                        {t.status === 'success' ? 'Success' : t.status === 'failed' ? 'Failed' : 'Pending'}
                      </span>
                      {t.status !== 'pending' && <StatusBadge ok={t.status === 'success'} sizeEm={2} />}
                    </div>
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      </Page>
      <BottomNav />
    </Screen>
  );
}

function StatusBadge({ ok, sizeEm }: { ok: boolean; sizeEm: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-full text-white font-bold leading-none"
      style={{
        width: `${sizeEm}em`,
        height: `${sizeEm}em`,
        backgroundColor: ok ? '#16a34a' : '#dc2626',
        fontSize: `${0.7 * sizeEm}em`,
      }}
      aria-hidden
    >
      {ok ? '✓' : '✗'}
    </span>
  );
}

function Amount({ t, sign }: { t: HistoryTransfer; sign: string }) {
  const symbol = t.native ? 'APE' : (t.tokenSymbol ?? 'TOKEN');
  const amount = parseFloat(t.amount).toLocaleString(undefined, { maximumFractionDigits: 3 });
  const color = sign === '+' ? 'text-success' : sign === '-' ? 'text-danger' : 'text-ink';
  return (
    <div className={`text-sm font-mono ${color}`}>
      {sign}{amount} {symbol}
    </div>
  );
}
