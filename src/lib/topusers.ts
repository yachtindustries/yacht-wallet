// Top Yacht users by combined "support" — total APE they've sent
// out across discovery votes (VOTE_MAGIC → treasury) and chat tips
// (TIP_MAGIC → message authors).
//
// Discovery strategy:
//   • Treasury scan (one Etherscan call) gives us EVERY user who
//     has cast a vote, with per-sender totals — even users who
//     never chat. This is the broadest candidate source.
//   • Chat backlog gives us a username for known senders, and a
//     bounded set of message authors whose incoming-tip txs we
//     scan to aggregate tip outflows by tipper.
//
// Tips and votes are summed per sender; the top 7 are returned.
// Cached 5 minutes in chrome.storage.local.

import { formatUnits } from 'ethers';
import { NETWORKS, type NetworkId } from './networks';
import { TIP_MAGIC, getRecentMessages } from './chat';
import { VOTE_MAGIC } from './voting';
import { TRADING_FEE_TREASURY } from './constants';
import { evaluateRankForAddress } from './achievements';

export interface TopUser {
  address: string;
  username: string | null;
  /** Sum of APE the user has sent across votes + tips. */
  totalApe: number;
  /** Yacht rank tier (1-7). Cached server-side; null while it
   * resolves so the UI doesn't flash a wrong tier. */
  rank: number | null;
  /** Progress fraction (0-1) toward the next tier — used for the
   * ring around the avatar in the Top Users list. */
  rankFraction: number | null;
}

const CACHE_KEY = 'yacht.topUsers.v3';
const CACHE_TTL_MS = 5 * 60_000;
/** Cap on chat-author incoming-tx scans — bounds API call count. */
const MAX_TIP_AUTHOR_SCANS = 20;

interface CachedTopUsers {
  cachedAt: number;
  list: TopUser[];
}

interface RawTx {
  from?: string;
  to?: string;
  input?: string;
  value?: string;
  isError?: string;
  txreceipt_status?: string;
}

async function readCache(): Promise<CachedTopUsers | null> {
  try {
    const r = await chrome.storage.local.get(CACHE_KEY);
    return (r[CACHE_KEY] as CachedTopUsers | undefined) ?? null;
  } catch { return null; }
}

async function writeCache(list: TopUser[]): Promise<void> {
  try {
    await chrome.storage.local.set({
      [CACHE_KEY]: { cachedAt: Date.now(), list },
    });
  } catch { /* best effort */ }
}

async function fetchAddressTxs(network: NetworkId, address: string, offset = 1000): Promise<RawTx[]> {
  const cfg = NETWORKS[network];
  const merged: Record<string, string> = {
    module: 'account',
    action: 'txlist',
    address,
    startblock: '0',
    endblock: '99999999',
    page: '1',
    offset: String(offset),
    sort: 'desc',
  };
  if (cfg.apiChainParam) merged.chainid = cfg.apiChainParam;
  if (cfg.apiKey) merged.apikey = cfg.apiKey;
  const qs = new URLSearchParams(merged).toString();
  try {
    const r = await fetch(`${cfg.apiBase}?${qs}`);
    if (!r.ok) return [];
    const j: any = await r.json();
    return Array.isArray(j?.result) ? (j.result as RawTx[]) : [];
  } catch { return []; }
}

function safeApe(weiStr: string | undefined): number {
  try { return parseFloat(formatUnits(BigInt(weiStr ?? '0'), 18)); }
  catch { return 0; }
}

function txOk(t: RawTx): boolean {
  if (t.isError === '1') return false;
  if (t.txreceipt_status && t.txreceipt_status !== '1') return false;
  return true;
}

export async function getTopUsers(network: NetworkId, opts?: { force?: boolean }): Promise<TopUser[]> {
  if (!opts?.force) {
    const cached = await readCache();
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.list;
  }

  const treasuryLc = TRADING_FEE_TREASURY.toLowerCase();
  const voteMagicLc = VOTE_MAGIC.toLowerCase();
  const tipMagicLc = TIP_MAGIC.toLowerCase();

  // Two parallel reads: the treasury's incoming txs (yields all
  // vote senders + per-sender totals from a single API call) and
  // the chat backlog (yields usernames + the author set we'll
  // scan for tippers).
  const [treasuryTxs, messages] = await Promise.all([
    fetchAddressTxs(network, treasuryLc, 1000),
    getRecentMessages(network, 200).catch(() => []),
  ]);

  // Vote totals per sender — directly from treasury txs.
  const voteByUser = new Map<string, number>();
  for (const t of treasuryTxs) {
    if (!txOk(t)) continue;
    if ((t.to ?? '').toLowerCase() !== treasuryLc) continue;
    if (!(t.input ?? '').toLowerCase().startsWith(voteMagicLc)) continue;
    const from = (t.from ?? '').toLowerCase();
    if (!from) continue;
    voteByUser.set(from, (voteByUser.get(from) ?? 0) + safeApe(t.value));
  }

  // Username index from chat backlog.
  const usernameByAddr = new Map<string, string>();
  const authorSet = new Set<string>();
  for (const m of messages) {
    if (!m.from) continue;
    const lc = m.from.toLowerCase();
    authorSet.add(lc);
    if (m.username && !usernameByAddr.has(lc)) usernameByAddr.set(lc, m.username);
  }
  const authors = [...authorSet].slice(0, MAX_TIP_AUTHOR_SCANS);

  // Tip totals per sender — for each chat author (capped), pull
  // their tx history, filter to incoming TIP_MAGIC txs, attribute
  // the value to the `from` address.
  const tipByUser = new Map<string, number>();
  await Promise.all(authors.map(async (author) => {
    const txs = await fetchAddressTxs(network, author, 300);
    for (const t of txs) {
      if (!txOk(t)) continue;
      if ((t.to ?? '').toLowerCase() !== author) continue;
      if (!(t.input ?? '').toLowerCase().startsWith(tipMagicLc)) continue;
      const from = (t.from ?? '').toLowerCase();
      if (!from || from === author) continue;
      tipByUser.set(from, (tipByUser.get(from) ?? 0) + safeApe(t.value));
    }
  }));

  // Combine vote + tip totals per sender. Includes users who only
  // voted (never chatted) AND chat tippers — broad and honest.
  const allSenders = new Set<string>([...voteByUser.keys(), ...tipByUser.keys()]);
  const list: TopUser[] = [];
  for (const lc of allSenders) {
    const total = (voteByUser.get(lc) ?? 0) + (tipByUser.get(lc) ?? 0);
    if (total <= 0) continue;
    list.push({
      address: lc,
      username: usernameByAddr.get(lc) ?? null,
      totalApe: total,
      rank: null,
      rankFraction: null,
    });
  }
  list.sort((a, b) => b.totalApe - a.totalApe);
  const trimmed = list.slice(0, 7);

  // Augment with rank — uses the same cached evaluator the rest of
  // the wallet uses, so 5-min cache hits make this near-instant on
  // re-renders.
  const top = await Promise.all(
    trimmed.map(async (u) => {
      try {
        const r = await evaluateRankForAddress(network, u.address);
        return { ...u, rank: r.rank, rankFraction: r.fraction };
      } catch {
        return { ...u, rank: null, rankFraction: null };
      }
    }),
  );

  await writeCache(top);
  return top;
}
