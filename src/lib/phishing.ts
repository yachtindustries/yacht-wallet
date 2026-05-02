// Phishing host check.
//
// We don't try to be a comprehensive blocklist — that's a maintained-list
// problem (eth-phishing-detect, ScamSniffer, etc.). Instead we ship a small
// seed list of known-good ApeChain apps + a few obvious heuristic checks. The
// connect popup uses this to surface badges + warnings; it does NOT block —
// the user has the final say.

const KNOWN_GOOD_HOSTS = new Set<string>([
  'apechain.com',
  'apescan.io',
  'camelot.exchange',
  'app.camelot.exchange',
  'apebond.com',
  'opensea.io',
  'magiceden.io',
  'dexscreener.com',
  'apechain.calderaexplorer.xyz',
  'apechain.calderachain.xyz',
]);

// Seed examples — extend with a maintained feed in production.
const KNOWN_BAD_HOSTS = new Set<string>([
  // Add reported phishing hosts here.
]);

const SUSPICIOUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /apechain[\-_.]?airdrop/i, reason: 'Common ApeChain "airdrop" scam pattern.' },
  { pattern: /(claim|redeem|verify)[\-_.]?ape/i, reason: '"Claim/verify" patterns are a common phishing template.' },
  { pattern: /apecoin[\-_.]?(rewards|claim|gift|drop)/i, reason: 'Fake ApeCoin rewards / claim site pattern.' },
  { pattern: /metamask|phantom|rabby|trust[\-_.]?wallet/i, reason: 'Domain impersonates a different wallet.' },
  { pattern: /camelot[\-_.]?(swap|claim|rewards|airdrop)/i, reason: 'Looks like a fake Camelot front-end.' },
  { pattern: /opensea[\-_.]?(claim|verify|rewards|gift)/i, reason: 'OpenSea phishing pattern.' },
  { pattern: /-?web3-?(connect|wallet|verify)/i, reason: 'Generic Web3 phishing pattern.' },
];

function rootHost(host: string): string {
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  return parts.slice(-2).join('.');
}

export interface PhishingVerdict {
  level: 'verified' | 'unknown' | 'suspicious' | 'known-bad';
  reasons: string[];
}

export function checkHost(host: string): PhishingVerdict {
  const reasons: string[] = [];
  const root = rootHost(host).toLowerCase();
  const fullHost = host.toLowerCase();

  if (KNOWN_BAD_HOSTS.has(root) || KNOWN_BAD_HOSTS.has(fullHost)) {
    return { level: 'known-bad', reasons: ['This domain is on a known phishing list.'] };
  }

  if (KNOWN_GOOD_HOSTS.has(root) || KNOWN_GOOD_HOSTS.has(fullHost)) {
    return { level: 'verified', reasons: [] };
  }

  for (const { pattern, reason } of SUSPICIOUS_PATTERNS) {
    if (pattern.test(host)) reasons.push(reason);
  }

  if (host.includes('xn--')) reasons.push('Domain uses punycode (often a look-alike).');
  if (/[^\x00-\x7F]/.test(host)) reasons.push('Domain contains non-ASCII characters.');

  return { level: reasons.length > 0 ? 'suspicious' : 'unknown', reasons };
}
