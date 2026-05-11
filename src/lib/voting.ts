// On-chain NFT-collection voting.
//
// Each vote is a real APE transfer from the voter's EOA to the Yacht
// trading-fee treasury. The data field carries `VOTE_MAGIC` (4 bytes)
// followed by the voted-on collection's contract address (20 bytes),
// for a total of 24 bytes / 48 hex chars. Aggregation walks the
// treasury's incoming txs via Etherscan, filters to inputs starting
// with VOTE_MAGIC, and groups by the parsed collection address.
//
// Votes auto-expire weekly: aggregation only counts txs whose
// `timeStamp` is at or after the current ISO-week start (Monday 00:00
// UTC). No on-chain reset is needed — old votes simply stop being
// counted at week rollover.

import { Wallet, formatUnits, parseUnits } from 'ethers';
import { NETWORKS, type NetworkId } from './networks';
import { getProvider, type SendResult } from './evm';
import { TRADING_FEE_TREASURY } from './constants';

/**
 * 4-byte magic prefix tagging vote txs. ASCII for "YVOT". Distinct
 * from TIP_MAGIC ("YTIP") so the same treasury can receive both
 * without ambiguity.
 */
export const VOTE_MAGIC = '0x59564f54';

export const VOTE_AMOUNTS = ['0.1', '1', '10'] as const;
export type VoteAmount = (typeof VOTE_AMOUNTS)[number];

/** Start of the current ISO week (Monday 00:00 UTC) as unix seconds. */
export function currentWeekStartSec(): number {
  const d = new Date();
  const day = d.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const offsetDays = day === 0 ? 6 : day - 1;
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - offsetDays);
  return Math.floor(d.getTime() / 1000);
}

/** Cast a single vote for `collection` by sending `apeAmount` APE to
 * the Yacht treasury with a vote-tagged data field. */
export async function castVote(
  network: NetworkId,
  privateKey: string,
  collection: string,
  apeAmount: string,
): Promise<SendResult> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(collection)) {
    throw new Error('Invalid collection contract');
  }
  if (!(VOTE_AMOUNTS as readonly string[]).includes(apeAmount)) {
    throw new Error('Invalid vote amount');
  }
  const value = parseUnits(apeAmount, 18);
  if (value <= 0n) throw new Error('Vote amount must be positive');
  // Cap at 100 APE just like chat tipping — defence against an
  // accidental "send 1000 APE" wired through this code path.
  if (value > parseUnits('100', 18)) throw new Error('Vote amount too large');

  // Data: VOTE_MAGIC (4 bytes) + collection address (20 bytes). The
  // user's address contributes via tx.from; we do not embed it.
  const data = VOTE_MAGIC + collection.slice(2).toLowerCase();

  const provider = getProvider(network);
  const wallet = new Wallet(privateKey, provider);
  const tx = await wallet.sendTransaction({
    to: TRADING_FEE_TREASURY,
    value,
    data,
  });
  const receipt = await tx.wait();
  if (!receipt) throw new Error('Vote tx dropped from mempool');
  return {
    hash: receipt.hash,
    status: receipt.status === 1 ? 'success' : 'failed',
    blockNumber: receipt.blockNumber,
    raw: receipt,
  };
}

interface RawTx {
  hash?: string;
  from?: string;
  to?: string;
  input?: string;
  value?: string;
  timeStamp?: string;
  isError?: string;
  txreceipt_status?: string;
}

export interface VoteTally {
  /** Sum of APE sent for this collection during the current week. */
  apeTotal: number;
  /** Number of distinct vote transactions. */
  voteCount: number;
}

/**
 * Aggregate this-week voting per collection. The "vote weight" is the
 * total APE sent for the collection (so a 10 APE vote counts 100x more
 * than a 0.1 APE vote). The tx count is also returned for display.
 *
 * The treasury receives non-vote txs (trading-fee skims) which the
 * VOTE_MAGIC prefix check skips correctly.
 */
export async function getVoteTalliesForWeek(
  network: NetworkId,
): Promise<Record<string, VoteTally>> {
  const cfg = NETWORKS[network];
  const params: Record<string, string> = {
    module: 'account',
    action: 'txlist',
    address: TRADING_FEE_TREASURY,
    startblock: '0',
    endblock: '99999999',
    page: '1',
    // Treasury is busy (every swap fee + every vote lands here);
    // 5000 entries on a single page (Etherscan V2 max) keeps
    // mid-week votes visible even on heavy fee days. Audit M11:
    // the prior 1000-entry window was getting truncated.
    offset: '5000',
    sort: 'desc',
  };
  if (cfg.apiChainParam) params.chainid = cfg.apiChainParam;
  if (cfg.apiKey) params.apikey = cfg.apiKey;
  const qs = new URLSearchParams(params).toString();
  let rows: RawTx[] = [];
  try {
    const r = await fetch(`${cfg.apiBase}?${qs}`);
    if (r.ok) {
      const j: any = await r.json();
      if (Array.isArray(j.result)) rows = j.result as RawTx[];
    }
  } catch {
    return {};
  }

  const weekStart = currentWeekStartSec();
  const treasuryLc = TRADING_FEE_TREASURY.toLowerCase();
  const magic = VOTE_MAGIC.toLowerCase();
  const tallies: Record<string, VoteTally> = {};

  for (const tx of rows) {
    if (!tx.input || !tx.input.toLowerCase().startsWith(magic)) continue;
    if ((tx.to ?? '').toLowerCase() !== treasuryLc) continue;
    const ts = parseInt(tx.timeStamp ?? '0', 10);
    if (!Number.isFinite(ts) || ts < weekStart) continue;
    if (tx.isError === '1' || (tx.txreceipt_status && tx.txreceipt_status !== '1')) continue;
    // Parse collection address from the data field. Hex layout:
    //   chars 0-1   "0x"
    //   chars 2-9   8 hex chars = 4 magic bytes
    //   chars 10-49 40 hex chars = 20 collection-address bytes
    const inp = tx.input.toLowerCase();
    if (inp.length < 50) continue;
    const collection = '0x' + inp.slice(10, 50);
    if (!/^0x[0-9a-f]{40}$/.test(collection)) continue;
    let apeAmount = 0;
    try {
      apeAmount = parseFloat(formatUnits(BigInt(tx.value ?? '0'), 18));
    } catch { continue; }
    if (!Number.isFinite(apeAmount) || apeAmount <= 0) continue;
    const cur = tallies[collection] ?? { apeTotal: 0, voteCount: 0 };
    cur.apeTotal += apeAmount;
    cur.voteCount += 1;
    tallies[collection] = cur;
  }
  return tallies;
}
