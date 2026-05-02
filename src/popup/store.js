import { create } from 'zustand';
import { rpc } from '@/lib/messaging';
export const useApp = create((set, get) => ({
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
