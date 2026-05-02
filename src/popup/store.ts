import { create } from 'zustand';
import type { Settings } from '@/lib/networks';
import type { VaultMeta } from '@/lib/vault';
import { rpc } from '@/lib/messaging';

interface AppState {
  initialized: boolean;
  unlocked: boolean;
  meta: VaultMeta | null;
  settings: Settings | null;
  showBackupNotice: boolean;
  refreshStatus: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  setBackupNotice: (v: boolean) => void;
  lock: () => Promise<void>;
}

export const useApp = create<AppState>((set, get) => ({
  initialized: false,
  unlocked: false,
  meta: null,
  settings: null,
  showBackupNotice: false,
  refreshStatus: async () => {
    const r = await rpc({ type: 'vault.status' });
    set({ initialized: r.initialized, unlocked: r.unlocked, meta: r.meta });
  },
  refreshSettings: async () => {
    const s = await rpc({ type: 'settings.get' });
    set({ settings: s });
  },
  setBackupNotice: (v) => set({ showBackupNotice: v }),
  lock: async () => {
    await rpc({ type: 'vault.lock' });
    set({ unlocked: false });
    await get().refreshStatus();
  },
}));
