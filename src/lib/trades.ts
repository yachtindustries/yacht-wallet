// Recent-trades reader for a Uniswap-V2-style pair.
//
// Camelot V2 (the only DEX that backs ApeChain liquidity for Yacht's
// purposes) emits the standard Uniswap V2 Swap event when anyone
// trades against a pair. We read the last `blockWindow` blocks of
// Swap logs and decode them into per-trade records the Token-detail
// page can render.
//
// We resolve which side of the pair the *base* token sits on once
// (token0() vs token1()) so we can correctly classify each Swap as
// a buy or a sell of the displayed token.

import { Contract, Interface, formatUnits } from 'ethers';
import { type NetworkId } from './networks';
import { getProvider } from './evm';

const PAIR_ABI = [
  'function token0() view returns (address)',
  'event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)',
];
const PAIR_IFACE = new Interface(PAIR_ABI);

export interface TradeEntry {
  txHash: string;
  blockNumber: number;
  /** Approximate unix-seconds timestamp (extrapolated from the
   * latest block — ApeChain produces ~1 s blocks so the error
   * is sub-second over a 5000-block window). */
  timestamp: number;
  /** From the displayed token's perspective. */
  type: 'buy' | 'sell';
  /** Amount of the displayed token traded. */
  baseAmount: number;
  /** Amount of the other side traded. */
  quoteAmount: number;
  trader: string;
}

const SWAP_TOPIC = PAIR_IFACE.getEvent('Swap')!.topicHash;

export async function getRecentTrades(
  network: NetworkId,
  pairAddress: string,
  baseTokenAddress: string,
  baseDecimals = 18,
  quoteDecimals = 18,
  opts: { limit?: number; blockWindow?: number } = {},
): Promise<TradeEntry[]> {
  const limit = Math.min(50, Math.max(1, opts.limit ?? 30));
  // ApeChain RPC providers commonly cap eth_getLogs at ~2k blocks
  // per call; 5k was over the line. Default window is now 2000.
  const blockWindow = Math.min(20_000, Math.max(500, opts.blockWindow ?? 2_000));

  const provider = getProvider(network);
  const pair = new Contract(pairAddress, PAIR_ABI, provider);

  let token0Addr: string | null = null;
  try { token0Addr = await pair.token0(); }
  catch (e) {
    // Surface the actual cause to the popup so the user (and
    // future debugger) sees something better than "no trades".
    throw new Error(`Pair contract token0() failed: ${(e as Error).message ?? String(e)}`);
  }
  if (!token0Addr) throw new Error('Pair contract returned empty token0');
  const baseIsToken0 = baseTokenAddress.toLowerCase() === token0Addr.toLowerCase();

  let latestBlock: number;
  let latestTs: number;
  try {
    latestBlock = await provider.getBlockNumber();
    const head = await provider.getBlock(latestBlock);
    latestTs = head?.timestamp ? Number(head.timestamp) : Math.floor(Date.now() / 1000);
  } catch (e) {
    throw new Error(`Block lookup failed: ${(e as Error).message ?? String(e)}`);
  }

  // Try the requested window first; if the RPC complains, fall
  // back to a smaller one. Some upstreams reject any range >1000
  // even when configured for 2000.
  async function tryGetLogs(window: number) {
    return await provider.getLogs({
      address: pairAddress,
      fromBlock: Math.max(0, latestBlock - window),
      toBlock: latestBlock,
      topics: [SWAP_TOPIC],
    });
  }
  let logs: any[];
  try {
    logs = await tryGetLogs(blockWindow);
  } catch (e1) {
    try {
      logs = await tryGetLogs(1000);
    } catch (e2) {
      try {
        logs = await tryGetLogs(500);
      } catch (e3) {
        throw new Error(`Swap-log fetch failed: ${(e3 as Error).message ?? String(e1) ?? String(e2)}`);
      }
    }
  }

  const trades: TradeEntry[] = [];
  // Walk newest-first.
  for (const log of logs.slice().reverse()) {
    if (trades.length >= limit) break;
    try {
      const parsed = PAIR_IFACE.parseLog({ topics: log.topics as string[], data: log.data });
      if (!parsed) continue;
      const [, amount0In, amount1In, amount0Out, amount1Out, to] = parsed.args;
      const a0In = Number(formatUnits(amount0In as bigint, baseIsToken0 ? baseDecimals : quoteDecimals));
      const a1In = Number(formatUnits(amount1In as bigint, baseIsToken0 ? quoteDecimals : baseDecimals));
      const a0Out = Number(formatUnits(amount0Out as bigint, baseIsToken0 ? baseDecimals : quoteDecimals));
      const a1Out = Number(formatUnits(amount1Out as bigint, baseIsToken0 ? quoteDecimals : baseDecimals));

      let type: 'buy' | 'sell';
      let baseAmount: number;
      let quoteAmount: number;
      if (baseIsToken0) {
        // Base = token0
        if (a0Out > 0 && a1In > 0) { type = 'buy';  baseAmount = a0Out; quoteAmount = a1In; }
        else if (a0In > 0 && a1Out > 0) { type = 'sell'; baseAmount = a0In;  quoteAmount = a1Out; }
        else continue;
      } else {
        // Base = token1
        if (a1Out > 0 && a0In > 0) { type = 'buy';  baseAmount = a1Out; quoteAmount = a0In; }
        else if (a1In > 0 && a0Out > 0) { type = 'sell'; baseAmount = a1In;  quoteAmount = a0Out; }
        else continue;
      }

      const tsApprox = latestTs - Math.max(0, latestBlock - log.blockNumber);
      trades.push({
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        timestamp: tsApprox,
        type,
        baseAmount,
        quoteAmount,
        trader: String(to),
      });
    } catch { /* skip malformed log */ }
  }
  return trades;
}
