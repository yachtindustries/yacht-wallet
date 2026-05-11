// Typed messaging between popup, background, content, and inpage.

import type { NetworkId, Settings } from './networks';
import type { VaultAccount, VaultMeta } from './vault';
import type { AccountSummary, Erc20Balance, Erc20Info, HistoryEntry, OwnedNft, SendResult } from './evm';
import type { SwapQuote, SwapToken } from './camelot';
import type { DexPair } from './dexscreener';
import type { ChatMessage, TipTotal } from './chat';
import type { SyncResult, AchievementSnapshot, RankResult } from './achievements';
import type { TopNftRow } from './topnfts';
import type { ListingsPage, CollectionTrait } from './opensea';
import type { TopUser } from './topusers';
import type { TradeEntry } from './trades';

export interface UnsignedEvmTx {
  to?: string;
  from?: string;
  value?: string;     // hex or decimal string (wei)
  data?: string;      // 0x...
  gas?: string;
  gasLimit?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  nonce?: string | number;
  chainId?: string | number;
}

export interface TypedDataPayload {
  domain: any;
  types: Record<string, any>;
  message: any;
  primaryType?: string;
}

export type RpcRequest =
  | { type: 'vault.status' }
  | { type: 'vault.create.new'; password: string; name?: string }
  | { type: 'vault.create.mnemonic'; password: string; mnemonic: string; name?: string }
  | { type: 'vault.create.privateKey'; password: string; privateKey: string; name?: string }
  | { type: 'vault.unlock'; password: string }
  | { type: 'vault.lock' }
  | { type: 'vault.account.add.derived'; name?: string }
  | { type: 'vault.account.add.privateKey'; privateKey: string; name?: string }
  | { type: 'vault.account.rename'; id: string; name: string }
  | { type: 'vault.account.remove'; id: string }
  | { type: 'vault.account.activate'; id: string }
  | { type: 'vault.account.reveal'; id: string; password: string }
  | { type: 'vault.mnemonic.reveal'; password: string }
  | { type: 'vault.changePassword'; oldPw: string; newPw: string }
  | { type: 'vault.destroy'; password: string }
  | { type: 'settings.get' }
  | { type: 'settings.set'; settings: Partial<Settings> }
  | { type: 'evm.account'; address: string }
  | { type: 'evm.history'; address: string }
  | { type: 'evm.nfts'; address: string }
  | { type: 'evm.erc20.info'; token: string }
  | { type: 'evm.erc20.balance'; token: string; address: string }
  | { type: 'evm.erc20.balances'; tokens: string[]; address: string }
  | { type: 'evm.send.native'; from: string; to: string; amount: string }
  | { type: 'evm.send.erc20'; from: string; token: string; to: string; amount: string }
  | { type: 'evm.send.nft'; from: string; contract: string; tokenId: string; to: string }
  | { type: 'swap.quote'; tokenIn: SwapToken; tokenOut: SwapToken; amountIn: string }
  | {
      type: 'swap.execute';
      account: string;
      tokenIn: SwapToken;
      tokenOut: SwapToken;
      amountIn: string;
      expectedOut: string;
      slippageBps: number;
    }
  | { type: 'evm.sign.tx'; account: string; tx: UnsignedEvmTx }
  | { type: 'evm.sign.message'; account: string; message: string }
  | { type: 'evm.sign.typedData'; account: string; payload: TypedDataPayload }
  | { type: 'price.get' }
  | { type: 'dex.token'; query: string }
  | { type: 'dex.trending'; limit?: number }
  | { type: 'chat.send'; account: string; text: string }
  | { type: 'chat.list'; limit?: number }
  | { type: 'chat.tip'; account: string; toAuthor: string; messageHash: string; apeAmount: string }
  | { type: 'chat.tips'; entries: { messageHash: string; author: string }[] }
  | { type: 'achievements.snapshot'; address: string }
  | { type: 'achievements.sync'; address: string; force?: boolean }
  | { type: 'username.get'; accountId: string }
  | { type: 'username.set'; accountId: string; username: string }
  | { type: 'rank.get'; address: string; force?: boolean }
  | { type: 'nft.topcollections' }
  | { type: 'nft.vote'; account: string; collection: string; apeAmount: string }
  | { type: 'nft.listings'; contract: string; limit?: number; cursor?: string }
  | { type: 'nft.collectionTraits'; contract: string }
  | { type: 'users.top'; force?: boolean }
  | { type: 'tokens.top'; limit?: number }
  | { type: 'nft.collectionFloor'; contract: string }
  | { type: 'nft.detail'; contract: string; tokenId: string }
  | { type: 'pfp.set'; account: string; contract: string; tokenId: string }
  | { type: 'pfp.clear'; account: string }
  | { type: 'pfp.get'; address: string; force?: boolean }
  | { type: 'dex.recentTrades'; pairAddress: string; baseTokenAddress: string; baseDecimals?: number; quoteDecimals?: number; limit?: number }
  | {
      type: 'nft.buy';
      account: string;
      /** Listing identity. */
      orderHash: string;
      protocolAddress: string;
      chain: string;
      /** Contract address of the NFT being bought — validated against
       * the Top NFTs registry. */
      contract: string;
      /** Token ID the user clicked on — verified against the
       * Seaport order's `offer[0].identifierOrCriteria` so a
       * compromised OpenSea response can't swap us onto a
       * different NFT. */
      tokenId: string;
      /** Pre-fetched Seaport protocol_data from the listing response.
       * If present and complete the wallet uses it directly; otherwise
       * it round-trips to OpenSea's fulfillment endpoint. */
      protocolData?: any;
      /** Maximum APE the user is willing to spend (defence against
       * mid-flight price changes / mis-encoded orders). */
      maxApe: string;
    }
  // dApp-originated. Origin is omitted: the background derives it from sender.
  | { type: 'dapp.connect' }
  | { type: 'dapp.getAddress' }
  | { type: 'dapp.signTx'; tx: UnsignedEvmTx }
  | { type: 'dapp.personalSign'; message: string }
  | { type: 'dapp.signTypedData'; payload: TypedDataPayload }
  | { type: 'dapp.rpc'; method: string; params: unknown }
  // popup → background:
  | { type: 'request.approve'; id: string }
  | { type: 'request.reject'; id: string; error: string }
  | { type: 'request.list' }
  | { type: 'request.get'; id: string }
  | { type: 'origins.list' }
  | { type: 'origins.revoke'; origin: string }
  | { type: 'layout.get' }
  | { type: 'layout.set'; mode: 'popup' | 'sidepanel' };

export interface RpcResponseMap {
  'vault.status': { initialized: boolean; unlocked: boolean; meta: VaultMeta };
  'vault.create.new': { mnemonic: string; address: string };
  'vault.create.mnemonic': { address: string };
  'vault.create.privateKey': { address: string };
  'vault.unlock': { ok: true };
  'vault.lock': { ok: true };
  'vault.account.add.derived': { account: VaultAccount };
  'vault.account.add.privateKey': { account: VaultAccount };
  'vault.account.rename': { ok: true };
  'vault.account.remove': { ok: true };
  'vault.account.activate': { ok: true };
  'vault.account.reveal': { privateKey: string };
  'vault.mnemonic.reveal': { mnemonic: string | null };
  'vault.changePassword': { ok: true };
  'vault.destroy': { ok: true };
  'settings.get': Settings;
  'settings.set': Settings;
  'evm.account': AccountSummary;
  'evm.history': HistoryEntry[];
  'evm.nfts': OwnedNft[];
  'evm.erc20.info': Erc20Info;
  'evm.erc20.balance': Erc20Balance;
  'evm.erc20.balances': Erc20Balance[];
  'evm.send.native': SendResult;
  'evm.send.erc20': SendResult;
  'evm.send.nft': SendResult;
  'swap.quote': SwapQuote | null;
  'swap.execute': { approval: { hash: string } | null; swap: SendResult };
  'evm.sign.tx': SendResult;
  'evm.sign.message': { signature: string };
  'evm.sign.typedData': { signature: string };
  'price.get': { usd: number; eur: number; gbp: number; ts: number };
  'dex.token': DexPair | null;
  'dex.trending': DexPair[];
  'chat.send': SendResult;
  'chat.list': ChatMessage[];
  'chat.tip': SendResult;
  'chat.tips': TipTotal[];
  'achievements.snapshot': AchievementSnapshot;
  'achievements.sync': SyncResult;
  'username.get': { username: string };
  'username.set': { username: string };
  'rank.get': RankResult;
  'nft.topcollections': TopNftRow[];
  'nft.vote': SendResult;
  'nft.listings': ListingsPage;
  'nft.collectionTraits': CollectionTrait[];
  'users.top': TopUser[];
  'tokens.top': Array<DexPair & { apeVoted: number; voteCount: number }>;
  'nft.collectionFloor': { floorApe: number | null; slug: string | null };
  'nft.detail': { name: string | null; image: string | null; rarityRank: number | null };
  'pfp.set': SendResult;
  'pfp.clear': SendResult;
  'pfp.get': { contract: string; tokenId: string } | null;
  'dex.recentTrades': TradeEntry[];
  'nft.buy': SendResult;
  'dapp.connect': { address: string; chainId: string };
  'dapp.getAddress': { address: string; chainId: string; network: NetworkId };
  'dapp.signTx': SendResult;
  'dapp.personalSign': { signature: string };
  'dapp.signTypedData': { signature: string };
  'dapp.rpc': unknown;
  'request.approve': { ok: true };
  'request.reject': { ok: true };
  'request.list': PendingRequest[];
  'request.get': PendingRequest | null;
  'origins.list': string[];
  'origins.revoke': { ok: true };
  'layout.get': { mode: 'popup' | 'sidepanel' };
  'layout.set': { ok: true };
}

export type PendingRequestType = 'connect' | 'signTx' | 'personalSign' | 'signTypedData';

export interface PendingRequest {
  id: string;
  type: PendingRequestType;
  origin: string;
  createdAt: number;
  payload: unknown;
}

export interface RpcEnvelope<T extends RpcRequest = RpcRequest> {
  rpc: 'yacht';
  request: T;
}

export interface RpcReply<T = unknown> {
  ok: boolean;
  result?: T;
  error?: string;
}

export async function rpc<T extends RpcRequest>(
  request: T,
): Promise<RpcResponseMap[T['type']]> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage<RpcEnvelope<T>, RpcReply<RpcResponseMap[T['type']]>>(
      { rpc: 'yacht', request },
      (reply) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!reply) return reject(new Error('No response from background'));
        if (!reply.ok) return reject(new Error(reply.error ?? 'Unknown error'));
        resolve(reply.result as RpcResponseMap[T['type']]);
      },
    );
  });
}
