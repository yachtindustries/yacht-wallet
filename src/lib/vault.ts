// Vault: stores encrypted wallet secrets in chrome.storage.local.
// Plaintext key material lives only in the background service-worker memory while unlocked.
//
// Layout:
//   • mnemonic    — 12-word BIP-39 phrase for the HD wallet (optional if all accounts are imported).
//   • accounts[]  — each has its own privateKey. Accounts derived from the mnemonic
//                   know their derivationIndex; imported accounts have origin: 'privateKey'.

import {
  encrypt,
  encryptWithKey,
  EncryptedBlob,
  needsKdfUpgrade,
  unlockAndExtract,
} from './crypto';

const VAULT_KEY = 'yacht.vault.v1';
const META_KEY = 'yacht.meta.v1';

export type AccountOrigin = 'mnemonic' | 'privateKey';

export interface VaultAccount {
  id: string;
  name: string;
  address: string;        // 0x-checksummed
  privateKey: string;     // 0x-prefixed
  origin: AccountOrigin;
  derivationIndex?: number;
  hidden?: boolean;
}

export interface VaultData {
  mnemonic: string | null;            // null if every account was imported
  nextDerivationIndex: number;        // next free m/44'/60'/0'/0/i index
  accounts: VaultAccount[];
  activeAccountId: string | null;
}

export interface VaultMeta {
  initialized: boolean;
  publicAccounts: { id: string; name: string; address: string; hidden?: boolean }[];
  activeAccountId: string | null;
  autoLockMinutes: number;
}

/**
 * Unlock material kept in memory while the wallet is unlocked. We persist the
 * AES key bytes (not the password) so the SW can re-encrypt the vault after
 * MV3 service-worker restarts without holding the user's master credential
 * any longer than necessary.
 */
export interface UnlockMaterial {
  data: VaultData;
  keyBytes: Uint8Array;
  salt: Uint8Array;
}

export async function readMeta(): Promise<VaultMeta> {
  const r = await chrome.storage.local.get(META_KEY);
  return (
    r[META_KEY] ?? {
      initialized: false,
      publicAccounts: [],
      activeAccountId: null,
      autoLockMinutes: 15,
    }
  );
}

export async function writeMeta(meta: VaultMeta): Promise<void> {
  await chrome.storage.local.set({ [META_KEY]: meta });
}

async function readBlob(): Promise<EncryptedBlob | null> {
  const r = await chrome.storage.local.get(VAULT_KEY);
  return r[VAULT_KEY] ?? null;
}

async function writeBlob(blob: EncryptedBlob): Promise<void> {
  await chrome.storage.local.set({ [VAULT_KEY]: blob });
}

export async function isInitialized(): Promise<boolean> {
  return (await readBlob()) != null;
}

export async function createVault(password: string, initial: VaultData): Promise<UnlockMaterial> {
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
  // Read back the salt + key from the freshly-written blob so the in-memory
  // material matches what's on disk byte-for-byte.
  const extracted = await unlockAndExtract(blob, password);
  return { data: initial, keyBytes: extracted.keyBytes, salt: extracted.salt };
}

export async function unlockVault(password: string): Promise<UnlockMaterial> {
  const blob = await readBlob();
  if (!blob) throw new Error('No vault initialized');
  const { plaintext, keyBytes, salt } = await unlockAndExtract(blob, password);
  const data = JSON.parse(plaintext) as VaultData;
  // Auto-upgrade legacy v1 vaults; on success this re-derives a fresh v2 key.
  if (needsKdfUpgrade(blob)) {
    try {
      await rewriteVaultWithPassword(password, data);
      const fresh = await readBlob();
      if (fresh) {
        const reExt = await unlockAndExtract(fresh, password);
        return { data, keyBytes: reExt.keyBytes, salt: reExt.salt };
      }
    } catch { /* keep going on failure */ }
  }
  return { data, keyBytes, salt };
}

/**
 * Re-encrypt the vault using the current in-memory AES key + salt (no
 * password, no KDF round). Used after every account-list mutation.
 */
export async function rewriteVaultWithKey(
  keyBytes: Uint8Array,
  salt: Uint8Array,
  data: VaultData,
): Promise<void> {
  const blob = await encryptWithKey(JSON.stringify(data), keyBytes, salt);
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

/**
 * Re-encrypt the vault under a (possibly new) password. Used by
 * vault.changePassword and the v1→v2 KDF upgrade path. Triggers a fresh KDF.
 */
export async function rewriteVaultWithPassword(
  password: string,
  data: VaultData,
): Promise<void> {
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

export async function changePassword(oldPw: string, newPw: string): Promise<UnlockMaterial> {
  const { data } = await unlockVault(oldPw);
  await rewriteVaultWithPassword(newPw, data);
  // Surface fresh material so the caller can swap its in-memory copy.
  const fresh = await readBlob();
  if (!fresh) throw new Error('Vault disappeared mid-rewrite');
  const ext = await unlockAndExtract(fresh, newPw);
  return { data, keyBytes: ext.keyBytes, salt: ext.salt };
}

export async function destroyVault(): Promise<void> {
  await chrome.storage.local.remove([VAULT_KEY, META_KEY]);
}
