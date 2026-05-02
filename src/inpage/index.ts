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

function send<T>(method: string, params?: unknown): Promise<T> {
  const id = randomId();
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
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

const provider: YachtProvider = {
  isYacht: true,
  isMetaMask: false,
  chainId: APECHAIN_CHAIN_ID_HEX,
  selectedAddress: null,
  info: {
    name: 'Yacht',
    uuid: '8a4f4bbf-3a7b-4d6e-9e57-8f71e4a8f1c2',
    icon: 'data:image/svg+xml;base64,',
    rdns: 'app.yacht',
  },
  request: async ({ method, params }) => {
    const result = await send<any>(method, params);
    if (method === 'eth_requestAccounts' && Array.isArray(result) && result.length > 0) {
      provider.selectedAddress = result[0];
      emit('accountsChanged', result);
      emit('connect', { chainId: APECHAIN_CHAIN_ID_HEX });
    }
    if (method === 'eth_accounts' && Array.isArray(result) && result.length > 0) {
      provider.selectedAddress = result[0];
    }
    return result;
  },
  on: (event, handler) => {
    let set = listeners.get(event);
    if (!set) { set = new Set(); listeners.set(event, set); }
    set.add(handler);
  },
  removeListener: (event, handler) => {
    listeners.get(event)?.delete(handler);
  },
  connect: () => send<{ address: string; chainId: string }>('connect'),
  getAddress: () => send<{ address: string; chainId: string; network: string }>('getAddress'),
};

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
