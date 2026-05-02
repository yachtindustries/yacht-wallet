// Shared security helpers used by both the background worker and the popup.
// EVM-specific: we rely on tx-level checks (high-value transfer, contract call,
// approve to unknown spender) rather than transaction-type allowlists.

import { formatUnits, parseUnits } from 'ethers';

export interface TxRiskAssessment {
  isHighRisk: boolean;
  warnings: string[];
}

const MAX_REASONABLE_VALUE_APE = parseUnits('100000', 18);   // > 100k APE → unusual

// Inspect an EVM transaction request and surface red flags. The popup shows
// the warnings to the user; the background may also use this to refuse certain
// patterns from dApp signing.
export function assessTxRisk(tx: any): TxRiskAssessment {
  const warnings: string[] = [];
  let isHighRisk = false;

  const data: string = typeof tx?.data === 'string' ? tx.data.toLowerCase() : '0x';
  const value = (() => {
    const v = tx?.value;
    if (v == null) return 0n;
    if (typeof v === 'bigint') return v;
    try {
      if (typeof v === 'string') {
        return v.startsWith('0x') ? BigInt(v) : BigInt(v);
      }
      return BigInt(v);
    } catch {
      return 0n;
    }
  })();

  if (value > MAX_REASONABLE_VALUE_APE) {
    warnings.push(`Sends ${formatUnits(value, 18)} APE — this is a very large amount.`);
  }

  // ERC-20 approve (0x095ea7b3): warn on unbounded approvals.
  if (data.startsWith('0x095ea7b3') && data.length >= 10 + 64 + 64) {
    const amountHex = '0x' + data.slice(10 + 64);
    try {
      const amt = BigInt(amountHex);
      const isMax = amt === (1n << 256n) - 1n;
      if (isMax) {
        warnings.push('Approves UNLIMITED token spending. Only proceed if you fully trust this contract.');
      } else if (amt > 0n) {
        warnings.push('Approves token spending — verify the spender address.');
      }
    } catch { /* ignore */ }
  }

  // setApprovalForAll (0xa22cb465) — full NFT collection approval.
  if (data.startsWith('0xa22cb465')) {
    warnings.push('Grants approval over your entire NFT collection. High risk.');
    isHighRisk = true;
  }

  // Self-destructing or extremely unusual selectors → call-out only.
  if (data.length > 2 && data.length < 10) {
    warnings.push('Transaction data looks malformed.');
  }

  return { isHighRisk, warnings };
}

// Detect IDN homograph attacks in dApp domains.
export function looksHomograph(host: string): boolean {
  if (host.startsWith('xn--')) return true;
  if (/[^\x00-\x7F]/.test(host)) return true;
  return false;
}

export function hostFromOrigin(origin: string | undefined | null): string {
  if (!origin) return '';
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

// Crude password strength scoring without pulling in zxcvbn (~400 KB).
// 0/1 weak, 2 fair, 3 good, 4 strong.
export function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (!pw) return { score: 0, label: 'Empty' };
  let score = 0;
  if (pw.length >= 12) score++;
  if (pw.length >= 16) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;

  if (/^(?:password|qwerty|letmein|admin|welcome|123456)/i.test(pw)) score = 0;
  if (/(.)\1{4,}/.test(pw)) score = Math.max(0, score - 1);

  const labels = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'] as const;
  const s = Math.max(0, Math.min(4, score)) as 0 | 1 | 2 | 3 | 4;
  return { score: s, label: labels[s] };
}

export function randomId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
