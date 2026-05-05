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
// Why this shape
// ──────────────
// Avoids a contract deployment (no admin, no upgrade path, no contract bug
// surface). Costs roughly the same gas per message as a normal transfer
// (~21 000 base + 16 gas/non-zero data byte). The full message history is
// always recoverable from the chain via any block explorer.
//
// Spam / safety
// ─────────────
// Senders are real EOA addresses — there is no anonymous mode. We cap message
// length at MAX_MESSAGE_LEN bytes (under the calldata-pricing knee) and the
// UI strips control characters before render. Anyone can post anything: this
// is a permissionless on-chain chat and the rest is up to user judgement.
import { Wallet, hexlify, toUtf8Bytes } from 'ethers';
import { NETWORKS } from './networks';
import { getProvider } from './evm';
/** The on-chain "inbox" address. Not deployed; it's just a topic identifier. */
export const YACHT_CHAT_INBOX = '0xC4A7000000000000000000000000000000000000';
/** Max message length in UTF-8 bytes. Keeps gas predictable and the UI tidy. */
export const MAX_MESSAGE_LEN = 280;
// Strip ASCII / Unicode control characters (except tab/newline/CR) so a
// trivial spoof — zero-width or backspace tricks — can't ride into the chat
// renderer. Visible printable text and normal whitespace pass through.
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
function hexToUtf8(hex) {
    try {
        if (!hex || !hex.startsWith('0x'))
            return null;
        const body = hex.slice(2);
        if (body.length === 0 || body.length % 2 !== 0)
            return null;
        const bytes = new Uint8Array(body.length / 2);
        for (let i = 0; i < bytes.length; i++)
            bytes[i] = parseInt(body.substr(i * 2, 2), 16);
        const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
        return text.replace(CONTROL_CHARS, '').trim();
    }
    catch {
        return null;
    }
}
export async function sendChatMessage(network, privateKey, text) {
    const trimmed = text.trim();
    if (!trimmed)
        throw new Error('Message is empty');
    const bytes = toUtf8Bytes(trimmed);
    if (bytes.length > MAX_MESSAGE_LEN) {
        throw new Error(`Message too long (${bytes.length} bytes — max ${MAX_MESSAGE_LEN})`);
    }
    const provider = getProvider(network);
    const wallet = new Wallet(privateKey, provider);
    const tx = await wallet.sendTransaction({
        to: YACHT_CHAT_INBOX,
        value: 0n,
        data: hexlify(bytes),
    });
    const receipt = await tx.wait();
    if (!receipt)
        throw new Error('Chat message dropped from mempool');
    return {
        hash: receipt.hash,
        status: receipt.status === 1 ? 'success' : 'failed',
        blockNumber: receipt.blockNumber,
        raw: receipt,
    };
}
export async function getRecentMessages(network, limit = 15) {
    const cfg = NETWORKS[network];
    const merged = {
        module: 'account',
        action: 'txlist',
        address: YACHT_CHAT_INBOX,
        startblock: '0',
        endblock: '99999999',
        page: '1',
        // Pull a few more than `limit` so we can filter empty / unreadable
        // entries and still serve `limit` good ones.
        offset: String(Math.max(limit * 2, 30)),
        sort: 'desc',
    };
    if (cfg.apiChainParam)
        merged.chainid = cfg.apiChainParam;
    if (cfg.apiKey)
        merged.apikey = cfg.apiKey;
    const qs = new URLSearchParams(merged).toString();
    let raw = [];
    try {
        const r = await fetch(`${cfg.apiBase}?${qs}`);
        if (r.ok) {
            const j = await r.json();
            if (Array.isArray(j.result))
                raw = j.result;
        }
    }
    catch { /* fall through to empty */ }
    const out = [];
    const inboxLc = YACHT_CHAT_INBOX.toLowerCase();
    for (const t of raw) {
        if (!t.hash || !t.input)
            continue;
        if ((t.to ?? '').toLowerCase() !== inboxLc)
            continue;
        const text = hexToUtf8(t.input);
        if (!text)
            continue;
        out.push({
            hash: t.hash,
            from: t.from ?? '',
            text,
            timestamp: Number(t.timeStamp ?? 0),
            blockNumber: Number(t.blockNumber ?? 0),
            status: t.isError === '0' || t.txreceipt_status === '1' ? 'success' : 'failed',
        });
        if (out.length >= limit)
            break;
    }
    return out;
}
