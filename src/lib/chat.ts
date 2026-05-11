// Yacht on-chain chat. Every message is a real transaction on ApeChain.
//
// How it works
// ────────────
// • Sending a message is a 0-value transaction to a designated INBOX address
//   (`YACHT_CHAT_INBOX`) with the UTF-8 message bytes hex-encoded into the
//   `data` field. The "to" address is just a topic identifier — nothing is
//   deployed there, no value is moved, the recipient is irrelevant.
//
// • Reading messages is an Etherscan `txlist` query for transactions where
//   `to == YACHT_CHAT_INBOX`. We decode each one's `input` field as UTF-8
//   and surface (sender, text, timestamp, hash). Anyone can send, anyone can
//   read.
//
// • Tipping a message is a real APE transfer to the message AUTHOR's EOA,
//   with the data field carrying TIP_MAGIC + the tipped message's tx hash
//   (32 B). Aggregation only counts tips where the recipient address equals
//   the original message's `from` — preventing attackers from inflating
//   another author's totals by sending APE elsewhere with a stolen msgHash.
//
// Content safety
// ──────────────
// validateChatMessage() rejects URLs, TLD-shaped strings, HTML/JS code
// patterns, hex/base64 blobs, and a small profanity wordlist. Validation
// runs at SEND time (so the user doesn't waste gas on a message that will
// never display) AND at DISPLAY time (so messages that were posted before
// a rule existed are still hidden from the renderer).

import { Wallet, formatUnits, hexlify, parseUnits, toUtf8Bytes } from 'ethers';
import { NETWORKS, type NetworkId } from './networks';
import { getProvider, type SendResult } from './evm';

/** The on-chain "inbox" address. Not deployed; it's just a topic identifier. */
export const YACHT_CHAT_INBOX = '0xC4A7000000000000000000000000000000000000';

/** Max message length in UTF-8 bytes. Keeps gas predictable and the UI tidy. */
export const MAX_MESSAGE_LEN = 280;

/**
 * 4-byte tag prefixing the data field of every tip tx so the aggregator can
 * tell tip transfers apart from normal sends. ASCII for "YTIP".
 */
export const TIP_MAGIC = '0x59544950';

export interface ChatMessage {
  hash: string;
  from: string;
  text: string;
  /**
   * Yacht username embedded in the on-chain payload by the sender's wallet.
   * Decoded from the `@{username}\n` prefix at read time. Vanity only —
   * tipping / explorer linking always resolves through `from`.
   */
  username?: string;
  /** Unix seconds. */
  timestamp: number;
  blockNumber: number;
  status: 'success' | 'failed';
}

/**
 * Format every Yacht client uses to embed the sender's username in the chat
 * message. The username line stands alone on the first line; the message
 * body follows after a single newline. We parse this back at display time.
 */
const USERNAME_PREFIX_REGEX = /^@([a-z0-9_]{3,20})\n/;

interface RawTxlistEntry {
  hash?: string;
  from?: string;
  to?: string;
  input?: string;
  value?: string;
  timeStamp?: string;
  blockNumber?: string;
  isError?: string;
  txreceipt_status?: string;
}

// Strip ASCII / Unicode control characters (except tab/newline/CR) so a
// trivial spoof — zero-width or backspace tricks — can't ride into the chat
// renderer. Visible printable text and normal whitespace pass through.
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

// Invisible / bidi / zero-width / format-control codepoints. These render
// as nothing but slip past URL_REGEX / TLD_REGEX and let an attacker post
// a phishing URL that LOOKS like normal text (e.g. "h​ttps://drainer.tld"
// where the unseen U+200B between 'h' and 't' defeats prefix matching).
// We strip them before moderation AND before display so a copy-paste from
// the rendered bubble can't reconstruct the hostile URL.
const INVISIBLE_CHARS = /[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

/**
 * Canonicalise text for moderation + display. NFKC normalisation collapses
 * fullwidth/halfwidth/compatibility variants into their plain ASCII forms
 * (e.g. fullwidth "．" → ".", fullwidth letters → ASCII), neutralising
 * lookalike-domain attacks like "evil．com". The invisible-character strip
 * defeats zero-width-joiner / bidi-override smuggling. Everything else
 * (Unicode emoji, accented Latin, non-Latin scripts that don't collapse
 * under NFKC) survives unchanged.
 */
function canonicalise(text: string): string {
  return text.normalize('NFKC').replace(INVISIBLE_CHARS, '');
}

// ─── Moderation: links, code, blobs, profanity ─────────────────────────────
//
// All four blocklists are intentionally aggressive: chat is text only, and a
// false-positive "rejected — looks like a link" is a much better outcome than
// a false-negative phishing URL that drains a user. None of these patterns
// are bypassed by leetspeak alone (sh!t still trips, h##ps still doesn't).

const URL_REGEX = /(?:https?:\/\/|www\.)\S+/i;
const TLD_REGEX =
  /\b[a-z0-9-]+\.(?:com|net|org|io|xyz|app|fun|exchange|ai|me|co|us|finance|trade|fi|wtf|click|link|live|info|biz|tk|ml|dev|sh|tv|cn|ru|cc|gg|gl|art|finance|crypto|wallet)\b/i;
const HEX_BLOB_REGEX = /(?:0x)?[0-9a-fA-F]{32,}/;
const BASE64_BLOB_REGEX = /[A-Za-z0-9+/]{40,}={0,2}/;
const HTML_TAG_REGEX = /<\/?[a-zA-Z][^>]*>/;
const CODE_LIKE_REGEX =
  /\b(?:function\s*\(|const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=|<\?(?:php|xml)|<script|import\s+[\w{]|require\s*\(|eval\s*\(|window\.[a-z]|document\.[a-z]|=>\s*[{(])/i;

// Minimal profanity blocklist. Word-boundary matched, case-insensitive. Keep
// in this file (not memory) so it ships in the bundle and validates offline.
const PROFANITY_WORDS = [
  'fuck', 'fucker', 'fucking', 'motherfucker', 'shit', 'shithead', 'bitch',
  'cunt', 'asshole', 'bastard', 'dick', 'cock', 'pussy', 'whore', 'slut',
  'faggot', 'fag', 'nigger', 'nigga', 'retard', 'retarded', 'tranny',
];
const PROFANITY_REGEX = new RegExp(`\\b(?:${PROFANITY_WORDS.join('|')})\\b`, 'i');

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

export function validateChatMessage(text: string): ValidationResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: 'Message is empty' };
  // Compute byte length BEFORE canonicalisation — that's what actually
  // ends up on chain.
  const byteLen = new TextEncoder().encode(trimmed).length;
  if (byteLen > MAX_MESSAGE_LEN) return { ok: false, reason: `Message too long (max ${MAX_MESSAGE_LEN} chars)` };
  // All moderation regexes run against the canonicalised form so an
  // attacker can't smuggle URLs/profanity past us with zero-width chars or
  // fullwidth/lookalike codepoints.
  const probe = canonicalise(trimmed);
  if (URL_REGEX.test(probe)) return { ok: false, reason: 'Links are not allowed in chat' };
  if (TLD_REGEX.test(probe)) return { ok: false, reason: 'Links / domains are not allowed in chat' };
  if (HTML_TAG_REGEX.test(probe)) return { ok: false, reason: 'HTML / markup is not allowed in chat' };
  if (CODE_LIKE_REGEX.test(probe)) return { ok: false, reason: 'Code is not allowed in chat' };
  if (HEX_BLOB_REGEX.test(probe)) return { ok: false, reason: 'Hex blobs are not allowed in chat' };
  if (BASE64_BLOB_REGEX.test(probe)) return { ok: false, reason: 'Encoded blobs are not allowed in chat' };
  if (PROFANITY_REGEX.test(probe)) return { ok: false, reason: 'Please keep chat civil' };
  return { ok: true };
}

function hexToUtf8(hex: string): string | null {
  try {
    if (!hex || !hex.startsWith('0x')) return null;
    const body = hex.slice(2);
    if (body.length === 0 || body.length % 2 !== 0) return null;
    const bytes = new Uint8Array(body.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(body.substr(i * 2, 2), 16);
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    // Same canonicalisation we apply on send: strip control chars, strip
    // invisible/bidi codepoints, NFKC-fold compatibility variants. So a
    // copy-paste from the rendered chat bubble can't reconstruct an
    // attacker-crafted URL hidden behind invisibles.
    return canonicalise(text.replace(CONTROL_CHARS, '')).trim();
  } catch {
    return null;
  }
}

export async function sendChatMessage(
  network: NetworkId,
  privateKey: string,
  text: string,
  username?: string,
): Promise<SendResult> {
  const v = validateChatMessage(text);
  if (!v.ok) throw new Error(v.reason ?? 'Message rejected');
  const trimmed = text.trim();
  // The `@{username}\n` prefix is added by the wallet, not the user — the
  // user's typed text is what the moderation rules apply to. We append the
  // prefix afterwards so it never trips the validator.
  const payloadText = username ? `@${username}\n${trimmed}` : trimmed;
  const bytes = toUtf8Bytes(payloadText);
  if (bytes.length > MAX_MESSAGE_LEN) {
    throw new Error(`Message too long (max ${MAX_MESSAGE_LEN} bytes)`);
  }
  const provider = getProvider(network);
  const wallet = new Wallet(privateKey, provider);
  const tx = await wallet.sendTransaction({
    to: YACHT_CHAT_INBOX,
    value: 0n,
    data: hexlify(bytes),
  });
  const receipt = await tx.wait();
  if (!receipt) throw new Error('Chat message dropped from mempool');
  return {
    hash: receipt.hash,
    status: receipt.status === 1 ? 'success' : 'failed',
    blockNumber: receipt.blockNumber,
    raw: receipt,
  };
}

export async function getRecentMessages(
  network: NetworkId,
  limit = 15,
): Promise<ChatMessage[]> {
  const cfg = NETWORKS[network];
  const merged: Record<string, string> = {
    module: 'account',
    action: 'txlist',
    address: YACHT_CHAT_INBOX,
    startblock: '0',
    endblock: '99999999',
    page: '1',
    // Pull a few more than `limit` so we can filter empty / unreadable
    // entries and still serve `limit` good ones.
    offset: String(Math.max(limit * 3, 45)),
    sort: 'desc',
  };
  if (cfg.apiChainParam) merged.chainid = cfg.apiChainParam;
  if (cfg.apiKey) merged.apikey = cfg.apiKey;
  const qs = new URLSearchParams(merged).toString();
  let raw: RawTxlistEntry[] = [];
  try {
    const r = await fetch(`${cfg.apiBase}?${qs}`);
    if (r.ok) {
      const j: any = await r.json();
      if (Array.isArray(j.result)) raw = j.result as RawTxlistEntry[];
    }
  } catch { /* fall through to empty */ }

  const out: ChatMessage[] = [];
  const inboxLc = YACHT_CHAT_INBOX.toLowerCase();
  for (const t of raw) {
    if (!t.hash || !t.input) continue;
    if ((t.to ?? '').toLowerCase() !== inboxLc) continue;
    const decoded = hexToUtf8(t.input);
    if (!decoded) continue;

    // Strip the `@{username}\n` prefix added by Yacht clients before
    // running moderation: legacy messages without a prefix just get the
    // entire decoded text validated.
    let username: string | undefined;
    let body = decoded;
    const m = USERNAME_PREFIX_REGEX.exec(decoded);
    if (m) {
      username = m[1];
      body = decoded.slice(m[0].length).trim();
    }
    // Defang any further "from line" prefix in the body so the message
    // can't visually impersonate the sender attribution line above it.
    // We collapse the trailing newline into a single space, so a smuggled
    // `@bob\n…` becomes inline text `@bob …` instead of mimicking another
    // bubble header.
    body = body.replace(/^@([a-z0-9_]{3,20})\n/, '@$1 ');

    // Hide messages that violate current moderation rules even if they pre-
    // date them. We can't delete on-chain, but we can refuse to render.
    if (!validateChatMessage(body).ok) continue;
    out.push({
      hash: t.hash,
      from: t.from ?? '',
      text: body,
      username,
      timestamp: Number(t.timeStamp ?? 0),
      blockNumber: Number(t.blockNumber ?? 0),
      status: t.isError === '0' || t.txreceipt_status === '1' ? 'success' : 'failed',
    });
    if (out.length >= limit) break;
  }
  return out;
}

// ─── Tipping ───────────────────────────────────────────────────────────────

/**
 * Send an APE tip to the author of a chat message. The recipient is the EOA
 * that posted the tipped message; the data field carries the tip-magic + the
 * tipped message's tx hash so the aggregator can attribute the tip back.
 *
 * SECURITY: caller passes both `toAuthor` and `messageHash`. We do NOT trust
 * the caller to also pass them through correctly to chain — toAuthor must be
 * a valid 0x-address and messageHash must be a valid 0x-hash. The aggregator
 * later only credits a tip to a message if `tx.to === message.from`, so an
 * attacker can't make their own message look popular by sending APE to a
 * different address with a fake msgHash.
 */
export async function sendTip(
  network: NetworkId,
  privateKey: string,
  toAuthor: string,
  messageHash: string,
  apeAmount: string,
): Promise<SendResult> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(toAuthor)) throw new Error('Invalid tip recipient');
  if (!/^0x[0-9a-fA-F]{64}$/.test(messageHash)) throw new Error('Invalid message hash');
  const value = parseUnits(apeAmount, 18);
  if (value <= 0n) throw new Error('Tip amount must be positive');
  // Cap at 100 APE to avoid an accidental hover-into-click 10-million-APE
  // blunder if the UI ever ships a custom-amount field.
  if (value > parseUnits('100', 18)) throw new Error('Tip amount too large');

  // Data: 4-byte magic + 32-byte msgHash. 36 bytes total → ~16 gas/non-zero
  // byte cost on top of the 21 000 base. Cheap, but recognisable.
  const data = TIP_MAGIC + messageHash.slice(2).toLowerCase();

  const provider = getProvider(network);
  const wallet = new Wallet(privateKey, provider);
  const tx = await wallet.sendTransaction({
    to: toAuthor,
    value,
    data,
  });
  const receipt = await tx.wait();
  if (!receipt) throw new Error('Tip dropped from mempool');
  return {
    hash: receipt.hash,
    status: receipt.status === 1 ? 'success' : 'failed',
    blockNumber: receipt.blockNumber,
    raw: receipt,
  };
}

export interface TipTotal {
  /** Tipped message tx hash. */
  messageHash: string;
  /** Sum of all tips sent to that message's author with this msgHash, in wei (decimal string). */
  totalWei: string;
  /** Number of distinct tipping transactions counted. */
  count: number;
}

interface TipQueryEntry {
  messageHash: string;
  /** Author EOA — the only recipient that counts as a real tip for this message. */
  author: string;
}

/**
 * Aggregate tip totals across a set of messages. For each unique author we
 * make one Etherscan `txlist` call, filter incoming txs whose data starts
 * with TIP_MAGIC, then bucket by the encoded msgHash if that msgHash matches
 * one of the requested entries.
 */
export async function getTipsForMessages(
  network: NetworkId,
  entries: TipQueryEntry[],
): Promise<TipTotal[]> {
  if (entries.length === 0) return [];
  const cfg = NETWORKS[network];
  const wantedByAuthor = new Map<string, Set<string>>();
  for (const e of entries) {
    const a = e.author.toLowerCase();
    const set = wantedByAuthor.get(a) ?? new Set<string>();
    set.add(e.messageHash.toLowerCase());
    wantedByAuthor.set(a, set);
  }
  // Cap the number of authors we'll query in one shot so a chat full of
  // unique senders doesn't burn through the Etherscan budget.
  const authors = [...wantedByAuthor.keys()].slice(0, 12);

  const totals = new Map<string, { wei: bigint; count: number }>();
  await Promise.all(
    authors.map(async (author) => {
      const params: Record<string, string> = {
        module: 'account',
        action: 'txlist',
        address: author,
        startblock: '0',
        endblock: '99999999',
        page: '1',
        offset: '50',
        sort: 'desc',
      };
      if (cfg.apiChainParam) params.chainid = cfg.apiChainParam;
      if (cfg.apiKey) params.apikey = cfg.apiKey;
      const qs = new URLSearchParams(params).toString();
      let rows: RawTxlistEntry[] = [];
      try {
        const r = await fetch(`${cfg.apiBase}?${qs}`);
        if (r.ok) {
          const j: any = await r.json();
          if (Array.isArray(j.result)) rows = j.result as RawTxlistEntry[];
        }
      } catch { return; }

      const wanted = wantedByAuthor.get(author);
      if (!wanted) return;
      for (const t of rows) {
        if (!t.input || !t.input.toLowerCase().startsWith(TIP_MAGIC)) continue;
        // Defence in depth: only count txs that actually went TO this author.
        // Etherscan's txlist already filters by `address`, but the request
        // includes both incoming and outgoing — make the recipient check
        // explicit so a future API variant doesn't smuggle tips out.
        if ((t.to ?? '').toLowerCase() !== author) continue;
        if (t.isError !== '0' && t.txreceipt_status !== '1') continue;
        const tagLen = TIP_MAGIC.length;        // includes "0x"
        const hashHex = '0x' + t.input.slice(tagLen, tagLen + 64).toLowerCase();
        if (hashHex.length !== 66) continue;
        if (!wanted.has(hashHex)) continue;
        let wei: bigint;
        try { wei = BigInt(t.value ?? '0'); } catch { continue; }
        if (wei <= 0n) continue;
        const cur = totals.get(hashHex) ?? { wei: 0n, count: 0 };
        cur.wei += wei;
        cur.count += 1;
        totals.set(hashHex, cur);
      }
    }),
  );

  return [...totals.entries()].map(([messageHash, v]) => ({
    messageHash,
    totalWei: v.wei.toString(),
    count: v.count,
  }));
}

// ─── Tip daily budget ──────────────────────────────────────────────────────
//
// Tips don't open an approval popup — they're one-click in the chat UI by
// design. To bound the blast radius of a popup-side compromise (XSS, a
// malicious extension page injected later, etc.), we cap the total APE a
// wallet can send via tips in any rolling 24-hour window. Spend is tracked
// per active-account address in chrome.storage.local; the window resets
// the next time a tip is attempted more than 24h after the window started.
//
// 50 APE / 24h gives ~5 max-sized tips per day before the cap kicks in,
// which fits the intended use (occasional 0.1 / 1 / 10 APE tips) but
// stops a runaway script from draining a wallet.

const TIP_BUDGET_KEY = 'yacht.tipBudget.v1';
const TIP_WINDOW_MS = 24 * 60 * 60 * 1000;
const TIP_DAILY_CAP_WEI = parseUnits('50', 18);

interface TipBudgetEntry {
  /** Bigint serialised as decimal string. */
  spentWei: string;
  /** Window start in epoch ms. */
  windowStartedAt: number;
}
type TipBudgetStore = { [addressLc: string]: TipBudgetEntry };

async function readTipBudget(): Promise<TipBudgetStore> {
  try {
    const r = await chrome.storage.local.get(TIP_BUDGET_KEY);
    const v = r[TIP_BUDGET_KEY];
    return v && typeof v === 'object' ? (v as TipBudgetStore) : {};
  } catch {
    return {};
  }
}

async function writeTipBudget(s: TipBudgetStore): Promise<void> {
  try { await chrome.storage.local.set({ [TIP_BUDGET_KEY]: s }); } catch { /* best effort */ }
}

/**
 * Reserve `amountWei` against the wallet's daily tip budget. Throws with a
 * user-visible message if the cap would be exceeded. Caller should follow
 * up with `releaseTipBudget` if the on-chain tip reverts.
 */
export async function reserveTipBudget(addressLc: string, amountWei: bigint): Promise<void> {
  const now = Date.now();
  const store = await readTipBudget();
  const cur = store[addressLc] ?? { spentWei: '0', windowStartedAt: now };
  let spent = 0n;
  try { spent = BigInt(cur.spentWei); } catch { spent = 0n; }
  // Roll the window forward if the prior one has expired.
  if (now - cur.windowStartedAt > TIP_WINDOW_MS) {
    spent = 0n;
    cur.windowStartedAt = now;
  }
  const next = spent + amountWei;
  if (next > TIP_DAILY_CAP_WEI) {
    const remainingWei = TIP_DAILY_CAP_WEI > spent ? TIP_DAILY_CAP_WEI - spent : 0n;
    const remaining = formatUnits(remainingWei, 18);
    throw new Error(`Daily tip cap reached — ${remaining} APE left in this 24-hour window.`);
  }
  cur.spentWei = next.toString();
  store[addressLc] = cur;
  await writeTipBudget(store);
}

/** Roll back a prior reserveTipBudget when the tip tx fails on chain. */
export async function releaseTipBudget(addressLc: string, amountWei: bigint): Promise<void> {
  const store = await readTipBudget();
  const cur = store[addressLc];
  if (!cur) return;
  let spent = 0n;
  try { spent = BigInt(cur.spentWei); } catch { spent = 0n; }
  const refunded = spent > amountWei ? spent - amountWei : 0n;
  cur.spentWei = refunded.toString();
  store[addressLc] = cur;
  await writeTipBudget(store);
}
