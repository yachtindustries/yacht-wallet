// Vault primitives. Two formats are supported:
//   v1: PBKDF2-SHA256 (600k) + AES-256-GCM   ← legacy, only decryptable
//   v2: Argon2id (m=64MB, t=3, p=1)  + AES-256-GCM   ← current, encrypt + decrypt
//
// New vaults are always v2. v1 vaults still decrypt cleanly so existing users
// can unlock and the caller (vault.ts) can transparently re-encrypt to v2.
//
// Argon2id is memory-hard; a $1k GPU's PBKDF2-SHA256 attack rate of ~2k
// guesses/sec drops to ~30 guesses/sec at 64 MB / 3 iters. This matches what
// MetaMask (scrypt) and Phantom (Argon2id) ship today.

import { argon2id } from '@noble/hashes/argon2';

const PBKDF2_ITERATIONS = 600_000;       // v1 only — for decrypting legacy vaults
const ARGON2_MEMORY_KIB = 65_536;        // 64 MiB
const ARGON2_ITERATIONS = 3;
const ARGON2_PARALLELISM = 1;

const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BITS = 256;

export function toB64(bytes: Uint8Array): string {
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

export function fromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importAesKey(rawKey: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    rawKey as BufferSource,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

// --- v2 (Argon2id) ----------------------------------------------------------
function deriveKeyBytesV2(password: string, salt: Uint8Array): Uint8Array {
  const pwBytes = new TextEncoder().encode(password);
  // @noble/hashes argon2id is pure JS but takes ~700-1500ms with these params,
  // which is acceptable for an unlock flow.
  return argon2id(pwBytes, salt, {
    t: ARGON2_ITERATIONS,
    m: ARGON2_MEMORY_KIB,
    p: ARGON2_PARALLELISM,
    dkLen: 32,
  });
}

// --- v1 (PBKDF2) — legacy decrypt only --------------------------------------
async function deriveKeyBytesV1(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password) as BufferSource,
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

export interface EncryptedBlob {
  v: 1 | 2;
  salt: string;
  iv: string;
  ct: string;
}

/** Encrypt a fresh plaintext under a new salt derived from the password. */
export async function encrypt(plaintext: string, password: string): Promise<EncryptedBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const keyBytes = deriveKeyBytesV2(password, salt);
  return await encryptWithKey(plaintext, keyBytes, salt);
}

/**
 * Re-encrypt under an existing key + salt (no KDF).
 *
 * This is the workhorse for `persistUnlocked`: after `unlockAndExtract`, we
 * keep the AES key bytes in memory and use them to re-encrypt the vault on
 * every account-list change. The salt is reused (so the same password keeps
 * decrypting future blobs); only the IV changes.
 */
export async function encryptWithKey(
  plaintext: string,
  keyBytes: Uint8Array,
  salt: Uint8Array,
): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await importAesKey(keyBytes);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext) as BufferSource,
  );
  return { v: 2, salt: toB64(salt), iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

/** Decrypt and return only the plaintext. Use this when you don't need the key. */
export async function decrypt(blob: EncryptedBlob, password: string): Promise<string> {
  const { plaintext } = await unlockAndExtract(blob, password);
  return plaintext;
}

/**
 * Decrypt and ALSO surface the derived AES key + salt to the caller.
 * The background uses this so it can re-encrypt the vault later without
 * keeping the password in memory or in chrome.storage.session.
 */
export async function unlockAndExtract(
  blob: EncryptedBlob,
  password: string,
): Promise<{ plaintext: string; keyBytes: Uint8Array; salt: Uint8Array }> {
  const salt = fromB64(blob.salt);
  const iv = fromB64(blob.iv);
  const ct = fromB64(blob.ct);
  const v = blob.v ?? 1; // default to v1 if missing for safety
  const keyBytes = v === 2
    ? deriveKeyBytesV2(password, salt)
    : await deriveKeyBytesV1(password, salt);
  const key = await importAesKey(keyBytes);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ct as BufferSource,
  );
  return { plaintext: new TextDecoder().decode(pt), keyBytes, salt };
}

// True if the blob uses the legacy KDF and should be re-encrypted on next save.
export function needsKdfUpgrade(blob: EncryptedBlob): boolean {
  return (blob.v ?? 1) < 2;
}
