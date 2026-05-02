// Typed messaging between popup, background, content, and inpage.

import type { NetworkId, Settings } from './networks';
import type { VaultAccount, VaultMeta } from './vault';
import type { AccountSummary, Erc20Balance, Erc20Info, HistoryEntry, OwnedNft, SendResult } from './evm';
import type { SwapQuote, SwapToken } from './camelot';
import type { DexPair } from './dexscreener';

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
  // dApp-originated. Origin is omitted: the background derives it from sender.
  | { type: 'dapp.connect' }
  | { type: 'dapp.getAddress' }
  | { type: 'dapp.signTx'; tx: UnsignedEvmTx }
  | { type: 'dapp.personalSign'; message: string }
  | { type: 'dapp.signTypedData'; payload: TypedDataPayload }
  // popup → background:
  | { type: 'request.resolve'; id: string; result: unknown }
  | { type: 'request.reject'; id: string; error: string }
  | { type: 'request.list' }
  | { type: 'request.get'; id: string }
  | { type: 'origins.list' }
  | { type: 'origins.revoke'; origin: string };

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
  'swap.quote': SwapQuote | null;
  'swap.execute': { approval: { hash: string } | null; swap: SendResult };
  'evm.sign.tx': SendResult;
  'evm.sign.message': { signature: string };
  'evm.sign.typedData': { signature: string };
  'price.get': { usd: number; eur: number; gbp: number; ts: number };
  'dex.token': DexPair | null;
  'dex.trending': DexPair[];
  'dapp.connect': { address: string; chainId: string };
  'dapp.getAddress': { address: string; chainId: string; network: NetworkId };
  'dapp.signTx': SendResult;
  'dapp.personalSign': { signature: string };
  'dapp.signTypedData': { signature: string };
  'request.resolve': { ok: true };
  'request.reject': { ok: true };
  'request.list': PendingRequest[];
  'request.get': PendingRequest | null;
  'origins.list': string[];
  'origins.revoke': { ok: true };
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
