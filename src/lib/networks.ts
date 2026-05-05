// ApeChain network config. ApeChain is an EVM L3 (Arbitrum Orbit) with
// native APE. We only ship mainnet; "testnet" is reserved for future use.

export type NetworkId = 'mainnet';

export interface Network {
  id: NetworkId;
  label: string;
  chainId: number;
  chainIdHex: string;
  // Ordered list of RPC endpoints. The first is the primary; on transport
  // failure (network error, 5xx, timeout) the wallet retries the next one.
  // Configuring more than one is the only thing standing between a single
  // provider's outage and every Yacht user seeing "balance: $0".
  rpcUrls: string[];
  nativeSymbol: string;
  nativeDecimals: number;
  explorerUrl: string;
  explorerTx: (h: string) => string;
  explorerAddr: (a: string) => string;
  // DexScreener chainId for this network.
  dexChainId: string;
  // Etherscan-compatible API (used for history). We use the unified
  // Etherscan V2 endpoint with a per-user API key. The legacy api.apescan.io
  // V1 endpoint is deprecated, and Caldera's Blockscout sometimes 524s.
  apiBase: string;
  apiChainParam?: string;
  apiKey?: string;
}

export const NETWORKS: Record<NetworkId, Network> = {
  mainnet: {
    id: 'mainnet',
    label: 'ApeChain',
    chainId: 33139,
    chainIdHex: '0x8173',
    rpcUrls: [
      'https://rpc.apechain.com',
      'https://apechain.calderachain.xyz/http',
    ],
    nativeSymbol: 'APE',
    nativeDecimals: 18,
    explorerUrl: 'https://apescan.io',
    explorerTx: (h) => `https://apescan.io/tx/${h}`,
    explorerAddr: (a) => `https://apescan.io/address/${a}`,
    dexChainId: 'apechain',
    // Etherscan V2 unified API. The chainid must be passed on each call.
    apiBase: 'https://api.etherscan.io/v2/api',
    apiChainParam: '33139',
    apiKey: 'JC9XJF7FBYRTZPR8E4IYP91RWJV1YW1N2R',
  },
};

export const SETTINGS_KEY = 'yacht.settings.v1';

export interface Settings {
  network: NetworkId;
  autoLockMinutes: number;
  fiatCurrency: 'usd' | 'eur' | 'gbp';
}

export const DEFAULT_SETTINGS: Settings = {
  network: 'mainnet',
  autoLockMinutes: 15,
  fiatCurrency: 'usd',
};

export async function readSettings(): Promise<Settings> {
  const r = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(r[SETTINGS_KEY] ?? {}) };
}

export async function writeSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: s });
}
