// On-chain profile-picture registry.
//
// A "set PFP" operation is a 0-value tx from the user to a designated
// inbox address. The tx data carries:
//
//   PFP_MAGIC (4 bytes)  +  contract (20 bytes)  +  tokenId (32 bytes)
//
// To read someone's PFP, we walk their outgoing txs to YACHT_PFP_INBOX
// (Etherscan filter), pick the most recent with a valid magic, and
// decode contract + tokenId. Sending all-zeros for contract is the
// "clear" operation.
//
// This makes PFPs portable across devices and visible to ANY Yacht
// client looking at someone's address — chat, top-users list, profile
// view all read from the same on-chain source of truth.

import { Contract, Wallet } from 'ethers';
import { NETWORKS, type NetworkId } from './networks';
import { getProvider, type SendResult } from './evm';

const ERC721_OWNER_ABI = ['function ownerOf(uint256 tokenId) view returns (address)'];
const ERC1155_BALANCE_ABI = ['function balanceOf(address account, uint256 id) view returns (uint256)'];

/** Inbox address for PFP-set txs — undeployed, just a topic
 * identifier the same way YACHT_CHAT_INBOX is. */
export const YACHT_PFP_INBOX = '0xC4A7000000000000000000000000000000000001';
/** ASCII "YPFP". */
export const PFP_MAGIC = '0x59504650';

export interface OnChainPfp {
  contract: string;
  tokenId: string;
}

/** Encode PFP data: MAGIC + contract (20) + tokenId (32) = 56 bytes. */
function encodePfpData(contract: string, tokenId: string): string {
  const c = contract.replace(/^0x/, '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(c)) throw new Error('Invalid contract address');
  let id: bigint;
  try { id = BigInt(tokenId); } catch { throw new Error('Invalid token id'); }
  if (id < 0n) throw new Error('tokenId cannot be negative');
  const idHex = id.toString(16).padStart(64, '0');
  return PFP_MAGIC + c + idHex;
}

/** Submit an on-chain PFP set. */
export async function setOnChainPfp(
  network: NetworkId,
  privateKey: string,
  contract: string,
  tokenId: string,
): Promise<SendResult> {
  const data = encodePfpData(contract, tokenId);
  const provider = getProvider(network);
  const wallet = new Wallet(privateKey, provider);
  const tx = await wallet.sendTransaction({
    to: YACHT_PFP_INBOX,
    value: 0n,
    data,
  });
  const receipt = await tx.wait();
  if (!receipt) throw new Error('PFP set tx dropped from mempool');
  return {
    hash: receipt.hash,
    status: receipt.status === 1 ? 'success' : 'failed',
    blockNumber: receipt.blockNumber,
    raw: receipt,
  };
}

/** Send the "clear PFP" sentinel — magic + 56 zero bytes. */
export async function clearOnChainPfp(
  network: NetworkId,
  privateKey: string,
): Promise<SendResult> {
  const data = PFP_MAGIC + '0'.repeat(40 + 64); // 20 zero-bytes contract + 32 zero-bytes id
  const provider = getProvider(network);
  const wallet = new Wallet(privateKey, provider);
  const tx = await wallet.sendTransaction({
    to: YACHT_PFP_INBOX,
    value: 0n,
    data,
  });
  const receipt = await tx.wait();
  if (!receipt) throw new Error('PFP clear tx dropped from mempool');
  return {
    hash: receipt.hash,
    status: receipt.status === 1 ? 'success' : 'failed',
    blockNumber: receipt.blockNumber,
    raw: receipt,
  };
}

// ─── Reader ────────────────────────────────────────────────────────────────

const CACHE_KEY = 'yacht.onchainPfp.v1';
// Split TTL: a *resolved* PFP is stable so we cache for 30 min,
// but a *null* result (no on-chain PFP found) might be wrong if
// the user just published one — re-check after 60 s.
const CACHE_TTL_RESOLVED_MS = 30 * 60_000;
const CACHE_TTL_NULL_MS = 60_000;

interface CachedEntry { pfp: OnChainPfp | null; cachedAt: number }
type Cache = { [addressLc: string]: CachedEntry };

async function readCache(): Promise<Cache> {
  try {
    const r = await chrome.storage.local.get(CACHE_KEY);
    return (r[CACHE_KEY] as Cache | undefined) ?? {};
  } catch { return {}; }
}
async function writeCache(c: Cache): Promise<void> {
  try { await chrome.storage.local.set({ [CACHE_KEY]: c }); } catch { /* best effort */ }
}

interface RawTx {
  from?: string;
  to?: string;
  input?: string;
  timeStamp?: string;
  isError?: string;
  txreceipt_status?: string;
}

function parsePfpData(input: string): OnChainPfp | null {
  if (!input || input.length < 2 + 8) return null;
  const lc = input.toLowerCase();
  if (!lc.startsWith(PFP_MAGIC.toLowerCase())) return null;
  // 0x + 8 magic chars = 10. Then 40 contract chars then 64 token-id chars.
  if (lc.length < 10 + 40 + 64) return null;
  const contractHex = lc.slice(10, 10 + 40);
  const tokenIdHex = lc.slice(10 + 40, 10 + 40 + 64);
  if (!/^[0-9a-f]{40}$/.test(contractHex) || !/^[0-9a-f]{64}$/.test(tokenIdHex)) return null;
  // All-zero contract = "clear" sentinel.
  if (contractHex === '0'.repeat(40)) return null;
  let tokenId: string;
  try { tokenId = BigInt('0x' + tokenIdHex).toString(); }
  catch { return null; }
  return {
    contract: '0x' + contractHex,
    tokenId,
  };
}

export async function getOnChainPfp(
  network: NetworkId,
  address: string,
  opts?: { force?: boolean },
): Promise<OnChainPfp | null> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  const lc = address.toLowerCase();
  if (!opts?.force) {
    const cache = await readCache();
    const hit = cache[lc];
    if (hit) {
      const ttl = hit.pfp ? CACHE_TTL_RESOLVED_MS : CACHE_TTL_NULL_MS;
      if (Date.now() - hit.cachedAt < ttl) return hit.pfp;
    }
  }

  const cfg = NETWORKS[network];
  const merged: Record<string, string> = {
    module: 'account',
    action: 'txlist',
    address,
    startblock: '0',
    endblock: '99999999',
    page: '1',
    offset: '300',
    sort: 'desc',
  };
  if (cfg.apiChainParam) merged.chainid = cfg.apiChainParam;
  if (cfg.apiKey) merged.apikey = cfg.apiKey;
  const qs = new URLSearchParams(merged).toString();

  let pfp: OnChainPfp | null = null;
  try {
    const r = await fetch(`${cfg.apiBase}?${qs}`);
    if (r.ok) {
      const j: any = await r.json();
      const rows: RawTx[] = Array.isArray(j?.result) ? j.result : [];
      const inboxLc = YACHT_PFP_INBOX.toLowerCase();
      for (const t of rows) {
        if ((t.from ?? '').toLowerCase() !== lc) continue;
        if ((t.to ?? '').toLowerCase() !== inboxLc) continue;
        if (t.isError === '1' || (t.txreceipt_status && t.txreceipt_status !== '1')) continue;
        const decoded = parsePfpData(String(t.input ?? ''));
        if (decoded !== null) {
          pfp = decoded;
          break; // most recent first because sort=desc
        }
        // A "clear" sentinel (parsed as null) still wins over older
        // sets, since the user explicitly cleared.
        const lcInput = String(t.input ?? '').toLowerCase();
        if (lcInput.startsWith(PFP_MAGIC.toLowerCase())) {
          pfp = null;
          break;
        }
      }
    }
  } catch { /* leave pfp null */ }

  // Audit H5: PFP impersonation defense. Anyone can publish a
  // "PFP set" tx claiming any contract+tokenId; without an
  // ownership check, Bob could put Alice's expensive Bored Ape on
  // his profile and trick chat viewers into thinking he owns it.
  // Verify on-chain that the address actually holds the token —
  // ERC-721 ownerOf first, ERC-1155 balanceOf as fallback. On any
  // failure to verify, drop the PFP.
  if (pfp) {
    const verified = await verifyTokenOwnership(network, address, pfp).catch(() => false);
    if (!verified) pfp = null;
  }

  const cache = await readCacheGc();
  cache[lc] = { pfp, cachedAt: Date.now() };
  await writeCache(cache);
  return pfp;
}

async function verifyTokenOwnership(
  network: NetworkId,
  address: string,
  pfp: OnChainPfp,
): Promise<boolean> {
  const provider = getProvider(network);
  const lc = address.toLowerCase();
  // ERC-721 path — ownerOf is the canonical ownership check.
  try {
    const c721 = new Contract(pfp.contract, ERC721_OWNER_ABI, provider);
    const owner = await c721.ownerOf(BigInt(pfp.tokenId));
    if (typeof owner === 'string' && owner.toLowerCase() === lc) return true;
  } catch { /* fall through to 1155 */ }
  // ERC-1155 path — ownerOf doesn't exist; positive balance = ownership.
  try {
    const c1155 = new Contract(pfp.contract, ERC1155_BALANCE_ABI, provider);
    const bal: bigint = await c1155.balanceOf(address, BigInt(pfp.tokenId));
    return typeof bal === 'bigint' && bal > 0n;
  } catch { return false; }
}

// Audit M13: cap the cache so a long-running wallet that views
// many addresses doesn't grow the storage entry forever. We evict
// the oldest entries when over the cap. 200 entries × ~120 bytes
// each ≈ 24 KB, well within chrome.storage.local's 5 MB quota.
const CACHE_MAX_ENTRIES = 200;
async function readCacheGc(): Promise<Cache> {
  const c = await readCache();
  const keys = Object.keys(c);
  if (keys.length <= CACHE_MAX_ENTRIES) return c;
  const sorted = keys
    .map((k) => [k, c[k].cachedAt] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, CACHE_MAX_ENTRIES);
  const next: Cache = {};
  for (const [k] of sorted) next[k] = c[k];
  return next;
}
