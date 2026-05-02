// Vault: stores encrypted wallet secrets in chrome.storage.local.
// Plaintext key material lives only in the background service-worker memory while unlocked.
//
// Layout:
//   • mnemonic    — 12-word BIP-39 phrase for the HD wallet (optional if all accounts are imported).
//   • accounts[]  — each has its own privateKey. Accounts derived from the mnemonic
//                   know their derivationIndex; imported accounts have origin: 'privateKey'.

import { decrypt, encrypt, EncryptedBlob, needsKdfUpgrade } from './crypto';

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

export async function createVault(password: string, initial: VaultData): Promise<void> {
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

export async function unlockVault(password: string): Promise<VaultData> {
  const blob = await readBlob();
  if (!blob) throw new Error('No vault initialized');
  const json = await decrypt(blob, password);
  const data = JSON.parse(json) as VaultData;
  if (needsKdfUpgrade(blob)) {
    try { await rewriteVault(password, data); } catch { /* keep going on failure */ }
  }
  return data;
}

export async function rewriteVault(password: string, data: VaultData): Promise<void> {
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

export async function changePassword(oldPw: string, newPw: string): Promise<void> {
  const data = await unlockVault(oldPw);
  await rewriteVault(newPw, data);
}

export async function destroyVault(): Promise<void> {
  await chrome.storage.local.remove([VAULT_KEY, META_KEY]);
}
