import { describe, it, expect } from 'vitest';
import {
  analyzePersonalSign,
  analyzeTxData,
  analyzeTypedData,
} from '@/lib/signing-detect';

const APECHAIN = 33139;

describe('analyzePersonalSign', () => {
  it('flags raw 32-byte hashes as eth_sign payloads', () => {
    const hash = '0x' + 'a'.repeat(64);
    const r = analyzePersonalSign(hash);
    expect(r.isRawHash).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/raw 32-byte hash/i);
  });

  it('does not flag short or non-hex messages', () => {
    expect(analyzePersonalSign('Hello world').isRawHash).toBe(false);
    expect(analyzePersonalSign('0xdeadbeef').isRawHash).toBe(false);
  });

  it('warns when SIWE Domain mismatches the request origin', () => {
    const msg =
      'evil-phish.example wants you to sign in with your Ethereum account:\n' +
      '0x0000000000000000000000000000000000000001\n\n' +
      'URI: https://evil-phish.example/login\n' +
      'Domain: evil-phish.example';
    const r = analyzePersonalSign(msg, 'https://opensea.io');
    expect(r.warnings.join(' ')).toMatch(/phish/i);
  });

  it('does not warn when SIWE Domain matches origin', () => {
    const msg =
      'opensea.io wants you to sign in with your Ethereum account:\n' +
      '0x0000000000000000000000000000000000000001\n\n' +
      'URI: https://opensea.io/login\n' +
      'Domain: opensea.io';
    const r = analyzePersonalSign(msg, 'https://opensea.io');
    expect(r.warnings.filter((w) => /phish|mismatch/i.test(w))).toHaveLength(0);
  });
});

describe('analyzeTxData', () => {
  it('labels empty data with value as Send APE', () => {
    const r = analyzeTxData('0x', 1n);
    expect(r.label).toBe('Send APE');
    expect(r.isHighRisk).toBe(false);
  });

  it('detects unlimited ERC-20 approve as high risk', () => {
    const max = 'f'.repeat(64);
    const data = '0x095ea7b3' + '00'.repeat(32) + max;
    const r = analyzeTxData(data, 0n);
    expect(r.label).toMatch(/UNLIMITED/);
    expect(r.isHighRisk).toBe(true);
    expect(r.isUnlimitedApproval).toBe(true);
  });

  it('detects bounded ERC-20 approve as low risk', () => {
    const data =
      '0x095ea7b3' +
      '000000000000000000000000abcdef0000000000000000000000000000000001' +
      '00000000000000000000000000000000000000000000000000000000000003e8'; // 1000
    const r = analyzeTxData(data, 0n);
    expect(r.label).toBe('ERC-20 approve');
    expect(r.isHighRisk).toBe(false);
  });

  it('detects setApprovalForAll(true) as high risk NFT drainer', () => {
    const data =
      '0xa22cb465' +
      '000000000000000000000000abcdef0000000000000000000000000000000001' +
      '0000000000000000000000000000000000000000000000000000000000000001';
    const r = analyzeTxData(data, 0n);
    expect(r.label).toMatch(/GRANT/);
    expect(r.isHighRisk).toBe(true);
  });

  it('detects setApprovalForAll(false) as a revoke (low risk)', () => {
    const data =
      '0xa22cb465' +
      '000000000000000000000000abcdef0000000000000000000000000000000001' +
      '0000000000000000000000000000000000000000000000000000000000000000';
    const r = analyzeTxData(data, 0n);
    expect(r.label).toMatch(/revoke/);
    expect(r.isHighRisk).toBe(false);
  });

  it('labels ERC-20 transfer', () => {
    const data = '0xa9059cbb' + '00'.repeat(64);
    expect(analyzeTxData(data, 0n).label).toBe('ERC-20 transfer');
  });
});

describe('analyzeTypedData', () => {
  const okDomain = { chainId: APECHAIN, name: 'Test', version: '1', verifyingContract: '0x0000000000000000000000000000000000000abc' };

  it('flags labelled EIP-2612 Permit as a drainer', () => {
    const r = analyzeTypedData({
      domain: okDomain,
      primaryType: 'Permit',
      types: { Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ]},
      message: { owner: '0x0000000000000000000000000000000000000001', spender: '0x0000000000000000000000000000000000000002', value: '1000', nonce: 0, deadline: 9999999999 },
    } as any);
    expect(r.isDrainerPattern).toBe(true);
    expect(r.drainerKind).toBe('permit2612');
  });

  it('detects struct-shaped Permit even when relabelled (Login)', () => {
    const r = analyzeTypedData({
      domain: okDomain,
      primaryType: 'Login',
      types: { Login: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ]},
      message: { owner: '0x0000000000000000000000000000000000000001', spender: '0x0000000000000000000000000000000000000002', value: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', nonce: 0, deadline: 9999999999 },
    } as any);
    expect(r.isDrainerPattern).toBe(true);
    expect(r.drainerKind).toBe('permit2612');
    expect(r.warnings.join(' ')).toMatch(/UNLIMITED/);
  });

  it('detects struct-shaped Seaport order even when relabelled', () => {
    const r = analyzeTypedData({
      domain: okDomain,
      primaryType: 'NotARealOrder',
      types: { NotARealOrder: [
        { name: 'offerer', type: 'address' },
        { name: 'offer', type: 'tuple[]' },
        { name: 'consideration', type: 'tuple[]' },
      ]},
      message: { offerer: '0x0000000000000000000000000000000000000001', offer: [], consideration: [] },
    } as any);
    expect(r.isDrainerPattern).toBe(true);
    expect(r.drainerKind).toBe('seaport');
  });

  it('warns on chainId mismatch (cross-chain replay)', () => {
    const r = analyzeTypedData({
      domain: { ...okDomain, chainId: 1 },
      primaryType: 'NoOp',
      types: { NoOp: [{ name: 'x', type: 'uint256' }] },
      message: { x: 0 },
    } as any);
    expect(r.warnings.join(' ')).toMatch(/cross-chain replay/i);
  });

  it('warns on missing chainId', () => {
    const r = analyzeTypedData({
      domain: { name: 'X', version: '1' },
      primaryType: 'NoOp',
      types: { NoOp: [{ name: 'x', type: 'uint256' }] },
      message: { x: 0 },
    } as any);
    expect(r.warnings.join(' ')).toMatch(/Missing domain.chainId/i);
  });

  it('does not flag a benign typed data payload', () => {
    const r = analyzeTypedData({
      domain: okDomain,
      primaryType: 'Greeting',
      types: { Greeting: [{ name: 'text', type: 'string' }] },
      message: { text: 'hello' },
    } as any);
    expect(r.isDrainerPattern).toBe(false);
  });
});
