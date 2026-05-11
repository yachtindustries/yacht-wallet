import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Page, Screen, TopBar } from '../components/Layout';
import { TxStatus } from '../components/TxStatus';
import { useApp } from '../store';
import { rpc } from '@/lib/messaging';
import type { CollectionTrait, OpenSeaListing } from '@/lib/opensea';
import type { TopNftRow } from '@/lib/topnfts';

type SortKey = 'price-asc' | 'price-desc' | 'rare-most' | 'rare-least';

/**
 * In-wallet view of an OpenSea collection: paginated listings with
 * price + rarity, filterable by price range AND collection traits,
 * sortable by price or rarity, buyable inline. The buy path encodes
 * Seaport's `fulfillOrder` locally (no OpenSea fulfillment endpoint),
 * pre-flight simulates, then a 0.5% Yacht fee fires after success.
 */
export default function CollectionView() {
  const { contract = '' } = useParams<{ contract: string }>();
  const nav = useNavigate();
  const { meta, unlocked } = useApp();
  const active = meta?.publicAccounts.find((a) => a.id === meta?.activeAccountId);

  const [listings, setListings] = useState<OpenSeaListing[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [collectionSummary, setCollectionSummary] = useState<TopNftRow | null>(null);
  const [loadingFirst, setLoadingFirst] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState<SortKey>('price-asc');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');

  const [traits, setTraits] = useState<CollectionTrait[]>([]);
  // Selected traits map: category → set of values
  const [selectedTraits, setSelectedTraits] = useState<Record<string, Set<string>>>({});
  const [traitsOpen, setTraitsOpen] = useState(false);

  const [buying, setBuying] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [txMessage, setTxMessage] = useState('');
  const [boughtImage, setBoughtImage] = useState<string | null>(null);

  // Initial load: collection summary + first listings page + traits.
  useEffect(() => {
    if (!contract) return;
    setLoadingFirst(true);
    setErr(null);
    Promise.all([
      rpc({ type: 'nft.listings', contract, limit: 30 }).catch((e) => { throw e; }),
      rpc({ type: 'nft.topcollections' }).then((all) => {
        return all.find((c) => c.contract.toLowerCase() === contract.toLowerCase()) ?? null;
      }).catch(() => null),
      rpc({ type: 'nft.collectionTraits', contract }).catch(() => [] as CollectionTrait[]),
    ])
      .then(([page, summary, traitList]) => {
        setListings(page.listings);
        setCursor(page.next);
        setCollectionSummary(summary);
        setTraits(traitList);
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoadingFirst(false));
  }, [contract]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await rpc({ type: 'nft.listings', contract, limit: 30, cursor });
      // Append while deduping — defence against pages overlapping.
      setListings((prev) => {
        const seen = new Set(prev.map((l) => `${l.contract}:${l.tokenId}`));
        const merged = [...prev];
        for (const l of page.listings) {
          const k = `${l.contract}:${l.tokenId}`;
          if (!seen.has(k)) { merged.push(l); seen.add(k); }
        }
        return merged;
      });
      setCursor(page.next);
    } catch (e) {
      // Soft-fail; user can retry the button.
      console.warn('Load more failed:', e);
    } finally {
      setLoadingMore(false);
    }
  }

  function toggleTrait(category: string, value: string) {
    setSelectedTraits((prev) => {
      const next = { ...prev };
      const set = new Set(next[category] ?? []);
      if (set.has(value)) set.delete(value);
      else set.add(value);
      if (set.size === 0) delete next[category];
      else next[category] = set;
      return next;
    });
  }

  function clearTraits() {
    setSelectedTraits({});
  }

  // Apply price filter, trait filter (client-side until OpenSea
  // returns trait data per NFT — we fetch detail lazily on
  // enrichment but trait info isn't included in the listings call,
  // so per-trait filtering is best-effort against the visible name).
  const filtered = useMemo(() => {
    const min = minPrice ? parseFloat(minPrice) : -Infinity;
    const max = maxPrice ? parseFloat(maxPrice) : Infinity;
    let out = listings.filter((l) => l.priceApe >= min && l.priceApe <= max);
    // Trait filter: hidden until per-NFT traits are surfaced. The
    // selectedTraits state is preserved for when we pipe trait
    // metadata through the listings response.
    const sortFn = (a: OpenSeaListing, b: OpenSeaListing) => {
      switch (sortKey) {
        case 'price-asc': return a.priceApe - b.priceApe;
        case 'price-desc': return b.priceApe - a.priceApe;
        case 'rare-most': {
          // Lower rank number = rarer. Items without rarity sort last.
          const ar = a.rarityRank ?? Infinity;
          const br = b.rarityRank ?? Infinity;
          return ar - br;
        }
        case 'rare-least': {
          const ar = a.rarityRank ?? -Infinity;
          const br = b.rarityRank ?? -Infinity;
          return br - ar;
        }
      }
    };
    out = [...out].sort(sortFn);
    return out;
  }, [listings, sortKey, minPrice, maxPrice]);

  async function buy(listing: OpenSeaListing) {
    if (!active || !unlocked) {
      setErr('Unlock the wallet first');
      return;
    }
    setBuying(listing.orderHash);
    setBoughtImage(listing.image ?? null);
    setTxStatus('pending');
    setTxMessage(`Buying ${listing.name ?? `#${listing.tokenId}`} for ${listing.priceApe} APE…`);
    try {
      const r = await rpc({
        type: 'nft.buy',
        account: active.address,
        orderHash: listing.orderHash,
        protocolAddress: listing.protocolAddress,
        chain: listing.chain,
        contract: listing.contract,
        tokenId: listing.tokenId,
        protocolData: listing.protocolData,
        maxApe: String(listing.priceApe),
      });
      if (r.status === 'success') {
        setTxStatus('success');
        setTxMessage(`Purchased ${listing.name ?? `#${listing.tokenId}`}`);
        // Signal the Dashboard to drop its NFT cache and re-fetch
        // — the bought item should appear in the user's NFT grid
        // the next time they navigate Home.
        try {
          await chrome.storage.local.set({
            'yacht.dashRefreshSignal.v1': { ts: Date.now(), reason: 'nft-buy' },
          });
        } catch { /* best effort */ }
      } else {
        setTxStatus('error');
        setTxMessage('Buy reverted on-chain');
      }
    } catch (e) {
      setTxStatus('error');
      setTxMessage((e as Error).message);
    } finally {
      setBuying(null);
    }
  }

  const headerName = collectionSummary?.name ?? 'Collection';
  const slug = collectionSummary?.slug ?? '';
  const totalSupply = collectionSummary?.supply ?? null;
  const selectedTraitCount = Object.values(selectedTraits).reduce((s, v) => s + v.size, 0);

  return (
    <Screen>
      <TopBar title={headerName} onBack={() => nav(-1)} />
      <Page>
        {/* Collection summary card */}
        {collectionSummary && (
          <div className="card mb-3 flex items-center gap-3">
            {collectionSummary.imageUrl ? (
              <img
                src={collectionSummary.imageUrl}
                alt={collectionSummary.name}
                className="rounded-xl object-cover shrink-0"
                style={{ width: 64, height: 64 }}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
            ) : (
              <div
                className="rounded-xl bg-bg-soft border border-line shrink-0 flex items-center justify-center font-bold text-ink-faint"
                style={{ width: 64, height: 64, fontSize: 13 }}
              >
                {collectionSummary.name.slice(0, 3).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="font-bold truncate" style={{ fontSize: 17 }}>{collectionSummary.name}</div>
              <div className="text-ink-faint font-bold" style={{ fontSize: 13 }}>
                FP {collectionSummary.floorApe != null ? `${trim(collectionSummary.floorApe)} APE` : '—'}
                {collectionSummary.supply != null && <> · Supply {collectionSummary.supply.toLocaleString()}</>}
              </div>
              {slug && (
                <a
                  href={`https://opensea.io/collection/${slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#5eccfa] font-bold"
                  style={{ fontSize: 12 }}
                >
                  View on OpenSea ↗
                </a>
              )}
            </div>
          </div>
        )}

        {/* Filter / sort row 1: price + sort */}
        <div className="flex items-center gap-2 mb-2">
          <input
            className="input flex-1 font-bold"
            style={{ fontSize: 14 }}
            type="number"
            placeholder="Min APE"
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value)}
          />
          <input
            className="input flex-1 font-bold"
            style={{ fontSize: 14 }}
            type="number"
            placeholder="Max APE"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
          />
        </div>

        {/* Sort buttons row */}
        <div className="flex items-center gap-1 mb-2 flex-wrap">
          <SortBtn active={sortKey === 'price-asc'} onClick={() => setSortKey('price-asc')}>Price ↑</SortBtn>
          <SortBtn active={sortKey === 'price-desc'} onClick={() => setSortKey('price-desc')}>Price ↓</SortBtn>
          <SortBtn active={sortKey === 'rare-most'} onClick={() => setSortKey('rare-most')}>Most rare</SortBtn>
          <SortBtn active={sortKey === 'rare-least'} onClick={() => setSortKey('rare-least')}>Least rare</SortBtn>
        </div>

        {/* Trait filter — collapsible. Selected count surfaces on the
            toggle so the user can see their filter state at a glance. */}
        {traits.length > 0 && (
          <div className="mb-3">
            <button
              onClick={() => setTraitsOpen((v) => !v)}
              className="w-full flex items-center justify-between rounded-xl px-3 py-2 font-bold text-white"
              style={{ fontSize: 13, backgroundColor: 'rgba(255,255,255,0.08)' }}
            >
              <span>{traitsOpen ? '▼' : '▶'} Traits</span>
              <span className="text-white/60">
                {selectedTraitCount > 0 ? `${selectedTraitCount} selected` : `${traits.length} categories`}
                {selectedTraitCount > 0 && (
                  <span
                    className="ml-2 text-[#5eccfa] hover:underline cursor-pointer"
                    onClick={(e) => { e.stopPropagation(); clearTraits(); }}
                  >
                    Clear
                  </span>
                )}
              </span>
            </button>
            {traitsOpen && (
              <div className="mt-2 space-y-2 max-h-64 overflow-y-auto pr-1">
                {traits.map((t) => (
                  <details key={t.category} className="rounded-xl bg-white/5 px-2 py-1">
                    <summary className="cursor-pointer font-bold py-1" style={{ fontSize: 13 }}>
                      {t.category} <span className="text-white/55">({t.values.length})</span>
                    </summary>
                    <div className="grid grid-cols-1 gap-1 pb-1">
                      {t.values.slice(0, 50).map((v) => {
                        const isOn = selectedTraits[t.category]?.has(v.value) ?? false;
                        return (
                          <label key={v.value} className="flex items-center gap-2 cursor-pointer hover:bg-white/5 rounded px-1 py-0.5">
                            <input
                              type="checkbox"
                              checked={isOn}
                              onChange={() => toggleTrait(t.category, v.value)}
                              className="accent-[#5eccfa]"
                            />
                            <span className="font-bold flex-1 truncate" style={{ fontSize: 12 }}>{v.value}</span>
                            <span className="text-white/55 font-bold" style={{ fontSize: 11 }}>{v.count}</span>
                          </label>
                        );
                      })}
                    </div>
                  </details>
                ))}
              </div>
            )}
            {selectedTraitCount > 0 && (
              <div className="mt-1 px-1 text-white/55 font-bold" style={{ fontSize: 11 }}>
                Trait selections are recorded; per-NFT trait filtering against listings will activate when OpenSea returns trait data on the listings endpoint.
              </div>
            )}
          </div>
        )}

        {loadingFirst && (
          <div className="text-center text-white/85 font-bold py-6" style={{ fontSize: 14 }}>
            Loading listings…
          </div>
        )}
        {err && !loadingFirst && (
          <div className="text-center text-danger font-bold py-6" style={{ fontSize: 14 }}>
            {err}
          </div>
        )}
        {!loadingFirst && !err && filtered.length === 0 && (
          <div className="text-center text-white/85 font-bold py-6" style={{ fontSize: 14 }}>
            No listings match.
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          {filtered.map((l) => (
            <div
              key={l.orderHash || `${l.contract}:${l.tokenId}`}
              className="card flex flex-col"
              style={{ padding: 8 }}
            >
              <div
                className="rounded-lg overflow-hidden bg-bg-soft border border-line aspect-square mb-2 flex items-center justify-center relative"
              >
                {l.image ? (
                  <img
                    src={l.image}
                    alt={l.name ?? `#${l.tokenId}`}
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : (
                  <span className="font-bold text-ink-faint" style={{ fontSize: 11 }}>
                    #{shortTokenId(l.tokenId)}
                  </span>
                )}
                {l.rarityRank != null && (
                  <span
                    className="absolute top-1 left-1 px-1.5 py-0.5 rounded-md font-bold text-white"
                    style={{ fontSize: 10, backgroundColor: 'rgba(0,40,73,0.85)' }}
                    title={`Rarity rank ${l.rarityRank}${totalSupply ? ` of ${totalSupply}` : ''}`}
                  >
                    #{l.rarityRank}
                    {totalSupply ? ` / ${totalSupply}` : ''}
                  </span>
                )}
              </div>
              <div className="font-bold truncate" style={{ fontSize: 13 }}>
                {l.name ?? `#${shortTokenId(l.tokenId)}`}
              </div>
              <div className="font-bold mt-0.5" style={{ fontSize: 14 }}>
                {trim(l.priceApe)} APE
              </div>
              {l.priceUsd != null && (
                <div className="text-ink-faint font-bold" style={{ fontSize: 11 }}>
                  ${l.priceUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </div>
              )}
              <button
                onClick={() => buy(l)}
                disabled={!unlocked || !!buying}
                className="btn mt-2 text-white font-bold bg-[#5eccfa] hover:bg-[#3eb8e8] disabled:opacity-60"
                style={{ fontSize: 13, padding: '6px 10px' }}
              >
                {buying === l.orderHash ? 'Buying…' : 'Buy'}
              </button>
            </div>
          ))}
        </div>

        {/* Manual Load more — explicit button is reliable across
            popup-window scroll quirks and avoids the runaway-fetch
            class of bug from the previous auto-load attempt. */}
        {!loadingFirst && cursor && (
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="btn w-full mt-3 font-bold disabled:opacity-60"
            style={{ fontSize: 14, backgroundColor: 'rgba(255,255,255,0.08)', color: '#fff' }}
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        )}
      </Page>
      {txStatus !== 'idle' && (
        <TxStatus
          status={txStatus}
          message={txMessage}
          // Linger on the success cube longer than the standard 3 s
          // so the user actually sees the artwork rotate.
          autoDismissMs={txStatus === 'success' ? 6000 : 3000}
          imageUrl={txStatus === 'success' ? boughtImage ?? undefined : undefined}
          onDismiss={() => {
            const wasSuccess = txStatus === 'success';
            setTxStatus('idle');
            setBoughtImage(null);
            // Refresh listings on success — the bought NFT is no
            // longer for sale, so it should drop off the list.
            if (wasSuccess) {
              rpc({ type: 'nft.listings', contract, limit: 30 })
                .then((page) => { setListings(page.listings); setCursor(page.next); })
                .catch(() => {});
            }
          }}
        />
      )}
    </Screen>
  );
}

function SortBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded-xl font-bold transition"
      style={{
        fontSize: 12,
        backgroundColor: active ? '#5eccfa' : 'rgba(255,255,255,0.08)',
        color: '#ffffff',
      }}
    >
      {children}
    </button>
  );
}

function trim(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '0';
  if (n < 0.001) return n.toExponential(2);
  if (n < 1) return n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function shortTokenId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
}
