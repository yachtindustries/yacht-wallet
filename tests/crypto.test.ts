import { describe, it, expect } from 'vitest';
import {
  encrypt,
  encryptWithKey,
  decrypt,
  unlockAndExtract,
  needsKdfUpgrade,
  fromB64,
  toB64,
} from '@/lib/crypto';

describe('crypto vault round-trip', () => {
  it('encrypts and decrypts plaintext under v2 (Argon2id)', async () => {
    const plaintext = JSON.stringify({ mnemonic: 'a b c', accounts: [] });
    const blob = await encrypt(plaintext, 'correct horse battery staple');
    expect(blob.v).toBe(2);
    expect(blob.salt).toBeTruthy();
    expect(blob.iv).toBeTruthy();
    expect(blob.ct).toBeTruthy();
    const back = await decrypt(blob, 'correct horse battery staple');
    expect(back).toBe(plaintext);
  });

  it('rejects decrypt with wrong password', async () => {
    const blob = await encrypt('secret payload', 'right-password');
    await expect(decrypt(blob, 'wrong-password')).rejects.toThrow();
  });

  it('produces different ciphertexts for the same plaintext (random IV + salt)', async () => {
    const a = await encrypt('hello', 'pw');
    const b = await encrypt('hello', 'pw');
    expect(a.ct).not.toBe(b.ct);
    expect(a.iv).not.toBe(b.iv);
    expect(a.salt).not.toBe(b.salt);
  });

  it('reuses salt + key via encryptWithKey for stable rewrites', async () => {
    const blob = await encrypt('v1', 'pw');
    const { keyBytes, salt } = await unlockAndExtract(blob, 'pw');
    const blob2 = await encryptWithKey('v2', keyBytes, salt);
    expect(blob2.salt).toBe(blob.salt);
    expect(blob2.iv).not.toBe(blob.iv);
    const back = await decrypt(blob2, 'pw');
    expect(back).toBe('v2');
  });

  it('needsKdfUpgrade flags v1 blobs and not v2', async () => {
    const blob = await encrypt('x', 'pw');
    expect(needsKdfUpgrade(blob)).toBe(false);
    expect(needsKdfUpgrade({ ...blob, v: 1 })).toBe(true);
  });

  it('toB64/fromB64 round-trip preserves bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const back = fromB64(toB64(bytes));
    expect(back).toEqual(bytes);
  });
});
