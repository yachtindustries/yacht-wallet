// Capacitor-side polyfill for the slice of `chrome.*` the popup uses on
// desktop. Importing this module installs the shim if YACHT_PLATFORM is
// 'mobile'; on extension builds it's a no-op.
//
// Surface implemented:
//   chrome.storage.local         → @capacitor/preferences (persistent KV)
//   chrome.storage.session       → in-memory Map (cleared on app restart)
//   chrome.storage.onChanged     → simple event emitter, fires for both areas
//   chrome.runtime.getURL(p)     → root-relative '/<p without leading public/>'
//   chrome.runtime.id            → 'yacht-mobile'
//   chrome.runtime.lastError     → always undefined
//   chrome.runtime.sendMessage   → routes to in-process rpcHandle (set later)
//   chrome.sidePanel.open        → no-op (mobile has no side panel)
//   chrome.tabs.query            → no-op stub returning []
//
// Anything not on this list (chrome.alarms, chrome.windows, chrome.action) is
// only referenced from src/background/* or src/content/* and those entry
// points are excluded from the mobile build.

import { Preferences } from '@capacitor/preferences';
import { registerPlugin } from '@capacitor/core';

// Bridge to the custom SecureStoragePlugin (android/app/.../SecureStoragePlugin.java).
// The plugin wraps arbitrary text with an AES-256-GCM key that lives inside
// the Android Keystore (StrongBox if available, TEE otherwise) — so the
// wrapped blob is bound to this app on this device and cannot be decrypted
// off-device even with the user's password. iOS implementation is a future
// item; on iOS this plugin call will reject and we fall back to plaintext
// preferences (the inner Argon2id+AES-GCM still protects the vault).
interface SecureStoragePlugin {
  encrypt(opts: { data: string }): Promise<{ data: string }>;
  decrypt(opts: { data: string }): Promise<{ data: string }>;
  clear(): Promise<void>;
  status(): Promise<{ present: boolean }>;
}
const SecureStorage = registerPlugin<SecureStoragePlugin>('SecureStorage');

// Magic prefix marking a Keystore-wrapped value. On read we strip it and
// hand the inner ciphertext to SecureStorage.decrypt; on write we add it
// after wrapping. Legacy values (written before this plugin existed) are
// stored as plain JSON without the prefix and migrate transparently on
// the next save.
const KS_MAGIC = '__KS:';

// Set of storage keys whose value is sensitive enough to deserve the
// hardware-backed wrap. Caches (prices, NFT metadata, etc.) are NOT
// wrapped — wrapping every preferences write would slow down every cache
// touch for no security gain.
const SENSITIVE_KEYS = new Set<string>([
  'yacht.vault.v1',       // encrypted seed + private keys
  'yacht.meta.v1',        // public account list (mildly sensitive)
  'yacht.unlockGate.v1',  // failed-unlock backoff state
]);

function isSensitive(key: string): boolean {
  return SENSITIVE_KEYS.has(key) || key.startsWith('yacht.vault.');
}

async function wrapIfSensitive(key: string, jsonValue: string): Promise<string> {
  if (!isSensitive(key)) return jsonValue;
  try {
    const { data } = await SecureStorage.encrypt({ data: jsonValue });
    return KS_MAGIC + data;
  } catch {
    // SecureStorage missing (iOS today, or plugin failed). Fall back to
    // unwrapped storage — the JSON content is still encrypted by the
    // vault layer's own Argon2id+AES-GCM.
    return jsonValue;
  }
}

async function unwrapIfWrapped(stored: string): Promise<string> {
  if (!stored.startsWith(KS_MAGIC)) return stored;
  const { data } = await SecureStorage.decrypt({ data: stored.slice(KS_MAGIC.length) });
  return data;
}

declare global {
  // Keep the rpcHandle injection slot off `window` to avoid name collisions.
  // eslint-disable-next-line no-var
  var __yachtMobileRpc:
    | ((req: unknown, sender: undefined) => Promise<unknown>)
    | undefined;
}

type Listener = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void;

function isMobile(): boolean {
  return (import.meta as any).env?.YACHT_PLATFORM === 'mobile';
}

function installShim() {
  if (typeof globalThis === 'undefined') return;
  // If a real chrome.storage already exists (extension build, devtools, etc.)
  // don't clobber it.
  const existing = (globalThis as any).chrome;
  if (existing && existing.storage && existing.runtime?.sendMessage) return;

  const sessionMap = new Map<string, unknown>();
  const listeners = new Set<Listener>();

  function fire(area: 'local' | 'session', changes: Record<string, { oldValue?: unknown; newValue?: unknown }>) {
    for (const l of listeners) {
      try { l(changes, area); } catch { /* ignore listener errors */ }
    }
  }

  async function localGet(query?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    let keys: string[];
    if (query == null) {
      const { keys: all } = await Preferences.keys();
      keys = all;
    } else if (typeof query === 'string') {
      keys = [query];
    } else if (Array.isArray(query)) {
      keys = query;
    } else {
      keys = Object.keys(query);
      // Seed defaults for keys not present.
      for (const k of keys) out[k] = (query as Record<string, unknown>)[k];
    }
    for (const k of keys) {
      const { value } = await Preferences.get({ key: k });
      if (value != null) {
        try {
          const unwrapped = await unwrapIfWrapped(value);
          out[k] = JSON.parse(unwrapped);
        } catch {
          // Either Keystore unwrap failed or value was non-JSON. Fall back
          // to the raw stored string so the caller at least sees something.
          out[k] = value;
        }
      } else if (!(k in out)) {
        // chrome.storage.local.get omits keys that don't exist (unless a
        // default was supplied via the object form).
      }
    }
    return out;
  }

  async function localSet(items: Record<string, unknown>): Promise<void> {
    const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
    for (const [k, v] of Object.entries(items)) {
      const { value: prev } = await Preferences.get({ key: k });
      let oldValue: unknown = undefined;
      if (prev != null) {
        try {
          const prevUnwrapped = await unwrapIfWrapped(prev);
          oldValue = JSON.parse(prevUnwrapped);
        } catch {
          oldValue = prev;
        }
      }
      const wrapped = await wrapIfSensitive(k, JSON.stringify(v));
      await Preferences.set({ key: k, value: wrapped });
      changes[k] = { oldValue, newValue: v };
    }
    fire('local', changes);
  }

  async function localRemove(keyOrKeys: string | string[]): Promise<void> {
    const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
    const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
    for (const k of keys) {
      const { value: prev } = await Preferences.get({ key: k });
      if (prev != null) {
        try {
          const prevUnwrapped = await unwrapIfWrapped(prev);
          changes[k] = { oldValue: JSON.parse(prevUnwrapped) };
        } catch {
          changes[k] = { oldValue: prev };
        }
      }
      await Preferences.remove({ key: k });
    }
    // If the user destroyed the vault we also wipe the Keystore master
    // wrap key so a fresh install gets a fresh key — no chance of an old
    // wrap leaking.
    if (keys.includes('yacht.vault.v1')) {
      try { await SecureStorage.clear(); } catch { /* plugin missing — ignore */ }
    }
    fire('local', changes);
  }

  async function sessionGet(query?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    let keys: string[];
    if (query == null) keys = [...sessionMap.keys()];
    else if (typeof query === 'string') keys = [query];
    else if (Array.isArray(query)) keys = query;
    else {
      keys = Object.keys(query);
      for (const k of keys) out[k] = (query as Record<string, unknown>)[k];
    }
    for (const k of keys) {
      if (sessionMap.has(k)) out[k] = sessionMap.get(k);
    }
    return out;
  }

  async function sessionSet(items: Record<string, unknown>): Promise<void> {
    const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
    for (const [k, v] of Object.entries(items)) {
      const oldValue = sessionMap.get(k);
      sessionMap.set(k, v);
      changes[k] = { oldValue, newValue: v };
    }
    fire('session', changes);
  }

  async function sessionRemove(keyOrKeys: string | string[]): Promise<void> {
    const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
    const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
    for (const k of keys) {
      if (sessionMap.has(k)) changes[k] = { oldValue: sessionMap.get(k) };
      sessionMap.delete(k);
    }
    fire('session', changes);
  }

  function getURL(p: string): string {
    // Strip a leading 'public/' since Vite serves public/ contents at root.
    let stripped = p.replace(/^\/?public\//, '');
    if (!stripped.startsWith('/')) stripped = '/' + stripped;
    return stripped;
  }

  // chrome.runtime.sendMessage routes to the in-process RPC handler that
  // src/lib/messaging.ts installs at boot. Returns a Promise (mirrors the
  // promise overload Chrome supports in MV3).
  function sendMessage(message: unknown, callback?: (reply: unknown) => void): Promise<unknown> {
    const handler = globalThis.__yachtMobileRpc;
    const p = handler
      ? handler(message, undefined)
      : Promise.reject(new Error('Mobile RPC handler not installed'));
    if (callback) p.then(callback, () => callback(undefined));
    return p;
  }

  const shim = {
    storage: {
      local: { get: localGet, set: localSet, remove: localRemove },
      session: { get: sessionGet, set: sessionSet, remove: sessionRemove },
      onChanged: {
        addListener: (l: Listener) => { listeners.add(l); },
        removeListener: (l: Listener) => { listeners.delete(l); },
      },
    },
    runtime: {
      id: 'yacht-mobile',
      lastError: undefined as undefined | { message: string },
      getURL,
      sendMessage,
      onMessage: { addListener: () => {}, removeListener: () => {} },
      onInstalled: { addListener: () => {} },
      getManifest: () => ({ version: '0.0.0' }),
    },
    sidePanel: {
      open: async () => {},
      setPanelBehavior: async () => {},
    },
    tabs: {
      query: async () => [],
    },
    action: {
      setPopup: async () => {},
    },
    alarms: (() => {
      // chrome.alarms backed by setTimeout. The background calls
      // chrome.alarms.create('yacht.autolock', { delayInMinutes }) on each
      // unlock and listens for it to lock the vault. On mobile we run that
      // same scheduler in the popup's JS context — the timer effectively
      // pauses while the OS suspends the WebView, which is acceptable
      // because a suspended app can't surface the unlocked vault anyway.
      const timers = new Map<string, ReturnType<typeof setTimeout>>();
      const alarmListeners = new Set<(a: { name: string }) => void>();
      return {
        create: async (name: string, opts: { delayInMinutes?: number; periodInMinutes?: number }) => {
          const prev = timers.get(name);
          if (prev) clearTimeout(prev);
          const delayMs = Math.max(0, (opts.delayInMinutes ?? 0) * 60_000);
          const t = setTimeout(() => {
            timers.delete(name);
            for (const l of alarmListeners) {
              try { l({ name }); } catch { /* ignore */ }
            }
          }, delayMs);
          timers.set(name, t);
        },
        clear: async (name: string) => {
          const t = timers.get(name);
          if (t) { clearTimeout(t); timers.delete(name); return true; }
          return false;
        },
        onAlarm: {
          addListener: (l: (a: { name: string }) => void) => { alarmListeners.add(l); },
          removeListener: (l: (a: { name: string }) => void) => { alarmListeners.delete(l); },
        },
      };
    })(),
    windows: {
      create: async () => undefined,
      get: async () => undefined,
      getLastFocused: async () => undefined,
      update: async () => undefined,
      onRemoved: { addListener: () => {} },
    },
  };

  (globalThis as any).chrome = shim;
}

if (isMobile()) installShim();

export {};
