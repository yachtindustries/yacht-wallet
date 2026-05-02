// @yacht/sdk — tiny dApp-side helper for integrating with the Yacht
// browser-extension wallet on ApeChain (EVM).
//
// Yacht implements the standard EIP-1193 / EIP-6963 surfaces, so any EVM
// library (ethers, viem, web3.js) works out of the box. This SDK adds a
// typed, race-tolerant detection helper.
//
// Usage:
//   import { getYacht, connect } from '@yacht/sdk';
//
//   const yacht = await getYacht();
//   if (!yacht) return alert('Install Yacht');
//   const accounts = await yacht.request<string[]>({ method: 'eth_requestAccounts' });

export interface YachtProviderInfo {
  name: string;
  uuid: string;
  icon: string;
  rdns: string;
}

export interface YachtProvider {
  isYacht: true;
  chainId: string;
  selectedAddress: string | null;
  info: YachtProviderInfo;
  request: <T = unknown>(args: { method: string; params?: unknown }) => Promise<T>;
  on: (event: string, handler: (...args: any[]) => void) => void;
  removeListener: (event: string, handler: (...args: any[]) => void) => void;
  connect: () => Promise<{ address: string; chainId: string }>;
  getAddress: () => Promise<{ address: string; chainId: string; network: string }>;
}

declare global {
  interface Window {
    yacht?: YachtProvider;
    ethereum?: YachtProvider | { isYacht?: boolean; [k: string]: unknown };
  }
}

export const YACHT_INSTALL_URL = 'https://chrome.google.com/webstore/detail/yacht';
export const APECHAIN_CHAIN_ID = '0x8173';

export async function getYacht(timeoutMs = 1000): Promise<YachtProvider | null> {
  const direct = directlyAvailable();
  if (direct) return direct;

  return new Promise((resolve) => {
    let resolved = false;
    const finish = (p: YachtProvider | null) => {
      if (resolved) return;
      resolved = true;
      window.removeEventListener('eip6963:announceProvider', onAnnounce as EventListener);
      window.removeEventListener('ethereum#initialized', onInit);
      resolve(p);
    };
    const onAnnounce = (e: CustomEvent<{ info: YachtProviderInfo; provider: YachtProvider }>) => {
      if (e.detail?.info?.rdns === 'app.yacht') finish(e.detail.provider);
    };
    const onInit = () => {
      const p = directlyAvailable();
      if (p) finish(p);
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce as EventListener);
    window.addEventListener('ethereum#initialized', onInit);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    window.setTimeout(() => finish(directlyAvailable()), timeoutMs);
  });
}

function directlyAvailable(): YachtProvider | null {
  if (typeof window === 'undefined') return null;
  if (window.yacht?.isYacht) return window.yacht as YachtProvider;
  const e = window.ethereum as any;
  if (e?.isYacht) return e as YachtProvider;
  return null;
}

export async function connect(): Promise<{ address: string; chainId: string }> {
  const p = await getYacht();
  if (!p) throw new Error(`Yacht not installed. Get it: ${YACHT_INSTALL_URL}`);
  return p.connect();
}

export async function getAddress(): Promise<{ address: string; chainId: string; network: string }> {
  const p = await getYacht();
  if (!p) throw new Error(`Yacht not installed. Get it: ${YACHT_INSTALL_URL}`);
  return p.getAddress();
}

export async function listEvmProviders(timeoutMs = 500): Promise<Array<{ info: YachtProviderInfo; provider: YachtProvider }>> {
  const found = new Map<string, { info: YachtProviderInfo; provider: YachtProvider }>();
  const onAnnounce = (e: CustomEvent<{ info: YachtProviderInfo; provider: YachtProvider }>) => {
    if (e.detail?.info?.rdns) found.set(e.detail.info.rdns, e.detail);
  };
  window.addEventListener('eip6963:announceProvider', onAnnounce as EventListener);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  await new Promise((r) => setTimeout(r, timeoutMs));
  window.removeEventListener('eip6963:announceProvider', onAnnounce as EventListener);
  return [...found.values()];
}
