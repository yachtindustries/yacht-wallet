// Phishing host check.
//
// We don't try to be a comprehensive blocklist — that's a maintained-list
// problem (eth-phishing-detect, ScamSniffer, etc.) which Yacht should adopt
// before serving meaningful TVL. This file ships a hardcoded seed list of
// known-good ApeChain apps + heuristic checks. The connect popup uses this
// to surface badges + warnings; it does NOT block — the user has the final
// say.

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
  // Add reported phishing hosts here (or fetch a maintained feed at runtime).
]);

const SUSPICIOUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /apechain[\-_.]?airdrop/i, reason: 'Common ApeChain "airdrop" scam pattern.' },
  { pattern: /(claim|redeem|verify)[\-_.]?ape/i, reason: '"Claim/verify" patterns are a common phishing template.' },
  { pattern: /apecoin[\-_.]?(rewards|claim|gift|drop)/i, reason: 'Fake ApeCoin rewards / claim site pattern.' },
  { pattern: /(metamask|phantom|rabby|coinbase|trust)[\-_.]?wallet/i, reason: 'Domain impersonates a different wallet.' },
  { pattern: /camelot[\-_.]?(swap|claim|rewards|airdrop)/i, reason: 'Looks like a fake Camelot front-end.' },
  { pattern: /opensea[\-_.]?(claim|verify|rewards|gift)/i, reason: 'OpenSea phishing pattern.' },
  { pattern: /-?web3-?(connect|wallet|verify)/i, reason: 'Generic Web3 phishing pattern.' },
  { pattern: /(yacht)[\-_.]?wallet/i, reason: 'Domain impersonates Yacht wallet.' },
  { pattern: /(connect|sync|migrate|recover|restore)[\-_.]?(wallet|account)/i, reason: 'Phishing template asking the user to "connect" or "recover" their wallet.' },
];

// Common TLDs where the registrable domain is the LAST 3 labels (e.g.
// example.co.uk). Greatly simplified vs. the full Public Suffix List —
// covers the cases that come up for ApeChain phishing in practice.
const TWO_LABEL_TLDS = new Set([
  'co.uk', 'com.au', 'co.nz', 'co.jp', 'co.kr', 'com.br', 'com.mx', 'com.ar',
  'co.za', 'com.sg', 'com.hk', 'com.tw', 'co.in', 'co.il', 'com.tr', 'com.tw',
  'eu.org', 'github.io', 'pages.dev', 'vercel.app', 'netlify.app', 'web.app',
  'firebaseapp.com',
]);

function rootHost(host: string): string {
  const parts = host.toLowerCase().split('.');
  if (parts.length < 2) return host;
  const last2 = parts.slice(-2).join('.');
  if (parts.length >= 3 && TWO_LABEL_TLDS.has(last2)) {
    return parts.slice(-3).join('.');
  }
  return last2;
}

// Damerau-Levenshtein-style edit distance (insertion / deletion / substitution
// / transposition). Used to flag visually-similar lookalikes of known-good
// hosts.
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const al = a.length, bl = b.length;
  if (Math.abs(al - bl) > 3) return 99;
  const dp: number[][] = Array.from({ length: al + 1 }, () => new Array(bl + 1).fill(0));
  for (let i = 0; i <= al; i++) dp[i][0] = i;
  for (let j = 0; j <= bl; j++) dp[0][j] = j;
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
      }
    }
  }
  return dp[al][bl];
}

// Latin lookalike normalization: collapses 0→o, 1→l, rn→m, vv→w, l→i, etc.
// so that "apecha1n.com" / "apechaln.com" / "арechain.com" (cyrillic а)
// all reduce toward "apechain.com" for distance scoring.
function lookalikeNormalize(s: string): string {
  return s
    // Cyrillic / Greek confusables → Latin
    .replace(/[аα]/g, 'a') // а α
    .replace(/[еε]/g, 'e') // е ε
    .replace(/[оοo]/g, 'o') // о ο o
    .replace(/[рρ]/g, 'p') // р ρ
    .replace(/[сς]/g, 'c') // с ς
    .replace(/[хχ]/g, 'x') // х χ
    .replace(/[іι]/g, 'i') // і ι
    // Visual digit-letter swaps
    .replace(/0/g, 'o')
    .replace(/1/g, 'l')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    // Multi-char visual collisions
    .replace(/rn/g, 'm')
    .replace(/vv/g, 'w')
    .toLowerCase();
}

export interface PhishingVerdict {
  level: 'verified' | 'unknown' | 'suspicious' | 'known-bad';
  reasons: string[];
}

export function checkHost(host: string): PhishingVerdict {
  const reasons: string[] = [];
  const root = rootHost(host);
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

  if (host.includes('xn--')) {
    reasons.push('Domain uses punycode encoding (often used for visual look-alikes).');
  }
  if (/[^\x00-\x7F]/.test(host)) {
    reasons.push('Domain contains non-ASCII characters that may visually mimic a known site.');
  }

  // Lookalike-distance check against the known-good list. We compare the
  // normalised form (Cyrillic→Latin, digit→letter, rn→m, etc.) so that
  // "apecha1n.com" or "арechain.com" both surface as suspicious.
  const candidate = lookalikeNormalize(root);
  for (const good of KNOWN_GOOD_HOSTS) {
    const goodNorm = lookalikeNormalize(good);
    if (candidate === goodNorm) continue; // exact normalised match would be verified above
    const d = editDistance(candidate, goodNorm);
    if (d > 0 && d <= 2) {
      reasons.push(
        `Domain "${root}" is visually similar to "${good}" (edit distance ${d}). Possible look-alike phishing.`,
      );
      break;
    }
  }

  return { level: reasons.length > 0 ? 'suspicious' : 'unknown', reasons };
}

export function hostFromOriginSafe(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}
