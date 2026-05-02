// In-memory state for the background service worker.
// Holds the unlocked vault and pending dApp requests.

import type { VaultData } from '@/lib/vault';
import type { PendingRequest } from '@/lib/messaging';

interface BgState {
  unlocked: VaultData | null;
  unlockedAt: number;
  pending: Map<string, PendingRequest & { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
  approvedOrigins: Set<string>;
}

export const state: BgState = {
  unlocked: null,
  unlockedAt: 0,
  pending: new Map(),
  approvedOrigins: new Set(),
};

const APPROVED_KEY = 'yacht.origins.v1';

export async function loadApprovedOrigins(): Promise<void> {
  const r = await chrome.storage.local.get(APPROVED_KEY);
  const list: string[] = r[APPROVED_KEY] ?? [];
  state.approvedOrigins = new Set(list);
}

export async function persistApprovedOrigins(): Promise<void> {
  await chrome.storage.local.set({ [APPROVED_KEY]: [...state.approvedOrigins] });
}

export function lock(): void {
  // Best-effort wipe of in-memory key material before dropping the reference.
  // V8 strings are immutable so we can't truly zero them, but this overwrites
  // the *fields* on the object so any lingering reference (a closure, a
  // submission queue task) sees scrubbed values rather than live keys.
  if (state.unlocked) {
    const data = state.unlocked;
    if (data.mnemonic) data.mnemonic = '0'.repeat(data.mnemonic.length);
    if (Array.isArray(data.accounts)) {
      for (const a of data.accounts) {
        if (a.privateKey) a.privateKey = '0x' + '0'.repeat(64);
      }
    }
  }
  state.unlocked = null;
  state.unlockedAt = 0;
}

export function isUnlocked(): boolean {
  return state.unlocked != null;
}

export function getActiveAccount() {
  if (!state.unlocked) return null;
  const id = state.unlocked.activeAccountId;
  return state.unlocked.accounts.find((a) => a.id === id) ?? state.unlocked.accounts[0] ?? null;
}
