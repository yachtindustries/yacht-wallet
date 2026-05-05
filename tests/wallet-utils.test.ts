import { describe, it, expect } from 'vitest';
import {
  generateMnemonic,
  isValidMnemonic,
  deriveAccount,
  walletFromPrivateKey,
  isValidEvmAddress,
  shortAddress,
  checksumAddress,
} from '@/lib/wallet-utils';

const FIXED_MNEMONIC =
  'test test test test test test test test test test test junk';

describe('wallet utils', () => {
  it('generateMnemonic returns a 12-word phrase', () => {
    const phrase = generateMnemonic();
    expect(phrase.split(/\s+/).length).toBe(12);
    expect(isValidMnemonic(phrase)).toBe(true);
  });

  it('isValidMnemonic accepts valid phrases and rejects garbage', () => {
    expect(isValidMnemonic(FIXED_MNEMONIC)).toBe(true);
    expect(isValidMnemonic('not a real bip39 phrase definitely')).toBe(false);
    expect(isValidMnemonic('')).toBe(false);
  });

  it('deriveAccount is deterministic for the same mnemonic + index', () => {
    const a = deriveAccount(FIXED_MNEMONIC, 0);
    const b = deriveAccount(FIXED_MNEMONIC, 0);
    expect(a.address).toBe(b.address);
    expect(a.privateKey).toBe(b.privateKey);
    expect(a.derivationPath).toBe("m/44'/60'/0'/0/0");
  });

  it('deriveAccount produces distinct addresses across indexes', () => {
    const a0 = deriveAccount(FIXED_MNEMONIC, 0);
    const a1 = deriveAccount(FIXED_MNEMONIC, 1);
    expect(a0.address).not.toBe(a1.address);
  });

  it('walletFromPrivateKey produces a checksummed address', () => {
    const a = deriveAccount(FIXED_MNEMONIC, 0);
    const w = walletFromPrivateKey(a.privateKey);
    expect(w.address).toBe(a.address);
    expect(w.privateKey.toLowerCase()).toBe(a.privateKey.toLowerCase());
  });

  it('isValidEvmAddress accepts checksummed and lowercase 40-hex', () => {
    const checksummed = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
    expect(isValidEvmAddress(checksummed)).toBe(true);
    expect(isValidEvmAddress(checksummed.toLowerCase())).toBe(true);
  });

  it('isValidEvmAddress rejects garbage', () => {
    expect(isValidEvmAddress('')).toBe(false);
    expect(isValidEvmAddress('0x')).toBe(false);
    expect(isValidEvmAddress('0xnothex0xnothex0xnothex0xnothex0xnothex42')).toBe(false);
    expect(isValidEvmAddress('not-an-address')).toBe(false);
  });

  it('checksumAddress upgrades lowercase to checksummed', () => {
    const lc = '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed';
    expect(checksumAddress(lc)).toBe('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');
  });

  it('shortAddress truncates long addresses and leaves short ones alone', () => {
    expect(shortAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')).toBe('0x5aAe…eAed');
    expect(shortAddress('short')).toBe('short');
  });
});
