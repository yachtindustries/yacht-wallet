// EVM/ApeChain client: shared providers + high-level wallet operations used
// by the UI and the dApp bridge.

import {
  Contract,
  formatUnits,
  parseUnits,
  JsonRpcProvider,
  Wallet,
  Interface,
  TransactionRequest,
  TransactionResponse,
  TransactionReceipt,
  ZeroAddress,
  isHexString,
  getBytes,
  toUtf8Bytes,
  type AbstractProvider,
} from 'ethers';
import { NETWORKS, NetworkId } from './networks';

const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

const erc20Iface = new Interface(ERC20_ABI);

const providers = new Map<NetworkId, JsonRpcProvider>();

// Errors that should trigger failover to the next RPC URL. We only fall over
// on transport-layer failure (the upstream is unreachable, hung, or 5xx) — not
// on application-layer JSON-RPC errors like "execution reverted" or "nonce too
// low", which are deterministic answers and would just be returned by every
// upstream identically.
function isTransportFailure(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  if (code === 'NETWORK_ERROR' || code === 'TIMEOUT' || code === 'SERVER_ERROR') return true;
  // ethers wraps fetch errors with .info.error.message; look for HTTP 5xx.
  const status = (e as { info?: { status?: number } })?.info?.status;
  if (typeof status === 'number' && status >= 500) return true;
  return false;
}

export function getProvider(network: NetworkId): JsonRpcProvider {
  let p = providers.get(network);
  if (!p) {
    p = createFailoverProvider(network);
    providers.set(network, p);
  }
  return p;
}

function createFailoverProvider(network: NetworkId): JsonRpcProvider {
  const cfg = NETWORKS[network];
  const urls = cfg.rpcUrls;
  if (urls.length === 0) throw new Error(`No RPC URLs configured for ${network}`);
  const net = { chainId: cfg.chainId, name: cfg.label };
  const opts = { staticNetwork: true } as const;
  const primary = new JsonRpcProvider(urls[0], net, opts);
  if (urls.length === 1) return primary;

  // Lazy: only construct fallbacks if we ever fail over to them.
  const fallbacks: JsonRpcProvider[] = [];
  const ensureFallback = (i: number): JsonRpcProvider => {
    if (!fallbacks[i]) fallbacks[i] = new JsonRpcProvider(urls[i + 1], net, opts);
    return fallbacks[i];
  };

  // Override `send` — every JsonRpcApiProvider operation funnels through this
  // method (getBalance, call, estimateGas, getLogs, etc.), so wrapping it here
  // gives failover for the entire ethers surface plus our own dappRpc().
  const originalSend = primary.send.bind(primary);
  primary.send = async (method: string, params: any[]): Promise<any> => {
    let lastErr: unknown;
    try {
      return await originalSend(method, params);
    } catch (e) {
      if (!isTransportFailure(e)) throw e;
      lastErr = e;
    }
    for (let i = 0; i < urls.length - 1; i++) {
      try {
        return await ensureFallback(i).send(method, params);
      } catch (e) {
        if (!isTransportFailure(e)) throw e;
        lastErr = e;
      }
    }
    throw lastErr;
  };

  return primary;
}

// ─────────────────────────── account ──────────────────────────────────────

export interface AccountSummary {
  address: string;
  nativeBalance: string;        // human APE
  nativeBalanceWei: string;     // raw wei (string for JSON-safety)
  nonce: number;
}

export async function getAccountSummary(network: NetworkId, address: string): Promise<AccountSummary> {
  const p = getProvider(network);
  const cfg = NETWORKS[network];
  const [bal, nonce] = await Promise.all([
    p.getBalance(address),
    p.getTransactionCount(address),
  ]);
  return {
    address,
    nativeBalance: formatUnits(bal, cfg.nativeDecimals),
    nativeBalanceWei: bal.toString(),
    nonce,
  };
}

// ─────────────────────────── ERC-20 ───────────────────────────────────────

export interface Erc20Info {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
}

export async function getErc20Info(network: NetworkId, token: string): Promise<Erc20Info> {
  const p = getProvider(network);
  const c = new Contract(token, ERC20_ABI, p);
  const [name, symbol, decimals] = await Promise.all([
    c.name().catch(() => 'Unknown'),
    c.symbol().catch(() => '???'),
    c.decimals().catch(() => 18),
  ]);
  return { address: token, name: String(name), symbol: String(symbol), decimals: Number(decimals) };
}

export interface Erc20Balance {
  token: Erc20Info;
  balance: string;       // human-readable
  balanceRaw: string;    // wei-equivalent
}

export async function getErc20Balance(network: NetworkId, token: string, address: string): Promise<Erc20Balance> {
  const p = getProvider(network);
  const c = new Contract(token, ERC20_ABI, p);
  const [info, raw] = await Promise.all([
    getErc20Info(network, token),
    c.balanceOf(address) as Promise<bigint>,
  ]);
  return {
    token: info,
    balance: formatUnits(raw, info.decimals),
    balanceRaw: raw.toString(),
  };
}

export async function getErc20Balances(
  network: NetworkId,
  tokens: string[],
  address: string,
): Promise<Erc20Balance[]> {
  if (!tokens.length) return [];
  return Promise.all(tokens.map((t) => getErc20Balance(network, t, address).catch(() => null))).then((xs) =>
    xs.filter((x): x is Erc20Balance => x != null),
  );
}

// ─────────────────────────── history ──────────────────────────────────────

export interface HistoryTransfer {
  /** True for the native APE transfer in this tx; false for an ERC-20 transfer. */
  native: boolean;
  /** Token contract for ERC-20 transfers; empty for native. */
  tokenAddress?: string;
  tokenSymbol?: string;
  tokenDecimals?: number;
  from: string;
  to: string;
  /** Display-units amount. */
  amount: string;
  /** "in" if WE received it, "out" if WE sent it. */
  direction: 'in' | 'out' | 'self';
}

export interface HistoryEntry {
  hash: string;
  /** Top-level classification — derived from the transfers and call data. */
  type: 'send' | 'receive' | 'self' | 'contract' | 'swap';
  from: string;
  to: string;
  /** Native APE value moved at the top level (in human APE). */
  value: string;
  status: 'success' | 'failed' | 'pending';
  timestamp: number;
  blockNumber: number;
  gasUsed?: string;
  /** Every value-bearing transfer that appeared in this tx (native + ERC-20). */
  transfers: HistoryTransfer[];
}

interface RawExternalTx {
  hash: string;
  from?: string;
  to?: string;
  value?: string;
  blockNumber?: string;
  timeStamp?: string;
  isError?: string;
  txreceipt_status?: string;
  gasUsed?: string;
  input?: string;
}

interface RawTokenTx {
  hash: string;
  from?: string;
  to?: string;
  value?: string;
  blockNumber?: string;
  timeStamp?: string;
  contractAddress?: string;
  tokenSymbol?: string;
  tokenName?: string;
  tokenDecimal?: string;
}

async function explorerCall<T>(network: NetworkId, params: Record<string, string>): Promise<T[]> {
  const cfg = NETWORKS[network];
  const merged: Record<string, string> = { ...params };
  if (cfg.apiChainParam) merged.chainid = cfg.apiChainParam;
  if (cfg.apiKey) merged.apikey = cfg.apiKey;
  const qs = new URLSearchParams(merged).toString();
  try {
    const r = await fetch(`${cfg.apiBase}?${qs}`);
    if (!r.ok) return [];
    const j: any = await r.json();
    // Etherscan returns { status: "1", message: "OK", result: [...] } on
    // success and { status: "0", message: "...", result: "..." } on errors
    // (where result becomes a string explaining the issue).
    if (!Array.isArray(j.result)) return [];
    return j.result as T[];
  } catch {
    return [];
  }
}

// Merge external txs (native APE moves + contract calls) and token transfers
// (ERC-20) into a unified per-tx history. ERC-20 receipts from a swap end up
// in `tokentx`, which is why a `txlist`-only fetch would show the swap call
// but not the token credit.
export async function getHistory(network: NetworkId, address: string, limit = 25): Promise<HistoryEntry[]> {
  const lower = address.toLowerCase();
  const [external, tokens] = await Promise.all([
    explorerCall<RawExternalTx>(network, {
      module: 'account', action: 'txlist', address,
      startblock: '0', endblock: '99999999',
      page: '1', offset: String(limit * 2), sort: 'desc',
    }),
    explorerCall<RawTokenTx>(network, {
      module: 'account', action: 'tokentx', address,
      startblock: '0', endblock: '99999999',
      page: '1', offset: String(limit * 4), sort: 'desc',
    }),
  ]);

  const byHash = new Map<string, HistoryEntry>();

  for (const t of external) {
    if (!t.hash) continue;
    const fromMe = (t.from ?? '').toLowerCase() === lower;
    const toMe = (t.to ?? '').toLowerCase() === lower;
    const valueWei = (() => { try { return BigInt(t.value ?? '0'); } catch { return 0n; } })();
    const valueApe = formatUnits(valueWei, 18);
    const hasInput = typeof t.input === 'string' && t.input !== '0x' && t.input.length > 2;
    let type: HistoryEntry['type'] = 'contract';
    if (fromMe && toMe) type = 'self';
    else if (valueWei === 0n && hasInput) type = 'contract';
    else if (fromMe) type = 'send';
    else if (toMe) type = 'receive';
    const transfers: HistoryTransfer[] = [];
    if (valueWei > 0n) {
      transfers.push({
        native: true,
        from: t.from ?? '',
        to: t.to ?? '',
        amount: valueApe,
        direction: fromMe && toMe ? 'self' : fromMe ? 'out' : 'in',
      });
    }
    byHash.set(t.hash.toLowerCase(), {
      hash: t.hash,
      type,
      from: t.from ?? '',
      to: t.to ?? '',
      value: valueApe,
      status: t.isError === '0' || t.txreceipt_status === '1' ? 'success' : 'failed',
      timestamp: Number(t.timeStamp ?? 0),
      blockNumber: Number(t.blockNumber ?? 0),
      gasUsed: t.gasUsed,
      transfers,
    });
  }

  for (const t of tokens) {
    if (!t.hash) continue;
    const key = t.hash.toLowerCase();
    const fromMe = (t.from ?? '').toLowerCase() === lower;
    const toMe = (t.to ?? '').toLowerCase() === lower;
    const decimals = Number(t.tokenDecimal ?? '18');
    const raw = (() => { try { return BigInt(t.value ?? '0'); } catch { return 0n; } })();
    const transfer: HistoryTransfer = {
      native: false,
      tokenAddress: t.contractAddress,
      tokenSymbol: t.tokenSymbol,
      tokenDecimals: decimals,
      from: t.from ?? '',
      to: t.to ?? '',
      amount: formatUnits(raw, decimals),
      direction: fromMe && toMe ? 'self' : fromMe ? 'out' : 'in',
    };
    let entry = byHash.get(key);
    if (!entry) {
      entry = {
        hash: t.hash,
        type: 'contract',
        from: t.from ?? '',
        to: t.to ?? '',
        value: '0',
        status: 'success',
        timestamp: Number(t.timeStamp ?? 0),
        blockNumber: Number(t.blockNumber ?? 0),
        transfers: [],
      };
      byHash.set(key, entry);
    }
    entry.transfers.push(transfer);
  }

  // Promote tx type when transfers reveal a swap pattern (we both gave and
  // received a token / native APE in the same tx).
  for (const e of byHash.values()) {
    const gave = e.transfers.some((t) => t.direction === 'out' && parseFloat(t.amount) > 0);
    const got = e.transfers.some((t) => t.direction === 'in' && parseFloat(t.amount) > 0);
    if (gave && got) e.type = 'swap';
    else if (e.type === 'contract' && got) e.type = 'receive';
    else if (e.type === 'contract' && gave) e.type = 'send';
  }

  return [...byHash.values()]
    .sort((a, b) => b.blockNumber - a.blockNumber || b.timestamp - a.timestamp)
    .slice(0, limit);
}

// ─────────────────────────── NFTs (ERC-721) ───────────────────────────────

interface RawNftTx {
  hash: string;
  from?: string;
  to?: string;
  blockNumber?: string;
  timeStamp?: string;
  contractAddress?: string;
  tokenName?: string;
  tokenSymbol?: string;
  tokenID?: string;
}

export interface OwnedNft {
  contract: string;
  contractName?: string;
  contractSymbol?: string;
  tokenId: string;
  image?: string;
  name?: string;
}

const ERC721_ABI = [
  'function tokenURI(uint256) view returns (string)',
  'function ownerOf(uint256) view returns (address)',
];
const erc721Iface = new Interface(ERC721_ABI);

// ERC-1155 uses `uri(uint256)` instead of `tokenURI`. Tried as a fallback
// when tokenURI doesn't exist or reverts (most ApeChain 1155 contracts).
const ERC1155_ABI = ['function uri(uint256) view returns (string)'];
const erc1155Iface = new Interface(ERC1155_ABI);

// Pool of public IPFS gateways. We rotate per-request so a single gateway
// compromise / outage doesn't take down all NFT loading, and so no single
// gateway sees every Yacht user's NFT browsing.
const IPFS_GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
  'https://nftstorage.link/ipfs/',
];

function pickIpfsGateway(): string {
  return IPFS_GATEWAYS[Math.floor(Math.random() * IPFS_GATEWAYS.length)];
}

function ipfsToHttp(uri: string): string {
  if (uri.startsWith('ipfs://')) {
    const path = uri.replace(/^ipfs:\/\//, '').replace(/^ipfs\//, '');
    return `${pickIpfsGateway()}${path}`;
  }
  return uri;
}

/**
 * Resolve every gateway candidate for an ipfs:// URI so we can try them
 * in turn. Non-ipfs URIs come back as a single-element list.
 */
function ipfsCandidates(uri: string): string[] {
  if (!uri.startsWith('ipfs://')) return [uri];
  const path = uri.replace(/^ipfs:\/\//, '').replace(/^ipfs\//, '');
  return IPFS_GATEWAYS.map((g) => `${g}${path}`);
}

/**
 * Anti-SSRF guard. NFT tokenURI is contract-controlled and an attacker could
 * point it at internal services. We accept ONLY:
 *   - https:// URLs whose host is not an RFC1918 / loopback / link-local IP
 *   - data: URLs (decoded inline, no fetch)
 * Anything else (http://, ftp://, file://, internal IPs) is rejected.
 */
function isSafeMetadataUrl(url: string): boolean {
  if (url.startsWith('data:')) return true;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname;
  if (!host) return false;
  // Block explicit IPs in private ranges. Hostnames go through DNS at fetch
  // time; we can't perfectly resolve them here, but blocking literal-IP
  // private addresses kills the most common SSRF probes.
  if (/^(localhost|0\.0\.0\.0)$/i.test(host)) return false;
  // IPv4 private ranges: 10.x, 172.16-31.x, 192.168.x, 127.x, 169.254.x, 100.64-127.x
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const a = +v4[1], b = +v4[2];
    if (a === 10) return false;
    if (a === 127) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 0) return false;
  }
  // IPv6: any literal address in brackets — block ::1, fc00::/7, fe80::/10, etc.
  if (host.startsWith('[') && host.endsWith(']')) {
    const v6 = host.slice(1, -1).toLowerCase();
    if (v6 === '::1' || v6 === '::') return false;
    if (/^fc/.test(v6) || /^fd/.test(v6)) return false;       // ULA fc00::/7
    if (/^fe[89ab]/.test(v6)) return false;                    // link-local fe80::/10
  }
  return true;
}

/** Substitute the standard ERC-1155 {id} placeholder with the 64-hex-pad tokenId. */
function substituteIdPlaceholder(uri: string, tokenId: string): string {
  if (!uri.includes('{id}')) return uri;
  let hex: string;
  try {
    hex = BigInt(tokenId).toString(16).padStart(64, '0');
  } catch {
    hex = tokenId;
  }
  return uri.replace(/\{id\}/g, hex);
}

async function readTokenUri(
  network: NetworkId,
  contract: string,
  tokenId: string,
): Promise<string | null> {
  const p = getProvider(network);
  // Try ERC-721 tokenURI first. Many ApeChain NFTs are 721; cheap call.
  try {
    const data = erc721Iface.encodeFunctionData('tokenURI', [tokenId]);
    const raw = await p.call({ to: contract, data });
    if (raw && raw !== '0x') {
      const decoded = erc721Iface.decodeFunctionResult('tokenURI', raw);
      const uri = (decoded[0] ?? '') as string;
      if (uri) return uri;
    }
  } catch { /* fall through to ERC-1155 */ }
  // ERC-1155 uri(uint256). Returned URI may contain {id} placeholder.
  try {
    const data = erc1155Iface.encodeFunctionData('uri', [tokenId]);
    const raw = await p.call({ to: contract, data });
    if (raw && raw !== '0x') {
      const decoded = erc1155Iface.decodeFunctionResult('uri', raw);
      const uri = (decoded[0] ?? '') as string;
      if (uri) return substituteIdPlaceholder(uri, tokenId);
    }
  } catch { /* both failed */ }
  return null;
}

/** fetch with an aborting timeout. Hung gateways used to block all NFT loads. */
async function fetchWithTimeout(url: string, ms = 6000): Promise<Response | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { signal: ctl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function fetchNftMetadata(
  network: NetworkId,
  contract: string,
  tokenId: string,
): Promise<{ image?: string; name?: string }> {
  try {
    const uri = await readTokenUri(network, contract, tokenId);
    if (!uri) return {};
    // data: URIs decode in-process — no fetch.
    if (uri.startsWith('data:application/json')) {
      const comma = uri.indexOf(',');
      if (comma < 0) return {};
      const isB64 = uri.slice(0, comma).includes(';base64');
      const payload = isB64 ? atob(uri.slice(comma + 1)) : decodeURIComponent(uri.slice(comma + 1));
      const json = JSON.parse(payload);
      const imageUrl = json.image ? ipfsToHttp(json.image) : undefined;
      return {
        image: imageUrl && isSafeMetadataUrl(imageUrl) ? imageUrl : undefined,
        name: typeof json.name === 'string' ? json.name : undefined,
      };
    }
    // For ipfs:// URIs we try every gateway in IPFS_GATEWAYS until one
    // returns 2xx. Previously a single-gateway 503 / 429 silently dropped
    // the metadata for the whole NFT.
    const candidates = ipfsCandidates(uri).filter(isSafeMetadataUrl);
    let meta: any = null;
    for (const c of candidates) {
      const r = await fetchWithTimeout(c);
      if (!r || !r.ok) continue;
      try { meta = await r.json(); break; } catch { continue; }
    }
    if (!meta) return {};
    // Same multi-gateway logic for the embedded image URL.
    let imageUrl: string | undefined;
    if (typeof meta.image === 'string' && meta.image) {
      const imgCandidates = ipfsCandidates(meta.image).filter(isSafeMetadataUrl);
      imageUrl = imgCandidates[0]; // First viable form; <img> handles the actual fetch with the browser's own retries.
    } else if (typeof meta.image_url === 'string' && meta.image_url) {
      // Some indexers return image_url instead of image.
      const imgCandidates = ipfsCandidates(meta.image_url).filter(isSafeMetadataUrl);
      imageUrl = imgCandidates[0];
    }
    return {
      image: imageUrl,
      name: typeof meta?.name === 'string' ? meta.name : undefined,
    };
  } catch {
    return {};
  }
}

// ─── Reservoir NFT indexer ────────────────────────────────────────────────
//
// Reservoir is a public NFT API that already does the heavy lifting we
// were doing manually: walks ownership across ERC-721 + ERC-1155, decodes
// every flavour of metadata (data:, ipfs://, custom indexer URLs,
// on-chain SVGs, Renamed/upgraded contracts), and serves a CDN-cached
// image URL. Many ApeChain contracts have non-standard metadata that
// `tokenURI()` + a public IPFS gateway can't render — Reservoir handles
// those because it talks directly to OpenSea + the project's own
// indexer. We use it as the primary source and keep the Etherscan +
// tokenURI flow as a fallback for cases Reservoir hasn't indexed yet.

const RESERVOIR_API_BASE: Record<NetworkId, string | null> = {
  mainnet: 'https://api-apechain.reservoir.tools',
};

interface ReservoirToken {
  token?: {
    contract?: string;
    tokenId?: string;
    name?: string;
    image?: string;
    imageSmall?: string;
    media?: string;
    collection?: { name?: string };
  };
}

async function fetchOwnedNftsViaReservoir(
  network: NetworkId,
  address: string,
): Promise<OwnedNft[] | null> {
  const base = RESERVOIR_API_BASE[network];
  if (!base) return null;
  // Reservoir's free tier doesn't require an API key for ownership lookup.
  // limit=50 keeps us under the rate limit for free use; v10 is the latest
  // stable owners endpoint.
  const url = `${base}/users/${address}/tokens/v10?limit=50`;
  let resp: Response;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    try {
      resp = await fetch(url, { signal: ctl.signal });
    } finally {
      clearTimeout(t);
    }
  } catch {
    return null;
  }
  if (!resp.ok) return null;
  let body: any;
  try { body = await resp.json(); } catch { return null; }
  const tokens: ReservoirToken[] = Array.isArray(body?.tokens) ? body.tokens : [];
  const out: OwnedNft[] = [];
  for (const entry of tokens) {
    const t = entry?.token;
    if (!t || typeof t.contract !== 'string' || typeof t.tokenId !== 'string') continue;
    // Defence in depth: validate any Reservoir-supplied image URL
    // through the same SSRF guard used for tokenURI metadata.
    const rawImg = t.image || t.imageSmall || t.media;
    const safeImg = typeof rawImg === 'string' && isSafeMetadataUrl(rawImg) ? rawImg : undefined;
    out.push({
      contract: t.contract,
      contractSymbol: undefined,
      contractName: t.collection?.name,
      tokenId: t.tokenId,
      name: typeof t.name === 'string' ? t.name : undefined,
      image: safeImg,
    });
  }
  return out;
}

export async function getOwnedNfts(
  network: NetworkId,
  address: string,
  withMetadata = true,
): Promise<OwnedNft[]> {
  // Try Reservoir first — it has the metadata pipeline ApeChain NFTs
  // actually need. Successful response (even with zero tokens for an
  // empty wallet) is authoritative.
  const reservoir = await fetchOwnedNftsViaReservoir(network, address);
  if (reservoir !== null) return reservoir;
  // Reservoir unreachable — fall through to the Etherscan + tokenURI
  // path so the wallet still surfaces SOME NFT info. Same logic as
  // before, kept verbatim below.
  return await getOwnedNftsViaEtherscan(network, address, withMetadata);
}

async function getOwnedNftsViaEtherscan(
  network: NetworkId,
  address: string,
  withMetadata = true,
): Promise<OwnedNft[]> {
  const lower = address.toLowerCase();
  // Pull both ERC-721 (tokennfttx) and ERC-1155 (token1155tx) transfer windows
  // and merge — many ApeChain NFTs are 1155, and the 721-only query was
  // missing them entirely. Etherscan caps the offset at 10k per call.
  const [erc721, erc1155] = await Promise.all([
    explorerCall<RawNftTx>(network, {
      module: 'account', action: 'tokennfttx', address,
      startblock: '0', endblock: '99999999', page: '1', offset: '1000', sort: 'desc',
    }),
    explorerCall<RawNftTx>(network, {
      module: 'account', action: 'token1155tx', address,
      startblock: '0', endblock: '99999999', page: '1', offset: '1000', sort: 'desc',
    }).catch(() => [] as RawNftTx[]),
  ]);
  const transfers = [...erc721, ...erc1155];

  // Walk newest → oldest. The first time we see a (contract, tokenId) pair,
  // the latest direction tells us if WE currently hold it.
  const seen = new Set<string>();
  const owned: OwnedNft[] = [];
  for (const t of transfers) {
    if (!t.contractAddress || !t.tokenID) continue;
    const c = t.contractAddress.toLowerCase();
    const key = `${c}:${t.tokenID}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const toMe = (t.to ?? '').toLowerCase() === lower;
    if (!toMe) continue;
    owned.push({
      contract: t.contractAddress,
      contractName: t.tokenName,
      contractSymbol: t.tokenSymbol,
      tokenId: t.tokenID,
    });
  }

  if (!withMetadata) return owned;

  // Fetch metadata in parallel with a hard cap so we don't hammer providers.
  // Wrap each one in an outer 8s budget so a hung gateway / unresponsive
  // contract doesn't block the whole NFT load and leave the UI on
  // "Loading NFTs…" forever.
  const cap = Math.min(owned.length, 60);
  await Promise.all(
    owned.slice(0, cap).map(async (n) => {
      const meta = await Promise.race<{ image?: string; name?: string }>([
        fetchNftMetadata(network, n.contract, n.tokenId),
        new Promise((res) => setTimeout(() => res({}), 8000)),
      ]);
      n.image = meta.image;
      n.name = meta.name;
    }),
  );

  return owned;
}

// ─────────────────────────── send native APE ──────────────────────────────

export interface SendResult {
  hash: string;
  status: 'success' | 'failed';
  blockNumber: number;
  raw: TransactionReceipt;
}

// Sanity cap on per-tx gas. Needs to be high enough to cover dApp-side
// operations like Camelot add-liquidity, NFT mints with reveal logic, and
// multi-step DeFi flows that legitimately consume several million gas.
// At ApeChain's gas prices (~0.5 gwei) the worst-case fee is still <0.01 APE.
const MAX_GAS_LIMIT = 12_000_000n;
const MAX_GAS_PRICE_GWEI = 500n;          // refuse a runaway gasPrice

async function buildOverrides(
  provider: AbstractProvider,
  request: TransactionRequest | undefined,
  fromAddress: string | undefined,
) {
  const fee = await provider.getFeeData();
  const overrides: TransactionRequest = { ...(request ?? {}) };
  // Prefer EIP-1559. Fall back to legacy gasPrice if the chain returns it.
  if (fee.maxFeePerGas && fee.maxPriorityFeePerGas) {
    overrides.maxFeePerGas = fee.maxFeePerGas;
    overrides.maxPriorityFeePerGas = fee.maxPriorityFeePerGas;
    overrides.type = 2;
  } else if (fee.gasPrice) {
    overrides.gasPrice = fee.gasPrice;
  }
  // Sanity-cap gas price.
  const cap = MAX_GAS_PRICE_GWEI * 10n ** 9n;
  for (const k of ['gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas'] as const) {
    const v = overrides[k] as bigint | undefined;
    if (typeof v === 'bigint' && v > cap) {
      throw new Error(`Network suggested ${k} > ${MAX_GAS_PRICE_GWEI} gwei — refusing`);
    }
  }
  // Pin nonce against the 'pending' tag so back-to-back queued sends from the
  // same account don't reuse a stale nonce when the previous tx hasn't been
  // mined yet (ApeChain ~1s blocks make this race rare but real).
  if (overrides.nonce == null && fromAddress) {
    overrides.nonce = await provider.getTransactionCount(fromAddress, 'pending');
  }
  return overrides;
}

export async function sendNative(
  network: NetworkId,
  privateKey: string,
  to: string,
  amountApe: string,
): Promise<SendResult> {
  const provider = getProvider(network);
  const wallet = new Wallet(privateKey, provider);
  const valueWei = parseUnits(amountApe, NETWORKS[network].nativeDecimals);
  const overrides = await buildOverrides(provider, { to, value: valueWei }, wallet.address);
  const gasEstimate = await provider.estimateGas({ from: wallet.address, to, value: valueWei });
  if (gasEstimate > MAX_GAS_LIMIT) throw new Error('Estimated gas is unreasonable');
  overrides.gasLimit = (gasEstimate * 12n) / 10n;
  const tx: TransactionResponse = await wallet.sendTransaction(overrides);
  const receipt = await tx.wait();
  if (!receipt) throw new Error('Transaction dropped from mempool');
  return {
    hash: receipt.hash,
    status: receipt.status === 1 ? 'success' : 'failed',
    blockNumber: receipt.blockNumber,
    raw: receipt,
  };
}

// ─────────────────────────── ERC-721 transfer ────────────────────────────

const ERC721_TRANSFER_ABI = [
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
];
const erc721TransferIface = new Interface(ERC721_TRANSFER_ABI);

/**
 * Transfer a single ERC-721 NFT from the user's wallet to `to`.
 * Uses safeTransferFrom which reverts if the destination is a contract
 * that doesn't implement IERC721Receiver — protecting the user from
 * accidentally locking the NFT in a non-NFT-aware contract.
 */
export async function sendNft(
  network: NetworkId,
  privateKey: string,
  contract: string,
  tokenId: string,
  to: string,
): Promise<SendResult> {
  const provider = getProvider(network);
  const wallet = new Wallet(privateKey, provider);
  // Validate the tokenId can be parsed as a uint256. NFT collections
  // sometimes have very large token ids (full uint256), so BigInt is
  // the right type here.
  let tokenIdBn: bigint;
  try { tokenIdBn = BigInt(tokenId); } catch { throw new Error('Invalid token id'); }
  const data = erc721TransferIface.encodeFunctionData('safeTransferFrom', [wallet.address, to, tokenIdBn]);
  const overrides = await buildOverrides(provider, { to: contract, data }, wallet.address);
  const gasEstimate = await provider.estimateGas({ from: wallet.address, to: contract, data });
  if (gasEstimate > MAX_GAS_LIMIT) throw new Error('Estimated gas is unreasonable');
  overrides.gasLimit = (gasEstimate * 12n) / 10n;
  const tx = await wallet.sendTransaction(overrides);
  const receipt = await tx.wait();
  if (!receipt) throw new Error('Transaction dropped from mempool');
  return {
    hash: receipt.hash,
    status: receipt.status === 1 ? 'success' : 'failed',
    blockNumber: receipt.blockNumber,
    raw: receipt,
  };
}

export async function sendErc20(
  network: NetworkId,
  privateKey: string,
  token: string,
  to: string,
  amountDisplay: string,
): Promise<SendResult> {
  const provider = getProvider(network);
  const wallet = new Wallet(privateKey, provider);
  const info = await getErc20Info(network, token);
  const value = parseUnits(amountDisplay, info.decimals);
  const data = erc20Iface.encodeFunctionData('transfer', [to, value]);
  const overrides = await buildOverrides(provider, { to: token, data }, wallet.address);
  const gasEstimate = await provider.estimateGas({ from: wallet.address, to: token, data });
  if (gasEstimate > MAX_GAS_LIMIT) throw new Error('Estimated gas is unreasonable');
  overrides.gasLimit = (gasEstimate * 12n) / 10n;
  const tx = await wallet.sendTransaction(overrides);
  const receipt = await tx.wait();
  if (!receipt) throw new Error('Transaction dropped from mempool');
  return {
    hash: receipt.hash,
    status: receipt.status === 1 ? 'success' : 'failed',
    blockNumber: receipt.blockNumber,
    raw: receipt,
  };
}

// ─────────────────────────── dApp signing ─────────────────────────────────

export async function signGenericTransaction(
  network: NetworkId,
  privateKey: string,
  request: TransactionRequest,
): Promise<SendResult> {
  const provider = getProvider(network);
  const wallet = new Wallet(privateKey, provider);
  const overrides = await buildOverrides(provider, request, wallet.address);
  // Always derive gasLimit from estimation; never trust an attacker-supplied
  // value. Cap the result to MAX_GAS_LIMIT so a malicious dApp cannot drain
  // APE via inflated gas burn even if estimation succeeds for some absurd value.
  delete (overrides as any).gasLimit;
  delete (overrides as any).gas;
  delete (overrides as any).nonce;
  delete (overrides as any).chainId;
  const est = await provider.estimateGas({ ...overrides, from: wallet.address });
  if (est > MAX_GAS_LIMIT) {
    throw new Error(`Gas estimate ${est} exceeds wallet cap ${MAX_GAS_LIMIT}`);
  }
  overrides.gasLimit = (est * 12n) / 10n;
  if ((overrides.gasLimit as bigint) > MAX_GAS_LIMIT) {
    overrides.gasLimit = MAX_GAS_LIMIT;
  }
  const tx = await wallet.sendTransaction(overrides);
  const receipt = await tx.wait();
  if (!receipt) throw new Error('Transaction dropped from mempool');
  return {
    hash: receipt.hash,
    status: receipt.status === 1 ? 'success' : 'failed',
    blockNumber: receipt.blockNumber,
    raw: receipt,
  };
}

export async function personalSign(privateKey: string, message: string): Promise<string> {
  const wallet = new Wallet(privateKey);
  // EIP-191 / personal_sign: dApps may pass either a UTF-8 string or a
  // 0x-prefixed hex blob. wallet.signMessage(string) ALWAYS treats its
  // input as UTF-8, so a hex-encoded message would be signed as the
  // bytes of the literal hex string ("0xabc…") rather than the bytes
  // they decode to. Privy's SIWE-link flow (used by Otherside, Glyph,
  // others) ships its messages this way; without the getBytes() branch
  // here, the resulting signature fails backend verification with
  // "invalid_data". MetaMask and Rabby both decode in the same way.
  const bytes = isHexString(message) ? getBytes(message) : toUtf8Bytes(message);
  return wallet.signMessage(bytes);
}

export async function signTypedDataV4(
  privateKey: string,
  typedData: { domain: any; types: Record<string, any>; message: any; primaryType?: string },
): Promise<string> {
  const wallet = new Wallet(privateKey);
  const types = { ...typedData.types };
  // ethers.signTypedData rejects an EIP712Domain key in the types map.
  delete (types as any).EIP712Domain;
  return wallet.signTypedData(typedData.domain, types, typedData.message);
}

// ─── dApp RPC passthrough ─────────────────────────────────────────────────
//
// Read-only EVM methods that dApps regularly call against the wallet's
// provider. We forward each one to the configured ApeChain RPC and return
// the raw result. Anything not in this set is refused at the gateway.
//
// What's intentionally NOT here: anything that signs, sends, or mutates
// state. eth_sendTransaction / personal_sign / eth_signTypedData_v4 /
// eth_signTransaction / eth_sign all go through the explicit handlers in
// the content script (which open the approval popup).
const SAFE_PASSTHROUGH_METHODS = new Set<string>([
  'eth_blockNumber',
  'eth_getBalance',
  'eth_getCode',
  'eth_getStorageAt',
  'eth_call',
  'eth_estimateGas',
  'eth_gasPrice',
  'eth_maxPriorityFeePerGas',
  'eth_feeHistory',
  'eth_blobBaseFee',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_getBlockTransactionCountByHash',
  'eth_getBlockTransactionCountByNumber',
  'eth_getTransactionByHash',
  'eth_getTransactionByBlockHashAndIndex',
  'eth_getTransactionByBlockNumberAndIndex',
  'eth_getTransactionReceipt',
  'eth_getTransactionCount',
  'eth_getLogs',
  'eth_getProof',
  'eth_getUncleByBlockHashAndIndex',
  'eth_getUncleByBlockNumberAndIndex',
  'eth_protocolVersion',
  'eth_syncing',
  'eth_coinbase',
  'eth_mining',
  'eth_hashrate',
  // NOTE: eth_*Filter* methods are intentionally NOT here. They are stateful
  // at the RPC node and the wallet shares ONE provider across all origins, so
  // a malicious origin could (a) DoS the upstream filter quota for everyone
  // and (b) potentially read filter IDs registered by another origin. dApps
  // in 2026 generally use polling on eth_blockNumber + eth_getLogs instead.
  'web3_clientVersion',
  'web3_sha3',
  'net_listening',
  'net_peerCount',
]);

// Caps on dApp-supplied parameters for the heaviest passthrough methods.
const ETH_GETLOGS_MAX_RANGE = 10_000;        // blocks per call
const ETH_CALL_MAX_DATA_BYTES = 256 * 1024;  // 256 KB calldata

export function isSafePassthroughMethod(method: string): boolean {
  return SAFE_PASSTHROUGH_METHODS.has(method);
}

function parseBlockTag(tag: unknown): number | null {
  if (typeof tag !== 'string') return null;
  if (tag === 'earliest') return 0;
  if (tag === 'latest' || tag === 'safe' || tag === 'finalized' || tag === 'pending') return -1;
  if (tag.startsWith('0x')) {
    try {
      const n = Number(BigInt(tag));
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }
  const n = Number(tag);
  return Number.isFinite(n) ? n : null;
}

// Reject obviously abusive eth_getLogs calls (huge ranges) and oversized
// eth_call calldata. Both of these have caused real-world wallet outages when
// a dApp loops a wide log scan or sends a multi-MB call payload — we keep the
// upstream RPC budget for legitimate callers.
export async function validateDappRpcParams(method: string, params: unknown[]): Promise<void> {
  if (method === 'eth_getLogs') {
    const filter = (Array.isArray(params) ? params[0] : null) as
      | { fromBlock?: unknown; toBlock?: unknown; blockHash?: unknown }
      | null;
    if (!filter || typeof filter !== 'object') return;
    if (filter.blockHash) return; // single-block lookup is bounded
    const from = parseBlockTag(filter.fromBlock);
    const to = parseBlockTag(filter.toBlock);
    // -1 means "latest"-family — we don't know the head block here without
    // an RPC roundtrip. Treat unspecified or "latest" as bounded if from
    // is also unspecified or recent; otherwise require a numeric upper.
    if (from === 0 && (to === -1 || to == null)) {
      throw new Error(`eth_getLogs: range too large (use a fromBlock window of at most ${ETH_GETLOGS_MAX_RANGE} blocks)`);
    }
    if (from != null && from >= 0 && to != null && to >= 0 && to - from > ETH_GETLOGS_MAX_RANGE) {
      throw new Error(`eth_getLogs: range ${to - from} exceeds cap of ${ETH_GETLOGS_MAX_RANGE} blocks`);
    }
  } else if (method === 'eth_call') {
    const callObj = (Array.isArray(params) ? params[0] : null) as { data?: unknown; input?: unknown } | null;
    const data = callObj && typeof callObj === 'object' ? (callObj.data ?? callObj.input) : undefined;
    if (typeof data === 'string' && data.length > 2 + ETH_CALL_MAX_DATA_BYTES * 2) {
      throw new Error(`eth_call: calldata exceeds cap of ${ETH_CALL_MAX_DATA_BYTES} bytes`);
    }
  }
}

export async function dappRpc(network: NetworkId, method: string, params: unknown): Promise<unknown> {
  if (!isSafePassthroughMethod(method)) {
    throw new Error(`Method not supported: ${method}`);
  }
  const arr = Array.isArray(params) ? params : params == null ? [] : [params];
  await validateDappRpcParams(method, arr);
  const provider = getProvider(network);
  return await provider.send(method, arr);
}

// Used by tests / consumers to clear shared providers between runs.
export function disconnectAll(): void {
  for (const p of providers.values()) p.destroy();
  providers.clear();
}

export const NATIVE_TOKEN_ADDRESS = ZeroAddress;

// ─── pre-flight simulation ────────────────────────────────────────────────
// Run the requested tx as eth_call against the latest block to catch reverts
// (or revert reasons) before the user pays gas. MetaMask / Rabby do this and
// it catches the most common "approve to scam contract" + "fake mint" failures
// where the tx reverts with a clear message.

export interface SimulationResult {
  ok: boolean;
  /** Decoded revert reason when available (Solidity Error(string) selector). */
  revertReason?: string;
  /** Raw error text from the provider, if simulation threw. */
  rawError?: string;
}

export async function simulateTransaction(
  network: NetworkId,
  request: {
    from?: string;
    to?: string;
    value?: bigint | string;
    data?: string;
  },
): Promise<SimulationResult> {
  const provider = getProvider(network);
  try {
    const value = (() => {
      const v = request.value;
      if (v == null) return 0n;
      if (typeof v === 'bigint') return v;
      if (typeof v === 'string') {
        try { return v.startsWith('0x') ? BigInt(v) : BigInt(v); } catch { return 0n; }
      }
      return 0n;
    })();
    await provider.call({ from: request.from, to: request.to, value, data: request.data ?? '0x' });
    return { ok: true };
  } catch (e: any) {
    const raw = e?.message ?? String(e);
    // ethers normally surfaces revert reasons as e.reason / e.shortMessage.
    let reason: string | undefined = e?.revert?.args?.[0] ?? e?.reason ?? e?.shortMessage;
    // Try decoding Error(string) from raw return data.
    const data: string | undefined = e?.info?.error?.data ?? e?.data;
    if (!reason && typeof data === 'string' && data.startsWith('0x08c379a0')) {
      try {
        const hex = '0x' + data.slice(10);
        const bytes = hex.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) ?? [];
        // ABI: 32-byte offset, 32-byte length, then string. Simplest: skip 64
        // bytes and decode rest until first NUL.
        const stringBytes = bytes.slice(64);
        const end = stringBytes.indexOf(0);
        const sliced = end >= 0 ? stringBytes.slice(0, end) : stringBytes;
        reason = new TextDecoder().decode(new Uint8Array(sliced));
      } catch { /* ignore */ }
    }
    return { ok: false, revertReason: reason, rawError: raw };
  }
}
