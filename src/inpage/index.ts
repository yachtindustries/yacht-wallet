// Injected provider — exposes window.yacht AND a standard EIP-1193 window.ethereum
// for ApeChain dApps.
//
// Multi-wallet discovery: any EVM wallet may want to claim window.ethereum,
// which means whoever loads last wins. Following EIP-6963, we ALSO dispatch a
// custom "eip6963:announceProvider" event with our self-describing info, so
// dApps can discover us alongside other installed wallets.
//
// Defensive design: every message uses an unguessable random ID so a malicious
// page script cannot pre-register a fake reply ID. Replies that don't match a
// pending request are silently dropped.

interface YachtProvider {
  isYacht: true;
  isMetaMask: false;
  chainId: string;
  selectedAddress: string | null;
  info: { name: string; uuid: string; icon: string; rdns: string };
  request: <T = unknown>(args: { method: string; params?: unknown }) => Promise<T>;
  on: (event: string, handler: (...args: any[]) => void) => void;
  removeListener: (event: string, handler: (...args: any[]) => void) => void;
  // Convenience helpers
  connect: () => Promise<{ address: string; chainId: string }>;
  getAddress: () => Promise<{ address: string; chainId: string; network: string }>;
}

const RPC_PREFIX = 'yacht.dapp';
const pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();
const listeners = new Map<string, Set<(...args: any[]) => void>>();

function randomId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.kind !== `${RPC_PREFIX}.reply`) return;
  if (typeof data.id !== 'string') return;
  const cb = pending.get(data.id);
  if (!cb) return;
  pending.delete(data.id);
  if (data.ok) cb.resolve(data.result);
  else cb.reject(new Error(typeof data.error === 'string' ? data.error : 'Wallet error'));
});

// 5-minute TTL on pending entries so an abandoned request (user closed the
// popup, content script died) doesn't leak the entry forever and grow the
// map under repeated dApp calls.
const PENDING_TTL_MS = 5 * 60 * 1000;

function send<T>(method: string, params?: unknown): Promise<T> {
  const id = randomId();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.delete(id)) reject(new Error('Wallet request timed out'));
    }, PENDING_TTL_MS);
    pending.set(id, {
      resolve: (v: any) => { clearTimeout(timer); resolve(v); },
      reject: (e: Error) => { clearTimeout(timer); reject(e); },
    });
    window.postMessage({ kind: `${RPC_PREFIX}.request`, id, method, params }, window.location.origin);
  });
}

function emit(event: string, ...args: any[]) {
  const set = listeners.get(event);
  if (!set) return;
  for (const fn of set) {
    try { fn(...args); } catch { /* ignore handler errors */ }
  }
}

const APECHAIN_CHAIN_ID_HEX = '0x8173';

// Audit M2/M3: the provider is exposed to the page realm — any
// script on the same origin (a third-party script tag, an injected
// extension content script, our own dApp's analytics) can read AND
// write the fields we expose. We freeze every field the dApp picker
// trusts (`info.name`, `info.uuid`, `info.rdns`, `info.icon`, plus
// `isYacht` / `isMetaMask`) and back `selectedAddress` with a
// closed-over private variable + getter, so those fields cannot be
// rewritten by a third-party script trying to spoof the wallet
// identity or trick UI code that reads provider.selectedAddress.
let _selectedAddress: string | null = null;

const _info = Object.freeze({
  name: 'Yacht',
  uuid: '8a4f4bbf-3a7b-4d6e-9e57-8f71e4a8f1c2',
  // Navy rounded square with the white yacht silhouette — matches the
  // in-app dark-blue brand. dApp wallet pickers (EIP-6963) render this
  // alongside the wallet's display name.
  icon: 'data:image/png;base64,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',
  rdns: 'app.yacht',
});

const provider = {} as YachtProvider;

Object.defineProperties(provider, {
  isYacht: { value: true, writable: false, enumerable: true, configurable: false },
  isMetaMask: { value: false, writable: false, enumerable: true, configurable: false },
  chainId: { value: APECHAIN_CHAIN_ID_HEX, writable: false, enumerable: true, configurable: false },
  info: { value: _info, writable: false, enumerable: true, configurable: false },
  // selectedAddress is read-only from the page's perspective. The
  // wallet updates the closed-over `_selectedAddress` after a
  // successful eth_requestAccounts. A page script can no longer
  // assign `provider.selectedAddress = '0xAttackerAddress'` to
  // mislead UI code that uses this field as a hint.
  selectedAddress: { get: () => _selectedAddress, enumerable: true, configurable: false },
  request: {
    value: async ({ method, params }: { method: string; params?: unknown }) => {
      const result = await send<any>(method, params);
      if (method === 'eth_requestAccounts' && Array.isArray(result) && result.length > 0) {
        _selectedAddress = result[0];
        emit('accountsChanged', result);
        emit('connect', { chainId: APECHAIN_CHAIN_ID_HEX });
      }
      if (method === 'eth_accounts' && Array.isArray(result) && result.length > 0) {
        _selectedAddress = result[0];
      }
      return result;
    },
    writable: false,
    enumerable: true,
    configurable: false,
  },
  on: {
    value: (event: string, handler: (...args: any[]) => void) => {
      let set = listeners.get(event);
      if (!set) { set = new Set(); listeners.set(event, set); }
      set.add(handler);
    },
    writable: false,
    enumerable: true,
    configurable: false,
  },
  removeListener: {
    value: (event: string, handler: (...args: any[]) => void) => {
      listeners.get(event)?.delete(handler);
    },
    writable: false,
    enumerable: true,
    configurable: false,
  },
  connect: {
    value: () => send<{ address: string; chainId: string }>('connect'),
    writable: false,
    enumerable: true,
    configurable: false,
  },
  getAddress: {
    value: () => send<{ address: string; chainId: string; network: string }>('getAddress'),
    writable: false,
    enumerable: true,
    configurable: false,
  },
});
Object.freeze(provider);

// Best-effort: if an existing window.ethereum is already there (e.g. MetaMask),
// don't overwrite it — we still expose window.yacht and announce via EIP-6963.
Object.defineProperty(window, 'yacht', { value: provider, writable: false, configurable: false });
if (!(window as any).ethereum) {
  try {
    Object.defineProperty(window, 'ethereum', { value: provider, writable: false, configurable: false });
  } catch { /* another wallet locked it first — fine */ }
}

// EIP-6963: announce + respond to discovery events so dApps can show every
// installed wallet (Yacht, MetaMask, Rabby, etc.).
function announce() {
  window.dispatchEvent(
    new CustomEvent('eip6963:announceProvider', {
      detail: Object.freeze({ info: provider.info, provider }),
    }),
  );
}
announce();
window.addEventListener('eip6963:requestProvider', announce);

// Legacy event some dApps polled for.
window.dispatchEvent(new Event('ethereum#initialized'));
