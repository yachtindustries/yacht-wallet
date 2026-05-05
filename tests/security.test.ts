import { describe, it, expect } from 'vitest';
import {
  hostFromOrigin,
  looksHomograph,
  assessTxRisk,
  passwordStrength,
  randomId,
} from '@/lib/security';

describe('security helpers', () => {
  describe('hostFromOrigin', () => {
    it('extracts host from a normal URL', () => {
      expect(hostFromOrigin('https://opensea.io')).toBe('opensea.io');
      expect(hostFromOrigin('https://app.camelot.exchange:443')).toBe('app.camelot.exchange');
    });
    it('returns the input unchanged on garbage and empty', () => {
      expect(hostFromOrigin('')).toBe('');
      expect(hostFromOrigin(undefined)).toBe('');
      expect(hostFromOrigin('not-a-url')).toBe('not-a-url');
    });
  });

  describe('looksHomograph', () => {
    it('flags punycode domains', () => {
      expect(looksHomograph('xn--80ak6aa92e.com')).toBe(true);
    });
    it('flags non-ASCII characters', () => {
      expect(looksHomograph('аpple.com')).toBe(true); // Cyrillic 'a'
    });
    it('passes plain ASCII domains', () => {
      expect(looksHomograph('apple.com')).toBe(false);
      expect(looksHomograph('app.camelot.exchange')).toBe(false);
    });
  });

  describe('assessTxRisk', () => {
    it('flags setApprovalForAll as high risk', () => {
      const r = assessTxRisk({ data: '0xa22cb465' + '00'.repeat(64) });
      expect(r.isHighRisk).toBe(true);
      expect(r.warnings.join(' ')).toMatch(/NFT collection/i);
    });
    it('flags MaxUint256 ERC-20 approve as unlimited', () => {
      const max = 'f'.repeat(64);
      const data = '0x095ea7b3' + '00'.repeat(32) + max;
      const r = assessTxRisk({ data });
      expect(r.warnings.join(' ')).toMatch(/UNLIMITED/);
    });
    it('does not flag a normal-value APE send', () => {
      const r = assessTxRisk({ value: 1000000000000000000n }); // 1 APE
      expect(r.warnings).toHaveLength(0);
      expect(r.isHighRisk).toBe(false);
    });
    it('warns on > 100k APE transfers', () => {
      const r = assessTxRisk({ value: (10n ** 18n) * 200_000n });
      expect(r.warnings.join(' ')).toMatch(/very large/i);
    });
  });

  describe('passwordStrength', () => {
    it('rates empty as 0', () => {
      expect(passwordStrength('').score).toBe(0);
    });
    it('rates a long mixed password as Strong', () => {
      const r = passwordStrength('CorrectHorseBattery!1');
      expect(r.score).toBe(4);
    });
    it('penalises common passwords', () => {
      expect(passwordStrength('password123').score).toBeLessThanOrEqual(1);
    });
  });

  describe('randomId', () => {
    it('returns 32-char hex per call and is unique across calls', () => {
      const a = randomId();
      const b = randomId();
      expect(a).toMatch(/^[0-9a-f]{32}$/);
      expect(a).not.toBe(b);
    });
  });
});
