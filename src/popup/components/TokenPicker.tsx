import { useEffect, useMemo, useState } from 'react';
import { isNative, searchTokens, TokenMeta, tokenKey, TOP_TOKENS, safeChecksum } from '@/lib/tokens';
import { rpc } from '@/lib/messaging';
import { shortAddress } from '@/lib/wallet-utils';
import { TokenLogo } from './TokenLogo';

const verifiedIconUrl = chrome.runtime.getURL('verified.png');

export interface TokenStats {
  /** Display-units balance, e.g. "12.345" */
  balance?: string;
  /** Per-token USD price */
  priceUsd?: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (t: TokenMeta) => void;
  /** Tokens the user already holds — usually the dashboard ERC-20 list. */
  walletTokens?: TokenMeta[];
  exclude?: TokenMeta;
  /**
   * Cached balances + USD prices keyed by token (NATIVE for APE, lower-case
   * address for ERC-20). Pass the dashboard's already-fetched data so we
   * don't hit the API again from inside the picker.
   */
  stats?: Record<string, TokenStats>;
}

export function TokenPicker({ open, onClose, onPick, walletTokens = [], exclude, stats = {} }: Props) {
  const [query, setQuery] = useState('');
  const [trending, setTrending] = useState<TokenMeta[]>([]);
  const [searchHits, setSearchHits] = useState<TokenMeta[]>([]);
  const [searching, setSearching] = useState(false);

  // Top trending ApeChain tokens via DexScreener
  useEffect(() => {
    if (!open) return;
    rpc({ type: 'dex.trending', limit: 50 })
      .then((pairs) => {
        const out: TokenMeta[] = [];
        for (const p of pairs) {
          if (!p.baseToken?.address) continue;
          out.push({
            symbol: p.baseToken.symbol ?? 'TOKEN',
            name: p.baseToken.name ?? p.baseToken.symbol ?? 'Token',
            address: safeChecksum(p.baseToken.address),
            decimals: 18,
            logo: p.info?.imageUrl,
          });
        }
        setTrending(out);
      })
      .catch(() => {});
  }, [open]);

  // DexScreener search for typed input (symbol or 0x address)
  useEffect(() => {
    const q = query.trim();
    if (!q || q.length < 2) {
      setSearchHits([]);
      return;
    }
    setSearching(true);
    const t = window.setTimeout(async () => {
      try {
        const pair = await rpc({ type: 'dex.token', query: q });
        if (pair?.baseToken?.address) {
          setSearchHits([{
            symbol: pair.baseToken.symbol ?? q,
            name: pair.baseToken.name ?? pair.baseToken.symbol ?? q,
            address: safeChecksum(pair.baseToken.address),
            decimals: 18,
            logo: pair.info?.imageUrl,
          }]);
          return;
        }
        setSearchHits([]);
      } catch {
        setSearchHits([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => window.clearTimeout(t);
  }, [query]);

  const sections = useMemo(() => {
    const filtered = (xs: TokenMeta[]) =>
      searchTokens(query, xs).filter(t => !exclude || tokenKey(t) !== tokenKey(exclude));
    const seen = new Set<string>();
    if (exclude) seen.add(tokenKey(exclude));
    const dedup = (xs: TokenMeta[]) => xs.filter((t) => {
      const k = tokenKey(t);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const top = dedup(filtered(TOP_TOKENS));
    const yours = dedup(filtered(walletTokens));
    const trend = dedup(filtered(trending));
    const hits = dedup(searchHits.filter(t => !exclude || tokenKey(t) !== tokenKey(exclude)));

    return { top, yours, trend, hits };
  }, [query, trending, walletTokens, searchHits, exclude]);

  const totalResults =
    sections.top.length + sections.yours.length + sections.trend.length + sections.hits.length;

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/70 flex items-end z-30" onClick={onClose}>
      <div
        className="w-full rounded-t-2xl max-h-[90vh] flex flex-col"
        style={{ backgroundColor: '#002849' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-white" style={{ fontSize: 18 }}>Select a token</h3>
            <button
              onClick={onClose}
              className="text-white leading-none font-extrabold hover:opacity-80"
              style={{ fontSize: 28 }}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <input
            autoFocus
            className="w-full rounded-xl bg-white px-3 py-2.5 font-bold text-black placeholder:text-black/60 focus:outline-none"
            style={{ fontSize: 16 }}
            placeholder="Search Tokens"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {sections.top.length > 0 && (
            <Section title="Top tokens" tokens={sections.top} onPick={onPick} stats={stats} />
          )}
          {sections.yours.length > 0 && (
            <Section title="Your tokens" tokens={sections.yours} onPick={onPick} stats={stats} />
          )}
          {sections.hits.length > 0 && (
            <Section title="From DexScreener" tokens={sections.hits} onPick={onPick} stats={stats} />
          )}
          {sections.trend.length > 0 && (
            <Section title="🔥 Trending on ApeChain" tokens={sections.trend} onPick={onPick} stats={stats} />
          )}

          {searching && totalResults === 0 && (
            <div className="text-center text-white/85 py-6" style={{ fontSize: 16 }}>Searching DexScreener…</div>
          )}
          {!searching && totalResults === 0 && (
            <div className="text-center text-white/85 py-6" style={{ fontSize: 16 }}>
              No matches.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  tokens,
  onPick,
  stats,
}: {
  title: string;
  tokens: TokenMeta[];
  onPick: (t: TokenMeta) => void;
  stats: Record<string, TokenStats>;
}) {
  return (
    <>
      <div
        className="uppercase tracking-wider text-white/70 px-3 mt-2 mb-1 font-bold"
        style={{ fontSize: 13 }}
      >
        {title}
      </div>
      {tokens.map((t) => {
        const k = tokenKey(t);
        const s = stats[k];
        const balN = s?.balance ? parseFloat(s.balance) : null;
        const usd =
          balN != null && s?.priceUsd != null && s.priceUsd > 0 ? balN * s.priceUsd : null;
        return (
          <button
            key={k}
            onClick={() => onPick(t)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/10 text-left"
          >
            <TokenLogo token={t} size={42} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-white" style={{ fontSize: 16 }}>{t.symbol}</span>
                {t.verified && (
                  <img
                    src={verifiedIconUrl}
                    alt="Verified"
                    title="Verified"
                    className="inline-block"
                    style={{ width: 14, height: 14 }}
                  />
                )}
              </div>
              <div className="text-white/70 truncate" style={{ fontSize: 13 }}>
                {t.name} {!isNative(t) && <span className="font-mono">· {shortAddress(t.address)}</span>}
              </div>
            </div>
            {balN != null && balN > 0 && (
              <div className="text-right shrink-0">
                <div className="font-bold text-white" style={{ fontSize: 14 }}>
                  {balN.toLocaleString(undefined, { maximumFractionDigits: 3 })}
                </div>
                {usd != null && (
                  <div className="text-white/70" style={{ fontSize: 12 }}>
                    ${usd.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}
                  </div>
                )}
              </div>
            )}
          </button>
        );
      })}
    </>
  );
}
