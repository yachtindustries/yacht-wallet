import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BottomNav, Page, Screen, TopBar } from '../components/Layout';
import { rpc } from '@/lib/messaging';
import type { DexPair } from '@/lib/dexscreener';

interface ApeChainApp {
  name: string;
  url: string;
  imgUrl: string;
}

const APECHAIN_APPS: ApeChainApp[] = [
  // 2x2 grid; row order is Otherside / OpenSea on top, DexScreener / Camelot below.
  { name: 'Otherside',   url: 'https://www.otherside.xyz',                       imgUrl: chrome.runtime.getURL('app-otherside.png') },
  { name: 'OpenSea',     url: 'https://opensea.io/collections?chains=ape_chain', imgUrl: chrome.runtime.getURL('app-opensea.png') },
  { name: 'DexScreener', url: 'https://dexscreener.com/apechain',                imgUrl: chrome.runtime.getURL('app-dexscreener.png') },
  { name: 'Camelot',     url: 'https://app.camelot.exchange',                    imgUrl: chrome.runtime.getURL('app-camelot.png') },
];

export default function SearchScreen() {
  const nav = useNavigate();
  const [trending, setTrending] = useState<DexPair[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<DexPair[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    setLoading(true);
    rpc({ type: 'dex.trending', limit: 15 })
      .then((t) => setTrending(t))
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    const t = window.setTimeout(async () => {
      try {
        const pair = await rpc({ type: 'dex.token', query: q });
        setSearchResults(pair ? [pair] : []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => window.clearTimeout(t);
  }, [query]);

  const showing = searchResults ?? trending;

  return (
    <Screen>
      <TopBar title="Discover" onBack={() => nav('/')} tone="deck" />
      <Page tone="deck">
        <input
          className="w-full bg-white border border-white rounded-xl px-3 py-2.5 text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-white mb-4"
          style={{ fontSize: 17 }}
          placeholder="Search Tokens"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        {/* ApeChain apps — moved above trending tokens */}
        {!searchResults && (
          <div className="mb-4">
            <h2 className="uppercase tracking-wider text-ink-dim mb-2 px-1 font-bold" style={{ fontSize: 13 }}>
              ApeChain Apps
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {APECHAIN_APPS.map((a) => (
                <a
                  key={a.name}
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-2xl overflow-hidden hover:opacity-80 transition"
                  title={a.name}
                  aria-label={a.name}
                >
                  <img src={a.imgUrl} alt={a.name} className="w-full h-auto block" />
                </a>
              ))}
            </div>
          </div>
        )}

        <h2 className="uppercase tracking-wider text-ink-dim mb-2 px-1 font-bold" style={{ fontSize: 13 }}>
          {searchResults ? 'Search results' : 'Trending on ApeChain'}
        </h2>
        {(loading || searching) && <div className="text-ink-dim" style={{ fontSize: 17 }}>Loading…</div>}
        {err && <div className="text-danger" style={{ fontSize: 14 }}>{err}</div>}
        <div className="space-y-2">
          {showing.map((p) => {
            const change = p.priceChange?.h24;
            const changeColor = change == null ? 'text-ink-dim' : change >= 0 ? 'text-brand' : 'text-danger';
            return (
              <Link
                key={p.pairAddress}
                to={`/token/${encodeURIComponent(p.baseToken.address)}`}
                className="card flex items-center gap-3 hover:border-brand"
              >
                {p.info?.imageUrl ? (
                  <img
                    src={p.info.imageUrl}
                    alt={p.baseToken.symbol}
                    className="w-11 h-11 rounded-full bg-bg-soft border border-line object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : (
                  <div className="w-11 h-11 rounded-full bg-brand/15 border border-brand/30 flex items-center justify-center font-bold text-brand shrink-0" style={{ fontSize: 14 }}>
                    {p.baseToken.symbol.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <div className="font-bold truncate" style={{ fontSize: 17 }}>{p.baseToken.symbol}</div>
                    <div className="font-bold" style={{ fontSize: 17 }}>
                      {p.priceUsd ? `$${formatPrice(parseFloat(p.priceUsd))}` : '—'}
                    </div>
                  </div>
                  <div className="flex items-center justify-between" style={{ fontSize: 13 }}>
                    <span className="text-ink-faint truncate">
                      {p.baseToken.name ?? p.baseToken.symbol} · vol ${formatBig(p.volume?.h24 ?? 0)}
                    </span>
                    <span className={`${changeColor}`}>
                      {change == null ? '' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
          {showing.length === 0 && !loading && !searching && (
            <div className="card text-center text-ink-dim py-6" style={{ fontSize: 16 }}>
              {searchResults ? 'No matching ApeChain token found.' : 'No trending tokens right now.'}
            </div>
          )}
        </div>
      </Page>
      <BottomNav />
    </Screen>
  );
}

function formatPrice(n: number): string {
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  if (n >= 0.01) return n.toFixed(4);
  return n.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
}

function formatBig(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}
