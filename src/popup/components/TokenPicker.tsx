import { useEffect, useMemo, useState } from 'react';
import { isNative, searchTokens, TokenMeta, tokenKey, TOP_TOKENS, safeChecksum } from '@/lib/tokens';
import { rpc } from '@/lib/messaging';
import { isValidEvmAddress, shortAddress } from '@/lib/wallet-utils';
import { TokenLogo } from './TokenLogo';

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (t: TokenMeta) => void;
  /** Tokens the user already holds — usually the dashboard ERC-20 list. */
  walletTokens?: TokenMeta[];
  exclude?: TokenMeta;
}

export function TokenPicker({ open, onClose, onPick, walletTokens = [], exclude }: Props) {
  const [query, setQuery] = useState('');
  const [trending, setTrending] = useState<TokenMeta[]>([]);
  const [searchHits, setSearchHits] = useState<TokenMeta[]>([]);
  const [searching, setSearching] = useState(false);
  const [pasteAddr, setPasteAddr] = useState('');
  const [pasteErr, setPasteErr] = useState<string | null>(null);

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

  function tryAddPasted() {
    setPasteErr(null);
    try {
      if (!isValidEvmAddress(pasteAddr.trim())) throw new Error('Invalid contract address');
      const addr = safeChecksum(pasteAddr.trim());
      onPick({
        symbol: 'TOKEN',
        name: 'Custom token',
        address: addr,
        decimals: 18,
      });
      setPasteAddr('');
    } catch (e) {
      setPasteErr((e as Error).message);
    }
  }

  const totalResults =
    sections.top.length + sections.yours.length + sections.trend.length + sections.hits.length;

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/70 flex items-end z-30" onClick={onClose}>
      <div
        className="bg-bg-card border-t border-line w-full rounded-t-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-line">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Select a token</h3>
            <button onClick={onClose} className="text-ink-dim text-lg leading-none">×</button>
          </div>
          <input
            autoFocus
            className="input"
            placeholder="Symbol, name, or paste contract (0x…)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {sections.top.length > 0 && (
            <Section title="Top tokens" tokens={sections.top} onPick={onPick} />
          )}
          {sections.yours.length > 0 && (
            <Section title="Your tokens" tokens={sections.yours} onPick={onPick} />
          )}
          {sections.hits.length > 0 && (
            <Section title="From DexScreener" tokens={sections.hits} onPick={onPick} />
          )}
          {sections.trend.length > 0 && (
            <Section title="🔥 Trending on ApeChain" tokens={sections.trend} onPick={onPick} />
          )}

          {searching && totalResults === 0 && (
            <div className="text-center text-ink-dim text-sm py-6">Searching DexScreener…</div>
          )}
          {!searching && totalResults === 0 && (
            <div className="text-center text-ink-dim text-sm py-6">
              No matches. Paste the contract address below.
            </div>
          )}
        </div>

        <div className="p-4 border-t border-line">
          <details>
            <summary className="text-xs text-ink-dim cursor-pointer">Add by contract address</summary>
            <div className="mt-2 space-y-2">
              <input
                className="input font-mono text-xs"
                placeholder="0x…"
                value={pasteAddr}
                onChange={(e) => setPasteAddr(e.target.value)}
              />
              {pasteErr && <div className="text-danger text-xs">{pasteErr}</div>}
              <button className="btn-ghost w-full" onClick={tryAddPasted}>
                Use this token
              </button>
              <p className="text-[10px] text-ink-faint">
                Only add contracts you trust. Verify the address on the explorer first.
              </p>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

function Section({ title, tokens, onPick }: { title: string; tokens: TokenMeta[]; onPick: (t: TokenMeta) => void }) {
  return (
    <>
      <div className="text-[10px] uppercase tracking-wider text-ink-faint px-3 mt-2 mb-1">{title}</div>
      {tokens.map((t) => (
        <button
          key={tokenKey(t)}
          onClick={() => onPick(t)}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-bg-soft text-left"
        >
          <TokenLogo token={t} size={32} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium">{t.symbol}</span>
              {t.verified && <span className="text-[10px] text-brand">✓</span>}
            </div>
            <div className="text-[11px] text-ink-faint truncate">
              {t.name} {!isNative(t) && <span className="font-mono">· {shortAddress(t.address)}</span>}
            </div>
          </div>
        </button>
      ))}
    </>
  );
}
