// Vault: stores encrypted wallet secrets in chrome.storage.local.
// Plaintext key material lives only in the background service-worker memory while unlocked.
//
// Layout:
//   • mnemonic    — 12-word BIP-39 phrase for the HD wallet (optional if all accounts are imported).
//   • accounts[]  — each has its own privateKey. Accounts derived from the mnemonic
//                   know their derivationIndex; imported accounts have origin: 'privateKey'.
import { decrypt, encrypt, needsKdfUpgrade } from './crypto';
const VAULT_KEY = 'yacht.vault.v1';
const META_KEY = 'yacht.meta.v1';
export async function readMeta() {
    const r = await chrome.storage.local.get(META_KEY);
    return (r[META_KEY] ?? {
        initialized: false,
        publicAccounts: [],
        activeAccountId: null,
        autoLockMinutes: 15,
    });
}
export async function writeMeta(meta) {
    await chrome.storage.local.set({ [META_KEY]: meta });
}
async function readBlob() {
    const r = await chrome.storage.local.get(VAULT_KEY);
    return r[VAULT_KEY] ?? null;
}
async function writeBlob(blob) {
    await chrome.storage.local.set({ [VAULT_KEY]: blob });
}
export async function isInitialized() {
    return (await readBlob()) != null;
}
export async function createVault(password, initial) {
    const blob = await encrypt(JSON.stringify(initial), password);
    await writeBlob(blob);
    await writeMeta({
        initialized: true,
        publicAccounts: initial.accounts.map((a) => ({
            id: a.id,
            name: a.name,
            address: a.address,
            hidden: a.hidden,
        })),
        activeAccountId: initial.activeAccountId,
        autoLockMinutes: 15,
    });
}
export async function unlockVault(password) {
    const blob = await readBlob();
    if (!blob)
        throw new Error('No vault initialized');
    const json = await decrypt(blob, password);
    const data = JSON.parse(json);
    if (needsKdfUpgrade(blob)) {
        try {
            await rewriteVault(password, data);
        }
        catch { /* keep going on failure */ }
    }
    return data;
}
export async function rewriteVault(password, data) {
    const blob = await encrypt(JSON.stringify(data), password);
    await writeBlob(blob);
    const meta = await readMeta();
    meta.publicAccounts = data.accounts.map((a) => ({
        id: a.id,
        name: a.name,
        address: a.address,
        hidden: a.hidden,
    }));
    meta.activeAccountId = data.activeAccountId;
    await writeMeta(meta);
}
export async function changePassword(oldPw, newPw) {
    const data = await unlockVault(oldPw);
    await rewriteVault(newPw, data);
}
export async function destroyVault() {
    await chrome.storage.local.remove([VAULT_KEY, META_KEY]);
}
