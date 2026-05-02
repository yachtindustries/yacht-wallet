// Curated ApeChain token registry.
// EVM tokens are identified by contract address. The "native" APE has no
// contract — we represent it with a sentinel address (0x0).
import { ZeroAddress, getAddress } from 'ethers';
export const APE = {
    symbol: 'APE',
    name: 'ApeCoin',
    address: ZeroAddress,
    decimals: 18,
    isNative: true,
    verified: true,
    logo: 'https://assets.coingecko.com/coins/images/24383/large/apecoin.jpg',
};
// Wrapped APE on ApeChain — useful for swap routing on most DEXs.
export const WAPE = {
    symbol: 'WAPE',
    name: 'Wrapped APE',
    address: '0x48b62137EdfA95a428D35C09E44256a739F6B557',
    decimals: 18,
    verified: true,
};
export const CURTIS = {
    symbol: 'CURTIS',
    name: 'Curtis',
    address: '0xFC2744A6Db0f97c606Df786b97255DFf6F27E320',
    decimals: 18,
    verified: true,
};
// Curated list. Everything else shows up via DexScreener trending + search.
export const TOP_TOKENS = [APE, CURTIS, WAPE];
export function isNative(t) {
    return !!t && (t.isNative === true || t.address === ZeroAddress);
}
export function tokenKey(t) {
    return isNative(t) ? 'NATIVE' : t.address.toLowerCase();
}
export function tokenEquals(a, b) {
    return tokenKey(a) === tokenKey(b);
}
export function searchTokens(query, extra = []) {
    const q = query.trim().toLowerCase();
    const all = [...TOP_TOKENS, ...extra];
    if (!q)
        return all;
    return all.filter((t) => {
        const sym = t.symbol.toLowerCase();
        const name = t.name.toLowerCase();
        const addr = t.address.toLowerCase();
        return sym.includes(q) || name.includes(q) || addr.includes(q);
    });
}
export function safeChecksum(address) {
    try {
        return getAddress(address);
    }
    catch {
        return address;
    }
}
