// OpenSea v2 API helpers + Seaport-encoded fulfillment for the
// Collection-View screen.
//
// What lives here:
//   • getCollectionListings — paginated, deduped listings with
//     image + rarity, optional trait filter.
//   • getCollectionTraits — trait dictionary so the UI can render
//     filter checkboxes.
//   • buildSeaportFulfillTx — encodes Seaport's `fulfillOrder` from
//     the listing's `protocol_data` directly. We NO LONGER use
//     OpenSea's /listings/fulfillment_data endpoint — its response
//     shape is structured (function name + decoded args) and varies
//     by listing type, which the previous build crashed on. Using
//     the listing's signed Seaport order is deterministic and we
//     already have everything we need.
//
// All public-data calls authenticate with the user's OpenSea API
// key (read-only). Read keys cannot move funds.

import { Interface, formatUnits } from 'ethers';

const OPENSEA_BASE = 'https://api.opensea.io/api/v2';
const OPENSEA_KEY = '4ae0d12d95e4454cb9a4831ccc6fd103';
/** OpenSea's identifier for ApeChain across asset URLs and APIs. */
export const OPENSEA_APECHAIN = 'ape_chain';

export interface OpenSeaListing {
  /** Seaport order hash — primary key for fulfillment. */
  orderHash: string;
  protocolAddress: string;
  chain: string;
  contract: string;
  tokenId: string;
  /** Display-units APE price. */
  priceApe: number;
  priceUsd: number | null;
  sellerAddress: string;
  /** Resolved during enrichment; may be null on failure. */
  name: string | null;
  image: string | null;
  /** Rarity rank within the collection (1 = rarest). May be null. */
  rarityRank: number | null;
  /** Total supply used to render "rank/total". May be null. */
  rarityTotal: number | null;
  /** The full Seaport order — needed by the wallet to construct the
   * fulfillOrder transaction. We store it as opaque JSON-string so
   * the messaging boundary doesn't need to know the Seaport schema. */
  protocolData: any;
}

export interface CollectionTrait {
  /** Trait category, e.g. "Background". */
  category: string;
  /** Distinct values within that category, with counts. */
  values: { value: string; count: number }[];
}

interface RawListing {
  order_hash?: string;
  chain?: string;
  protocol_address?: string;
  protocol_data?: any;
  price?: { current?: { value?: string; decimals?: number; currency?: string } };
}

function headers(): HeadersInit {
  return { accept: 'application/json', 'X-API-KEY': OPENSEA_KEY };
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

// ─── Per-NFT helpers used by the Home grid ────────────────────────────────

const FLOOR_CACHE_KEY = 'yacht.osFloors.v1';
const FLOOR_TTL_MS = 60 * 60 * 1000; // 1h

interface FloorCacheEntry { floorApe: number | null; slug: string | null; cachedAt: number }

async function readFloorCache(): Promise<Record<string, FloorCacheEntry>> {
  try {
    const r = await chrome.storage.local.get(FLOOR_CACHE_KEY);
    const v = r[FLOOR_CACHE_KEY];
    return v && typeof v === 'object' ? (v as Record<string, FloorCacheEntry>) : {};
  } catch { return {}; }
}
async function writeFloorCache(c: Record<string, FloorCacheEntry>): Promise<void> {
  try { await chrome.storage.local.set({ [FLOOR_CACHE_KEY]: c }); } catch { /* best effort */ }
}

/** Resolve a collection's floor price (in APE) from a contract
 * address. We keep a local 1-hour cache so dashboard re-renders
 * don't hit OpenSea every time the NFT view opens. */
export async function getCollectionFloorByContract(
  chain: string,
  contract: string,
): Promise<{ floorApe: number | null; slug: string | null }> {
  const lc = contract.toLowerCase();
  const cache = await readFloorCache();
  const cached = cache[lc];
  if (cached && Date.now() - cached.cachedAt < FLOOR_TTL_MS) {
    return { floorApe: cached.floorApe, slug: cached.slug };
  }
  let floorApe: number | null = null;
  let slug: string | null = null;
  try {
    const r = await withTimeout(
      fetch(`${OPENSEA_BASE}/chain/${encodeURIComponent(chain)}/contract/${encodeURIComponent(contract)}`, { headers: headers() }),
      6000,
    );
    if (r.ok) {
      const j: any = await r.json();
      slug = typeof j?.collection === 'string' ? j.collection : null;
    }
    if (slug) {
      const r2 = await withTimeout(
        fetch(`${OPENSEA_BASE}/collections/${encodeURIComponent(slug)}/stats`, { headers: headers() }),
        6000,
      );
      if (r2.ok) {
        const j2: any = await r2.json();
        const f = j2?.total?.floor_price ?? j2?.floor_price;
        if (typeof f === 'number') floorApe = f;
        else if (typeof f === 'string') {
          const n = parseFloat(f);
          if (Number.isFinite(n)) floorApe = n;
        }
      }
    }
  } catch { /* swallow — caller treats missing as "—" */ }
  cache[lc] = { floorApe, slug, cachedAt: Date.now() };
  await writeFloorCache(cache);
  return { floorApe, slug };
}

/** Per-NFT detail: name + image + rarity rank. Lazy-fetched on
 * hover so we don't hit OpenSea for every NFT in the grid. */
export async function getNftDetailByContract(
  chain: string,
  contract: string,
  tokenId: string,
): Promise<{ name: string | null; image: string | null; rarityRank: number | null }> {
  try {
    const r = await withTimeout(
      fetch(
        `${OPENSEA_BASE}/chain/${encodeURIComponent(chain)}/contract/${encodeURIComponent(contract)}/nfts/${encodeURIComponent(tokenId)}`,
        { headers: headers() },
      ),
      6000,
    );
    if (!r.ok) return { name: null, image: null, rarityRank: null };
    const j: any = await r.json();
    const nft = j?.nft;
    return {
      name: typeof nft?.name === 'string' ? nft.name : null,
      image: typeof nft?.display_image_url === 'string' ? nft.display_image_url
        : typeof nft?.image_url === 'string' ? nft.image_url : null,
      rarityRank: typeof nft?.rarity?.rank === 'number' ? nft.rarity.rank : null,
    };
  } catch { return { name: null, image: null, rarityRank: null }; }
}

// ─── Listings ─────────────────────────────────────────────────────────────

interface ListingsResponse {
  listings: RawListing[];
  next: string | null;
}

async function fetchRawListings(slug: string, opts: { limit: number; cursor?: string }): Promise<ListingsResponse> {
  const params = new URLSearchParams();
  params.set('limit', String(opts.limit));
  if (opts.cursor) params.set('next', opts.cursor);
  // /best_listings returns the cheapest active listing per NFT —
  // exactly what we want to render in a buy grid. We use it as the
  // primary source for *display*. The buy path doesn't depend on
  // protocol_data being present on these listings; it fetches the
  // full Seaport order from OpenSea's fulfillment endpoint at
  // click-time (see getListingFulfillmentOrder).
  let url = `${OPENSEA_BASE}/listings/collection/${encodeURIComponent(slug)}/best_listings?${params}`;
  let r = await withTimeout(fetch(url, { headers: headers() }), 10000);
  if (!r.ok) {
    // Some collections / API revisions only expose /all. Fall back.
    url = `${OPENSEA_BASE}/listings/collection/${encodeURIComponent(slug)}/all?${params}`;
    r = await withTimeout(fetch(url, { headers: headers() }), 10000);
    if (!r.ok) return { listings: [], next: null };
  }
  const j: any = await r.json();
  return {
    listings: Array.isArray(j?.listings) ? j.listings : [],
    next: typeof j?.next === 'string' ? j.next : null,
  };
}

interface RawNft {
  identifier?: string;
  name?: string;
  image_url?: string;
  display_image_url?: string;
  rarity?: { rank?: number };
}

async function fetchNftDetail(chain: string, contract: string, tokenId: string): Promise<RawNft | null> {
  try {
    const url = `${OPENSEA_BASE}/chain/${encodeURIComponent(chain)}/contract/${encodeURIComponent(contract)}/nfts/${encodeURIComponent(tokenId)}`;
    const r = await withTimeout(fetch(url, { headers: headers() }), 8000);
    if (!r.ok) return null;
    const j: any = await r.json();
    return j?.nft ?? null;
  } catch { return null; }
}

export interface ListingsPage {
  listings: OpenSeaListing[];
  /** Pass back to the next call to fetch the next page. Null when there are no more. */
  next: string | null;
}

/**
 * Paginated, deduped listings for a collection. The wallet calls
 * this on first open and again on each "Load more" click with the
 * `cursor` from the previous response.
 */
export async function getCollectionListings(
  slug: string,
  opts: {
    limit?: number;
    apeUsd?: number;
    cursor?: string;
    /** Total supply, used for rarity-percentile display. */
    totalSupply?: number | null;
  } = {},
): Promise<ListingsPage> {
  const limit = Math.min(50, Math.max(1, opts.limit ?? 30));
  const apeUsd = opts.apeUsd ?? 0;

  const { listings: raw, next } = await fetchRawListings(slug, { limit, cursor: opts.cursor });

  // Dedupe by contract:tokenId, keeping the cheapest. Some endpoints
  // return multiple listings for the same NFT (sellers update price
  // or list at multiple tiers); we want one row per item.
  const byKey = new Map<string, OpenSeaListing>();
  for (const l of raw) {
    // Lenient: only require enough info to RENDER the row — the
    // NFT identity (offer.token + identifierOrCriteria) and the
    // current price. Protocol_data may be partial here; the buy
    // path fetches the full signed Seaport order from OpenSea's
    // fulfillment endpoint at click-time, so it doesn't need to be
    // complete on the listing itself.
    const offer = l.protocol_data?.parameters?.offer?.[0];
    if (!offer || typeof offer.token !== 'string' || typeof offer.identifierOrCriteria !== 'string') continue;
    const cur = l.price?.current;
    if (!cur || typeof cur.value !== 'string') continue;
    let priceApe = 0;
    try {
      const decimals = typeof cur.decimals === 'number' ? cur.decimals : 18;
      priceApe = parseFloat(formatUnits(BigInt(cur.value), decimals));
    } catch { continue; }
    const key = `${String(offer.token).toLowerCase()}:${String(offer.identifierOrCriteria)}`;
    const item: OpenSeaListing = {
      orderHash: l.order_hash ?? '',
      protocolAddress: l.protocol_address ?? '',
      chain: l.chain ?? OPENSEA_APECHAIN,
      contract: String(offer.token).toLowerCase(),
      tokenId: String(offer.identifierOrCriteria),
      priceApe,
      priceUsd: apeUsd > 0 ? priceApe * apeUsd : null,
      sellerAddress: l.protocol_data?.parameters?.offerer ?? '',
      name: null,
      image: null,
      rarityRank: null,
      rarityTotal: opts.totalSupply ?? null,
      protocolData: l.protocol_data,
    };
    const existing = byKey.get(key);
    if (!existing || item.priceApe < existing.priceApe) byKey.set(key, item);
  }
  const listings = [...byKey.values()].sort((a, b) => a.priceApe - b.priceApe);

  // Enrich each unique listing with image + name + rarity. With our
  // API key the per-NFT detail call is fast; doing them in parallel
  // is fine for ~30 unique NFTs per page.
  await Promise.all(
    listings.map(async (item) => {
      const nft = await fetchNftDetail(item.chain, item.contract, item.tokenId);
      if (nft) {
        item.name = nft.name ?? null;
        item.image = nft.display_image_url ?? nft.image_url ?? null;
        if (typeof nft.rarity?.rank === 'number') item.rarityRank = nft.rarity.rank;
      }
    }),
  );
  return { listings, next };
}

// ─── Collection traits ────────────────────────────────────────────────────

/**
 * Pulls the collection's trait dictionary from the OpenSea
 * collection endpoint. Returns categories with each value's count.
 */
export async function getCollectionTraits(slug: string): Promise<CollectionTrait[]> {
  try {
    const r = await withTimeout(
      fetch(`${OPENSEA_BASE}/collections/${encodeURIComponent(slug)}`, { headers: headers() }),
      8000,
    );
    if (!r.ok) return [];
    const j: any = await r.json();
    // OpenSea v2 collection responses differ slightly between API
    // versions; tolerate both `traits` (object map) and `traits.<cat>`
    // shapes.
    const t = j?.traits ?? j?.collection?.traits;
    if (!t || typeof t !== 'object') return [];
    const out: CollectionTrait[] = [];
    for (const [category, valuesObj] of Object.entries(t as Record<string, any>)) {
      const values: { value: string; count: number }[] = [];
      if (valuesObj && typeof valuesObj === 'object') {
        for (const [value, count] of Object.entries(valuesObj as Record<string, any>)) {
          const n = typeof count === 'number' ? count : parseInt(String(count), 10);
          if (!Number.isFinite(n) || n <= 0) continue;
          values.push({ value, count: n });
        }
      }
      if (values.length > 0) {
        values.sort((a, b) => b.count - a.count);
        out.push({ category, values });
      }
    }
    out.sort((a, b) => a.category.localeCompare(b.category));
    return out;
  } catch { return []; }
}

// ─── Order detail (for buy) ───────────────────────────────────────────────
//
// OpenSea's /listings/fulfillment_data endpoint returns a structured
// `transaction.input_data` that's awkward to re-encode. But the same
// response includes `orders[0].protocol_data` — the full signed
// Seaport order — which IS exactly what our local Seaport encoder
// needs. We hit fulfillment_data at buy-time purely to extract that.

async function postFulfillmentData(
  orderHash: string,
  protocolAddress: string,
  chain: string,
  fulfiller: string,
): Promise<any> {
  const body = {
    listing: { hash: orderHash, chain, protocol_address: protocolAddress },
    fulfiller: { address: fulfiller },
  };
  const r = await withTimeout(
    fetch(`${OPENSEA_BASE}/listings/fulfillment_data`, {
      method: 'POST',
      headers: { ...headers(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    15000,
  );
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`OpenSea fulfillment failed: HTTP ${r.status} ${text.slice(0, 200)}`);
  }
  return await r.json();
}

function txValueToWei(v: any): string {
  try {
    if (typeof v === 'number') return BigInt(Math.floor(v)).toString();
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'string') {
      if (v.startsWith('0x')) return BigInt(v).toString();
      return BigInt(v).toString();
    }
  } catch { /* fall through */ }
  return '0';
}

/**
 * Build the ready-to-submit Seaport buy tx for a listing — using
 * whichever Seaport function OpenSea recommends in its fulfillment
 * response. Single-NFT fixed-price ApeChain listings overwhelmingly
 * use the gas-optimized `fulfillBasicOrder_efficient_6GL6yc`, which
 * has a completely different parameters struct than `fulfillOrder`.
 * Encoding the wrong one for a basic-order listing makes Seaport
 * revert at simulation time. This helper picks per-listing.
 */
export async function getFulfillmentTx(
  orderHash: string,
  protocolAddress: string,
  chain: string,
  fulfiller: string,
): Promise<SeaportFulfillTx> {
  const j = await postFulfillmentData(orderHash, protocolAddress, chain, fulfiller);
  const tx = j?.fulfillment_data?.transaction;
  if (!tx?.function || !tx?.to) {
    const dbg = JSON.stringify(j ?? {}).slice(0, 240);
    throw new Error(`OpenSea fulfillment returned no transaction: ${dbg}`);
  }
  const fnRaw = String(tx.function);
  // OpenSea sometimes returns just the bare function name and
  // sometimes the full Solidity signature (e.g. "fulfillAdvancedOrder
  // (((...,)...))"). Strip any paren block before dispatching.
  const fnName = fnRaw.split('(')[0].trim();
  const valueWei = txValueToWei(tx.value);

  // BASIC-ORDER PATH (fulfillBasicOrder, fulfillBasicOrder_efficient_6GL6yc, …)
  if (fnName.startsWith('fulfillBasicOrder')) {
    const p = tx.input_data?.parameters;
    if (!p) throw new Error('OpenSea basic-order response missing parameters');
    const data = encodeBasicOrder(fnName, p);
    // BasicOrderParameters surfaces the offered NFT under
    // (offerToken, offerIdentifier).
    const offerContract = String(p.offerToken ?? '0x0000000000000000000000000000000000000000').toLowerCase();
    const offerTokenId = String(BigInt(p.offerIdentifier ?? '0'));
    return { to: String(tx.to), data, valueWei, offerContract, offerTokenId };
  }

  // FULL ORDER PATH
  if (fnName === 'fulfillOrder') {
    const inputOrder = tx.input_data?.order;
    const orderEntry = j?.fulfillment_data?.orders?.[0];
    const protocolData =
      (inputOrder?.parameters && typeof inputOrder?.signature === 'string')
        ? inputOrder
        : (orderEntry?.protocol_data?.parameters && typeof orderEntry?.protocol_data?.signature === 'string')
          ? orderEntry.protocol_data
          : (orderEntry?.parameters && typeof orderEntry?.signature === 'string')
            ? { parameters: orderEntry.parameters, signature: orderEntry.signature }
            : null;
    if (!protocolData) throw new Error('OpenSea full-order response missing parameters/signature');
    const fulfillerConduitKey =
      typeof tx.input_data?.fulfillerConduitKey === 'string'
        ? tx.input_data.fulfillerConduitKey
        : '0x' + '0'.repeat(64);
    const data = encodeFulfillOrder(protocolData, fulfillerConduitKey);
    const off = parseOfferFromOrder(protocolData);
    return { to: String(tx.to), data, valueWei, offerContract: off.contract, offerTokenId: off.tokenId };
  }

  // ADVANCED ORDER PATH — different ABI from fulfillOrder
  // (numerator/denominator/extraData on the order, plus criteria
  // resolvers + recipient as separate args).
  if (fnName === 'fulfillAdvancedOrder') {
    const data = encodeFulfillAdvancedOrder(tx.input_data, fulfiller);
    const off = parseOfferFromOrder(tx.input_data?.advancedOrder);
    return { to: String(tx.to), data, valueWei, offerContract: off.contract, offerTokenId: off.tokenId };
  }

  throw new Error(`Unsupported Seaport fulfillment function: ${fnName}`);
}

/** Extract the first OfferItem from an Order/AdvancedOrder
 * `protocol_data`-shaped object so the buy handler can verify it
 * matches what the user actually clicked on in the UI. */
function parseOfferFromOrder(orderLike: any): { contract: string; tokenId: string } {
  const offer = orderLike?.parameters?.offer?.[0];
  if (!offer || typeof offer.token !== 'string' || typeof offer.identifierOrCriteria === 'undefined') {
    return { contract: '0x0000000000000000000000000000000000000000', tokenId: '0' };
  }
  return {
    contract: String(offer.token).toLowerCase(),
    tokenId: String(BigInt(offer.identifierOrCriteria ?? '0')),
  };
}

// ─── Seaport fulfillment ──────────────────────────────────────────────────
//
// We support TWO fulfillment functions:
//   • fulfillBasicOrder_efficient_6GL6yc(BasicOrderParameters) — the
//     gas-optimized path OpenSea uses for the bulk of single-NFT
//     fixed-price listings.
//   • fulfillOrder(Order, fulfillerConduitKey) — the general path
//     for advanced/Dutch/multi-item orders.
//
// OpenSea's /listings/fulfillment_data endpoint tells us which
// function to use per-listing. Encoding the wrong one for a given
// listing makes Seaport revert at simulation time even for valid,
// active orders — which is what burned us in v0.1.36.

const SEAPORT_ABI = [
  // Basic-order fast path. Single named-tuple argument.
  `function fulfillBasicOrder_efficient_6GL6yc(
    (
      address considerationToken,
      uint256 considerationIdentifier,
      uint256 considerationAmount,
      address offerer,
      address zone,
      address offerToken,
      uint256 offerIdentifier,
      uint256 offerAmount,
      uint8 basicOrderType,
      uint256 startTime,
      uint256 endTime,
      bytes32 zoneHash,
      uint256 salt,
      bytes32 offererConduitKey,
      bytes32 fulfillerConduitKey,
      uint256 totalOriginalAdditionalRecipients,
      (uint256 amount, address recipient)[] additionalRecipients,
      bytes signature
    ) parameters
  ) payable returns (bool fulfilled)`,
  // Older basic-order entry point Seaport keeps for backward compat.
  `function fulfillBasicOrder(
    (
      address considerationToken,
      uint256 considerationIdentifier,
      uint256 considerationAmount,
      address offerer,
      address zone,
      address offerToken,
      uint256 offerIdentifier,
      uint256 offerAmount,
      uint8 basicOrderType,
      uint256 startTime,
      uint256 endTime,
      bytes32 zoneHash,
      uint256 salt,
      bytes32 offererConduitKey,
      bytes32 fulfillerConduitKey,
      uint256 totalOriginalAdditionalRecipients,
      (uint256 amount, address recipient)[] additionalRecipients,
      bytes signature
    ) parameters
  ) payable returns (bool fulfilled)`,
  // Full order — used for non-basic listings.
  `function fulfillOrder(
    (
      (
        address offerer,
        address zone,
        (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount)[] offer,
        (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount, address recipient)[] consideration,
        uint8 orderType,
        uint256 startTime,
        uint256 endTime,
        bytes32 zoneHash,
        uint256 salt,
        bytes32 conduitKey,
        uint256 totalOriginalConsiderationItems
      ) parameters,
      bytes signature
    ) order,
    bytes32 fulfillerConduitKey
  ) payable returns (bool fulfilled)`,
  // Advanced order — adds numerator/denominator (partial fill) and
  // extraData (post-execution hook payload) to the order, plus
  // criteria resolvers (for collection-wide / criteria offers) and
  // a recipient override.
  `function fulfillAdvancedOrder(
    (
      (
        address offerer,
        address zone,
        (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount)[] offer,
        (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount, address recipient)[] consideration,
        uint8 orderType,
        uint256 startTime,
        uint256 endTime,
        bytes32 zoneHash,
        uint256 salt,
        bytes32 conduitKey,
        uint256 totalOriginalConsiderationItems
      ) parameters,
      uint120 numerator,
      uint120 denominator,
      bytes signature,
      bytes extraData
    ) advancedOrder,
    (uint256 orderIndex, uint8 side, uint256 index, uint256 identifier, bytes32[] criteriaProof)[] criteriaResolvers,
    bytes32 fulfillerConduitKey,
    address recipient
  ) payable returns (bool fulfilled)`,
];
const SEAPORT_IFACE = new Interface(SEAPORT_ABI);

function encodeBasicOrder(fnName: string, p: any): string {
  // Map OpenSea's input_data.parameters object into the positional
  // tuple Solidity expects. Each numeric field tolerates string,
  // number, hex-string, or bigint input.
  const args = [
    String(p.considerationToken ?? '0x0000000000000000000000000000000000000000'),
    BigInt(p.considerationIdentifier ?? '0'),
    BigInt(p.considerationAmount ?? '0'),
    String(p.offerer ?? '0x0000000000000000000000000000000000000000'),
    String(p.zone ?? '0x0000000000000000000000000000000000000000'),
    String(p.offerToken ?? '0x0000000000000000000000000000000000000000'),
    BigInt(p.offerIdentifier ?? '0'),
    BigInt(p.offerAmount ?? '0'),
    Number(p.basicOrderType ?? 0),
    BigInt(p.startTime ?? '0'),
    BigInt(p.endTime ?? '0'),
    String(p.zoneHash ?? '0x' + '0'.repeat(64)),
    BigInt(p.salt ?? '0'),
    String(p.offererConduitKey ?? '0x' + '0'.repeat(64)),
    String(p.fulfillerConduitKey ?? '0x' + '0'.repeat(64)),
    BigInt(p.totalOriginalAdditionalRecipients ?? (p.additionalRecipients?.length ?? 0)),
    (Array.isArray(p.additionalRecipients) ? p.additionalRecipients : []).map((r: any) => [
      BigInt(r.amount ?? '0'),
      String(r.recipient ?? '0x0000000000000000000000000000000000000000'),
    ]),
    String(p.signature ?? '0x'),
  ];
  // Use whichever function name OpenSea suggested (the optimized
  // _efficient_ variant or plain fulfillBasicOrder); the calldata
  // shape is identical.
  const fn = fnName.startsWith('fulfillBasicOrder_efficient')
    ? 'fulfillBasicOrder_efficient_6GL6yc'
    : 'fulfillBasicOrder';
  return SEAPORT_IFACE.encodeFunctionData(fn, [args]);
}

function encodeFulfillOrder(protocolData: any, fulfillerConduitKey: string): string {
  const params = protocolData.parameters;
  const offer = (params.offer ?? []).map((o: any) => [
    Number(o.itemType ?? 0),
    String(o.token ?? '0x0000000000000000000000000000000000000000'),
    BigInt(o.identifierOrCriteria ?? '0'),
    BigInt(o.startAmount ?? '0'),
    BigInt(o.endAmount ?? o.startAmount ?? '0'),
  ]);
  const consideration = (params.consideration ?? []).map((c: any) => [
    Number(c.itemType ?? 0),
    String(c.token ?? '0x0000000000000000000000000000000000000000'),
    BigInt(c.identifierOrCriteria ?? '0'),
    BigInt(c.startAmount ?? '0'),
    BigInt(c.endAmount ?? c.startAmount ?? '0'),
    String(c.recipient ?? '0x0000000000000000000000000000000000000000'),
  ]);
  const order = [
    [
      String(params.offerer ?? '0x0000000000000000000000000000000000000000'),
      String(params.zone ?? '0x0000000000000000000000000000000000000000'),
      offer,
      consideration,
      Number(params.orderType ?? 0),
      BigInt(params.startTime ?? '0'),
      BigInt(params.endTime ?? '0'),
      String(params.zoneHash ?? '0x' + '0'.repeat(64)),
      BigInt(params.salt ?? '0'),
      String(params.conduitKey ?? '0x' + '0'.repeat(64)),
      BigInt(params.totalOriginalConsiderationItems ?? consideration.length),
    ],
    String(protocolData.signature),
  ];
  return SEAPORT_IFACE.encodeFunctionData('fulfillOrder', [order, fulfillerConduitKey]);
}

function encodeFulfillAdvancedOrder(input: any, fulfiller: string): string {
  const ao = input?.advancedOrder;
  if (!ao?.parameters || typeof ao.signature !== 'string') {
    throw new Error('fulfillAdvancedOrder input missing advancedOrder');
  }
  const params = ao.parameters;
  const offer = (params.offer ?? []).map((o: any) => [
    Number(o.itemType ?? 0),
    String(o.token ?? '0x0000000000000000000000000000000000000000'),
    BigInt(o.identifierOrCriteria ?? '0'),
    BigInt(o.startAmount ?? '0'),
    BigInt(o.endAmount ?? o.startAmount ?? '0'),
  ]);
  const consideration = (params.consideration ?? []).map((c: any) => [
    Number(c.itemType ?? 0),
    String(c.token ?? '0x0000000000000000000000000000000000000000'),
    BigInt(c.identifierOrCriteria ?? '0'),
    BigInt(c.startAmount ?? '0'),
    BigInt(c.endAmount ?? c.startAmount ?? '0'),
    String(c.recipient ?? '0x0000000000000000000000000000000000000000'),
  ]);
  const advancedOrder = [
    [
      String(params.offerer ?? '0x0000000000000000000000000000000000000000'),
      String(params.zone ?? '0x0000000000000000000000000000000000000000'),
      offer,
      consideration,
      Number(params.orderType ?? 0),
      BigInt(params.startTime ?? '0'),
      BigInt(params.endTime ?? '0'),
      String(params.zoneHash ?? '0x' + '0'.repeat(64)),
      BigInt(params.salt ?? '0'),
      String(params.conduitKey ?? '0x' + '0'.repeat(64)),
      BigInt(params.totalOriginalConsiderationItems ?? consideration.length),
    ],
    BigInt(ao.numerator ?? '1'),
    BigInt(ao.denominator ?? '1'),
    String(ao.signature),
    String(ao.extraData ?? '0x'),
  ];
  const criteriaResolvers = (Array.isArray(input?.criteriaResolvers) ? input.criteriaResolvers : []).map((r: any) => [
    BigInt(r.orderIndex ?? '0'),
    Number(r.side ?? 0),
    BigInt(r.index ?? '0'),
    BigInt(r.identifier ?? '0'),
    (Array.isArray(r.criteriaProof) ? r.criteriaProof : []).map((p: any) => String(p)),
  ]);
  const fulfillerConduitKey =
    typeof input?.fulfillerConduitKey === 'string'
      ? input.fulfillerConduitKey
      : '0x' + '0'.repeat(64);
  // Recipient: defaults to the caller (msg.sender) when zero. We
  // pass the buyer's address explicitly so the NFT lands in the
  // wallet that signed the tx, not in some surprise destination.
  const recipient =
    typeof input?.recipient === 'string' && input.recipient !== '0x0000000000000000000000000000000000000000'
      ? input.recipient
      : fulfiller;
  return SEAPORT_IFACE.encodeFunctionData(
    'fulfillAdvancedOrder',
    [advancedOrder, criteriaResolvers, fulfillerConduitKey, recipient],
  );
}

export interface SeaportFulfillTx {
  /** Seaport contract address (target of the call). */
  to: string;
  /** Hex calldata for fulfillOrder. */
  data: string;
  /** Total native value to send, as decimal string of wei. */
  valueWei: string;
  /** Audit H6: surface the actual NFT being purchased (parsed
   * from the Seaport order) so the caller can verify it matches
   * what the user clicked on in the UI. */
  offerContract: string;
  offerTokenId: string;
}

/**
 * Build a `fulfillOrder` Seaport tx from inline protocol_data —
 * the simple fallback path used when we already have the full
 * signed order in hand. The buy path PREFERS getFulfillmentTx
 * because OpenSea's recommended function (often
 * fulfillBasicOrder_efficient_6GL6yc) is more reliable per-listing.
 */
export function buildSeaportFulfillTx(args: { protocolData: any; protocolAddress: string }): SeaportFulfillTx {
  const pd = args.protocolData;
  if (!pd?.parameters || typeof pd.signature !== 'string') {
    throw new Error('Listing is missing Seaport protocol data');
  }
  const fulfillerConduitKey = '0x' + '0'.repeat(64);
  const data = encodeFulfillOrder(pd, fulfillerConduitKey);
  // Native value: sum of consideration amounts whose itemType is
  // NATIVE (0). Seaport requires the buyer to attach exactly enough
  // native currency to cover those amounts.
  let valueWei = 0n;
  for (const c of (pd.parameters.consideration ?? [])) {
    const itemType = Number(c?.itemType ?? 0);
    const startAmount = BigInt(c?.startAmount ?? '0');
    if (itemType === 0) valueWei += startAmount;
  }
  const off = parseOfferFromOrder(pd);
  return {
    to: args.protocolAddress,
    data,
    valueWei: valueWei.toString(),
    offerContract: off.contract,
    offerTokenId: off.tokenId,
  };
}
