// ApeChain network config. ApeChain is an EVM L3 (Arbitrum Orbit) with
// native APE. We only ship mainnet; "testnet" is reserved for future use.
export const NETWORKS = {
    mainnet: {
        id: 'mainnet',
        label: 'ApeChain',
        chainId: 33139,
        chainIdHex: '0x8173',
        rpcUrl: 'https://rpc.apechain.com',
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
export const DEFAULT_SETTINGS = {
    network: 'mainnet',
    autoLockMinutes: 15,
    fiatCurrency: 'usd',
};
export async function readSettings() {
    const r = await chrome.storage.local.get(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(r[SETTINGS_KEY] ?? {}) };
}
export async function writeSettings(s) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: s });
}
