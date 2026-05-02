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
const PBKDF2_ITERATIONS = 600_000; // v1 only — for decrypting legacy vaults
const ARGON2_MEMORY_KIB = 65_536; // 64 MiB
const ARGON2_ITERATIONS = 3;
const ARGON2_PARALLELISM = 1;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BITS = 256;
function toB64(bytes) {
    let bin = '';
    bytes.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin);
}
function fromB64(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
        out[i] = bin.charCodeAt(i);
    return out;
}
async function importAesKey(rawKey) {
    return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM', length: KEY_BITS }, false, ['encrypt', 'decrypt']);
}
// --- v2 (Argon2id) ----------------------------------------------------------
async function deriveKeyV2(password, salt) {
    const pwBytes = new TextEncoder().encode(password);
    // @noble/hashes argon2id is pure JS but takes ~700-1500ms with these params,
    // which is acceptable for an unlock flow.
    const raw = argon2id(pwBytes, salt, {
        t: ARGON2_ITERATIONS,
        m: ARGON2_MEMORY_KIB,
        p: ARGON2_PARALLELISM,
        dkLen: 32,
    });
    return await importAesKey(raw);
}
// --- v1 (PBKDF2) — legacy decrypt only --------------------------------------
async function deriveKeyV1(password, salt) {
    const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, baseKey, { name: 'AES-GCM', length: KEY_BITS }, false, ['encrypt', 'decrypt']);
}
export async function encrypt(plaintext, password) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const key = await deriveKeyV2(password, salt);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(plaintext));
    return { v: 2, salt: toB64(salt), iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}
export async function decrypt(blob, password) {
    const salt = fromB64(blob.salt);
    const iv = fromB64(blob.iv);
    const ct = fromB64(blob.ct);
    const v = blob.v ?? 1; // default to v1 if missing for safety
    const key = v === 2 ? await deriveKeyV2(password, salt) : await deriveKeyV1(password, salt);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct);
    return new TextDecoder().decode(pt);
}
// True if the blob uses the legacy KDF and should be re-encrypted on next save.
export function needsKdfUpgrade(blob) {
    return (blob.v ?? 1) < 2;
}
