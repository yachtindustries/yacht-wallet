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
  hexlify,
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

export function getProvider(network: NetworkId): JsonRpcProvider {
  let p = providers.get(network);
  if (!p) {
    const cfg = NETWORKS[network];
    p = new JsonRpcProvider(cfg.rpcUrl, { chainId: cfg.chainId, name: cfg.label }, { staticNetwork: true });
    providers.set(network, p);
  }
  return p;
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

function ipfsToHttp(uri: string): string {
  if (uri.startsWith('ipfs://')) {
    const path = uri.replace(/^ipfs:\/\//, '').replace(/^ipfs\//, '');
    return `https://ipfs.io/ipfs/${path}`;
  }
  return uri;
}

async function fetchNftMetadata(
  network: NetworkId,
  contract: string,
  tokenId: string,
): Promise<{ image?: string; name?: string }> {
  try {
    const p = getProvider(network);
    const data = erc721Iface.encodeFunctionData('tokenURI', [tokenId]);
    const raw = await p.call({ to: contract, data });
    if (!raw || raw === '0x') return {};
    const decoded = erc721Iface.decodeFunctionResult('tokenURI', raw);
    const uri = (decoded[0] ?? '') as string;
    if (!uri) return {};
    const url = ipfsToHttp(uri);
    if (url.startsWith('data:application/json')) {
      const json = JSON.parse(url.split(',')[1] ?? '{}');
      return { image: json.image ? ipfsToHttp(json.image) : undefined, name: json.name };
    }
    const r = await fetch(url);
    if (!r.ok) return {};
    const meta = await r.json();
    return {
      image: meta?.image ? ipfsToHttp(meta.image) : undefined,
      name: meta?.name,
    };
  } catch {
    return {};
  }
}

export async function getOwnedNfts(
  network: NetworkId,
  address: string,
  withMetadata = true,
): Promise<OwnedNft[]> {
  const lower = address.toLowerCase();
  // Pull a sizeable window of ERC-721 transfers; Etherscan caps at 10k.
  const transfers = await explorerCall<RawNftTx>(network, {
    module: 'account',
    action: 'tokennfttx',
    address,
    startblock: '0',
    endblock: '99999999',
    page: '1',
    offset: '1000',
    sort: 'desc',
  });

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
  const cap = Math.min(owned.length, 60);
  await Promise.all(
    owned.slice(0, cap).map(async (n) => {
      const meta = await fetchNftMetadata(network, n.contract, n.tokenId);
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

const MAX_GAS_LIMIT = 1_500_000n;        // sanity cap for non-contract sends
const MAX_GAS_PRICE_GWEI = 500n;          // refuse a runaway gasPrice

async function buildOverrides(provider: AbstractProvider, request?: TransactionRequest) {
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
  const overrides = await buildOverrides(provider, { to, value: valueWei });
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
  const overrides = await buildOverrides(provider, { to: token, data });
  const gasEstimate = await provider.estimateGas({ from: wallet.address, to: token, data });
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
  const overrides = await buildOverrides(provider, request);
  if (!overrides.gasLimit) {
    try {
      const est = await provider.estimateGas({ ...overrides, from: wallet.address });
      overrides.gasLimit = (est * 12n) / 10n;
    } catch {
      // let the chain reject if it must
    }
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
  const bytes = isHexString(message) ? hexlify(message) : toUtf8Bytes(message);
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
