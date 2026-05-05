import { describe, it, expect } from 'vitest';
import { validateDappRpcParams, isSafePassthroughMethod } from '@/lib/evm';

describe('isSafePassthroughMethod', () => {
  it('whitelists read-only methods', () => {
    expect(isSafePassthroughMethod('eth_call')).toBe(true);
    expect(isSafePassthroughMethod('eth_getLogs')).toBe(true);
    expect(isSafePassthroughMethod('eth_blockNumber')).toBe(true);
  });

  it('rejects state-mutating methods', () => {
    expect(isSafePassthroughMethod('eth_sendTransaction')).toBe(false);
    expect(isSafePassthroughMethod('personal_sign')).toBe(false);
    expect(isSafePassthroughMethod('eth_signTypedData_v4')).toBe(false);
  });

  it('does NOT include stateful filter methods (cross-origin filter-ID leak risk)', () => {
    expect(isSafePassthroughMethod('eth_newFilter')).toBe(false);
    expect(isSafePassthroughMethod('eth_newBlockFilter')).toBe(false);
    expect(isSafePassthroughMethod('eth_newPendingTransactionFilter')).toBe(false);
    expect(isSafePassthroughMethod('eth_uninstallFilter')).toBe(false);
    expect(isSafePassthroughMethod('eth_getFilterChanges')).toBe(false);
    expect(isSafePassthroughMethod('eth_getFilterLogs')).toBe(false);
  });
});

describe('validateDappRpcParams (eth_getLogs range cap)', () => {
  it('accepts a bounded numeric range under the cap', async () => {
    await expect(
      validateDappRpcParams('eth_getLogs', [{ fromBlock: '0x100', toBlock: '0x200' }]),
    ).resolves.toBeUndefined();
  });

  it('accepts a single-block lookup via blockHash', async () => {
    await expect(
      validateDappRpcParams('eth_getLogs', [{ blockHash: '0x' + '00'.repeat(32) }]),
    ).resolves.toBeUndefined();
  });

  it('rejects fromBlock=earliest, toBlock=latest (full-history scan)', async () => {
    await expect(
      validateDappRpcParams('eth_getLogs', [{ fromBlock: 'earliest', toBlock: 'latest' }]),
    ).rejects.toThrow(/range too large|exceeds cap/);
  });

  it('rejects fromBlock=0x0 with no toBlock (also full-history)', async () => {
    await expect(
      validateDappRpcParams('eth_getLogs', [{ fromBlock: '0x0' }]),
    ).rejects.toThrow(/range too large|exceeds cap/);
  });

  it('rejects ranges over 10 000 blocks', async () => {
    await expect(
      validateDappRpcParams('eth_getLogs', [{ fromBlock: '0x100', toBlock: '0x' + (0x100 + 10_001).toString(16) }]),
    ).rejects.toThrow(/exceeds cap/);
  });

  it('passes through when params are missing entirely', async () => {
    await expect(validateDappRpcParams('eth_getLogs', [])).resolves.toBeUndefined();
  });
});

describe('validateDappRpcParams (eth_call calldata cap)', () => {
  it('accepts small calldata', async () => {
    await expect(
      validateDappRpcParams('eth_call', [{ to: '0x' + '00'.repeat(20), data: '0x' + '00'.repeat(64) }]),
    ).resolves.toBeUndefined();
  });

  it('rejects calldata over 256 KB', async () => {
    const huge = '0x' + '00'.repeat(256 * 1024 + 1);
    await expect(
      validateDappRpcParams('eth_call', [{ to: '0x' + '00'.repeat(20), data: huge }]),
    ).rejects.toThrow(/calldata exceeds cap/);
  });
});
