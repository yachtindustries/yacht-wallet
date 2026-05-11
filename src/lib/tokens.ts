// Curated ApeChain token registry.
// EVM tokens are identified by contract address. The "native" APE has no
// contract — we represent it with a sentinel address (0x0).

import { ZeroAddress, getAddress } from 'ethers';

export interface TokenMeta {
  symbol: string;
  name: string;
  address: string;       // 0x address; ZeroAddress for native APE
  decimals: number;
  logo?: string;
  isNative?: boolean;
  verified?: boolean;
}

export const APE: TokenMeta = {
  symbol: 'APE',
  name: 'ApeCoin',
  address: ZeroAddress,
  decimals: 18,
  isNative: true,
  verified: true,
  logo: 'https://assets.coingecko.com/coins/images/24383/large/apecoin.jpg',
};

// Wrapped APE on ApeChain — useful for swap routing on most DEXs.
export const WAPE: TokenMeta = {
  symbol: 'WAPE',
  name: 'Wrapped APE',
  address: '0x48b62137EdfA95a428D35C09E44256a739F6B557',
  decimals: 18,
  verified: true,
};

export const CURTIS: TokenMeta = {
  symbol: 'CURTIS',
  name: 'Curtis',
  address: '0xFC2744A6Db0f97c606Df786b97255DFf6F27E320',
  decimals: 18,
  verified: true,
};

export const BLUE: TokenMeta = {
  symbol: 'BLUE',
  name: 'Blue',
  address: '0x2C7A31a9b44Cd9c485314008B3F638758E6A8470',
  decimals: 18,
  verified: true,
};

export const MURTIS: TokenMeta = {
  symbol: 'MURTIS',
  name: 'Murtis',
  address: '0xB0a563dDd67237E1c8a0995C432d879fA3ecd6FE',
  decimals: 18,
  verified: true,
};

export const WONG: TokenMeta = {
  symbol: 'WONG',
  name: 'Wong',
  address: '0xd6e4DF460D9ba104Dfc5Dc57DB392c177083d20c',
  decimals: 18,
  verified: true,
};

export const PNUTZ: TokenMeta = {
  symbol: 'PNutz',
  name: 'PNutz',
  address: '0x54A70516e9c0223F4a92bE3a4832a06f546e783B',
  decimals: 18,
  verified: true,
};

// Curated list. Everything else shows up via DexScreener trending + search.
export const TOP_TOKENS: TokenMeta[] = [APE, CURTIS, BLUE, MURTIS, WONG, PNUTZ, WAPE];

export function isNative(t: TokenMeta | undefined | null): boolean {
  return !!t && (t.isNative === true || t.address === ZeroAddress);
}

export function tokenKey(t: TokenMeta): string {
  return isNative(t) ? 'NATIVE' : t.address.toLowerCase();
}

export function tokenEquals(a: TokenMeta, b: TokenMeta): boolean {
  return tokenKey(a) === tokenKey(b);
}

export function searchTokens(query: string, extra: TokenMeta[] = []): TokenMeta[] {
  const q = query.trim().toLowerCase();
  const all = [...TOP_TOKENS, ...extra];
  if (!q) return all;
  return all.filter((t) => {
    const sym = t.symbol.toLowerCase();
    const name = t.name.toLowerCase();
    const addr = t.address.toLowerCase();
    return sym.includes(q) || name.includes(q) || addr.includes(q);
  });
}

export function safeChecksum(address: string): string {
  try {
    return getAddress(address);
  } catch {
    return address;
  }
}

/**
 * Lower-case set of every token address in TOP_TOKENS that's marked
 * `verified: true`. UI uses this to render a verified-checkmark badge
 * and to push verified tokens to the top of the Discover trending list.
 */
const VERIFIED_ADDRESSES = new Set(
  TOP_TOKENS.filter((t) => t.verified).map((t) => t.address.toLowerCase()),
);

export function isVerifiedAddress(address: string | undefined | null): boolean {
  if (!address) return false;
  return VERIFIED_ADDRESSES.has(address.toLowerCase());
}
