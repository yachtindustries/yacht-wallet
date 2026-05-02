// Signature-request analysis. The biggest EVM-wallet drainer in 2025–2026 is
// off-chain signature phishing: a dApp asks the user to sign typed data which,
// once the attacker submits it on-chain, drains tokens or NFTs without ever
// triggering a user-side transaction. Without parsing, the popup just shows a
// JSON blob.
//
// We surface the dangerous primitives explicitly:
//   • EIP-2612 Permit       (single-token unlimited approval)
//   • Permit2 PermitSingle/PermitBatch/PermitTransferFrom (Uniswap allowance vault)
//   • Seaport orders        (NFT drainers)
//   • setApprovalForAll     (NFT collection drainer — appears in tx data, not sig)
//
// We also do cross-chain replay defense: a domain.chainId that doesn't match
// our active chain means the signature is actually valid on a different chain.
import { getAddress, isAddress } from 'ethers';
const APECHAIN_CHAIN_ID = 33139;
function asNumber(v) {
    if (v == null)
        return null;
    if (typeof v === 'number' && Number.isFinite(v))
        return v;
    if (typeof v === 'string') {
        if (v.startsWith('0x')) {
            try {
                return Number(BigInt(v));
            }
            catch {
                return null;
            }
        }
        const n = Number(v);
        if (Number.isFinite(n))
            return n;
    }
    if (typeof v === 'bigint')
        return Number(v);
    return null;
}
function asAddress(v) {
    if (typeof v !== 'string' || !v)
        return undefined;
    try {
        if (isAddress(v))
            return getAddress(v);
    }
    catch { /* ignore */ }
    return undefined;
}
const MAX_UINT256 = (1n << 256n) - 1n;
function analyzeAmount(raw) {
    if (!raw)
        return { display: '0', isUnlimited: false };
    let n;
    try {
        n = BigInt(raw);
    }
    catch {
        return { display: String(raw), isUnlimited: false };
    }
    if (n >= MAX_UINT256 - (1n << 128n))
        return { display: 'UNLIMITED', isUnlimited: true };
    return { display: n.toString(), isUnlimited: false };
}
export function analyzeTypedData(payload, activeChainId = APECHAIN_CHAIN_ID) {
    const warnings = [];
    const primaryType = payload.primaryType ?? 'EIP712';
    const domain = payload.domain ?? {};
    const domainChainId = asNumber(domain.chainId);
    if (domainChainId == null) {
        warnings.push('Missing domain.chainId — this signature can be replayed on any chain.');
    }
    else if (domainChainId !== activeChainId) {
        warnings.push(`Signature is targeted at chain ${domainChainId} but you are on chain ${activeChainId}. Likely a cross-chain replay attempt — REJECT unless you understand exactly why.`);
    }
    // ─── Permit2 (Uniswap universal allowance vault) ────────────────────────
    if (primaryType === 'PermitSingle' || primaryType === 'PermitBatch') {
        const isBatch = primaryType === 'PermitBatch';
        const message = payload.message ?? {};
        const detailsField = message.details;
        let token;
        let amountRaw;
        let deadline;
        if (Array.isArray(detailsField)) {
            // PermitBatch
            const tokens = detailsField.map((d) => asAddress(d.token)).filter(Boolean);
            token = tokens.length ? tokens.join(', ') : undefined;
            const sumIsUnlimited = detailsField.some((d) => analyzeAmount(String(d.amount ?? '0')).isUnlimited);
            amountRaw = sumIsUnlimited ? 'UNLIMITED' : 'multiple amounts';
            deadline = asNumber(detailsField[0]?.expiration) ?? undefined;
        }
        else if (detailsField) {
            token = asAddress(detailsField.token);
            amountRaw = String(detailsField.amount ?? '0');
            deadline = asNumber(detailsField.expiration) ?? undefined;
        }
        const spender = asAddress(message.spender);
        const amt = amountRaw ? analyzeAmount(amountRaw) : { display: '?', isUnlimited: false };
        return {
            primaryType,
            summary: isBatch
                ? 'Permit2 BATCH approval (Uniswap allowance vault)'
                : 'Permit2 approval (Uniswap allowance vault)',
            warnings: [
                ...warnings,
                amt.isUnlimited
                    ? `Grants ${spender ?? 'spender'} UNLIMITED ability to move your tokens via Permit2.`
                    : `Grants ${spender ?? 'spender'} ability to move ${amt.display} of your tokens via Permit2.`,
                'Permit2 approvals can be reused until expiration. Only sign if you fully trust the spender.',
            ],
            isDrainerPattern: true,
            drainerKind: isBatch ? 'permit2-batch' : 'permit2-single',
            spender,
            token,
            amount: amt.display,
            deadline,
        };
    }
    if (primaryType === 'PermitTransferFrom' || primaryType === 'PermitBatchTransferFrom') {
        const message = payload.message ?? {};
        const permitted = message.permitted;
        let token;
        let amountRaw;
        if (Array.isArray(permitted)) {
            const tokens = permitted.map((p) => asAddress(p.token)).filter(Boolean);
            token = tokens.length ? tokens.join(', ') : undefined;
            const sumIsUnlimited = permitted.some((p) => analyzeAmount(String(p.amount ?? '0')).isUnlimited);
            amountRaw = sumIsUnlimited ? 'UNLIMITED' : 'multiple amounts';
        }
        else if (permitted) {
            token = asAddress(permitted.token);
            amountRaw = String(permitted.amount ?? '0');
        }
        const amt = amountRaw ? analyzeAmount(amountRaw) : { display: '?', isUnlimited: false };
        return {
            primaryType,
            summary: 'Permit2 single-use transfer authorization',
            warnings: [
                ...warnings,
                `Authorizes a one-shot Permit2 transfer of ${amt.display} of your tokens.`,
                'The signature can be submitted once on-chain by anyone holding it. Verify the recipient.',
            ],
            isDrainerPattern: true,
            drainerKind: 'permit2-transferfrom',
            token,
            amount: amt.display,
            deadline: asNumber(message.deadline) ?? undefined,
        };
    }
    // ─── EIP-2612 Permit (per-token offline approval) ────────────────────────
    if (primaryType === 'Permit') {
        const message = payload.message ?? {};
        const owner = asAddress(message.owner);
        const spender = asAddress(message.spender);
        const valueRaw = String(message.value ?? '0');
        const amt = analyzeAmount(valueRaw);
        const deadline = asNumber(message.deadline) ?? undefined;
        return {
            primaryType,
            summary: 'EIP-2612 Permit (offline token approval)',
            warnings: [
                ...warnings,
                amt.isUnlimited
                    ? `Grants ${spender ?? 'spender'} UNLIMITED spending of your token. Common drainer pattern — REJECT unless you trust the spender.`
                    : `Grants ${spender ?? 'spender'} spending of ${amt.display} of your token.`,
                owner ? `Owner: ${owner}` : '',
            ].filter(Boolean),
            isDrainerPattern: true,
            drainerKind: 'permit2612',
            spender,
            token: asAddress(domain.verifyingContract),
            amount: amt.display,
            deadline,
        };
    }
    // ─── Seaport (OpenSea) order signatures ─────────────────────────────────
    if (primaryType === 'OrderComponents' || primaryType === 'BulkOrder') {
        return {
            primaryType,
            summary: primaryType === 'BulkOrder' ? 'OpenSea (Seaport) BULK order' : 'OpenSea (Seaport) order',
            warnings: [
                ...warnings,
                'This signature can transfer NFTs and tokens out of your wallet under the order terms.',
                'Verify the offer / consideration before signing. NFT scams use lookalike orders.',
            ],
            isDrainerPattern: true,
            drainerKind: 'seaport',
        };
    }
    return {
        primaryType,
        summary: `Sign typed data (${primaryType})`,
        warnings,
        isDrainerPattern: false,
    };
}
export function analyzeTxData(data, value) {
    const warnings = [];
    const lc = (data ?? '0x').toLowerCase();
    if (lc === '0x' || lc.length < 10) {
        return { label: value > 0n ? 'Send APE' : 'Empty call', warnings, isHighRisk: false };
    }
    const selector = lc.slice(0, 10);
    // approve(address,uint256) — ERC-20
    if (selector === '0x095ea7b3' && lc.length >= 10 + 64 + 64) {
        const spender = '0x' + lc.slice(10 + 24, 10 + 64);
        const amount = '0x' + lc.slice(10 + 64);
        let amt;
        try {
            amt = BigInt(amount);
        }
        catch {
            amt = 0n;
        }
        const unlimited = amt >= MAX_UINT256 - (1n << 128n);
        if (unlimited) {
            warnings.push(`Approves UNLIMITED token spending to ${spender}. Drainer pattern — REJECT unless you fully trust the spender.`);
        }
        else if (amt > 0n) {
            warnings.push(`Approves ${amt.toString()} token units to ${spender}. Verify the spender address.`);
        }
        return {
            label: unlimited ? 'ERC-20 approve (UNLIMITED)' : 'ERC-20 approve',
            warnings,
            isHighRisk: unlimited,
            spender: asAddress(spender),
            isUnlimitedApproval: unlimited,
        };
    }
    // setApprovalForAll(address,bool) — ERC-721 / ERC-1155 collection drainer
    if (selector === '0xa22cb465' && lc.length >= 10 + 64 + 64) {
        const operator = '0x' + lc.slice(10 + 24, 10 + 64);
        const approved = lc.slice(-1) === '1';
        if (approved) {
            warnings.push(`Grants ${operator} the right to move EVERY NFT you own in this collection. Common NFT drainer.`);
        }
        else {
            warnings.push(`Revokes ${operator}'s approval over this NFT collection.`);
        }
        return {
            label: approved ? 'NFT setApprovalForAll (GRANT)' : 'NFT setApprovalForAll (revoke)',
            warnings,
            isHighRisk: approved,
            spender: asAddress(operator),
        };
    }
    // increaseAllowance(address,uint256)
    if (selector === '0x39509351') {
        warnings.push('Increases an existing token allowance.');
        return { label: 'ERC-20 increaseAllowance', warnings, isHighRisk: false };
    }
    // transfer(address,uint256) — ERC-20 send
    if (selector === '0xa9059cbb') {
        return { label: 'ERC-20 transfer', warnings, isHighRisk: false };
    }
    // transferFrom(address,address,uint256)
    if (selector === '0x23b872dd') {
        warnings.push('Pulls tokens from an address that previously approved this contract.');
        return { label: 'ERC-20 transferFrom', warnings, isHighRisk: false };
    }
    return { label: 'Contract call', warnings, isHighRisk: false };
}
// ─── personal_sign safety ──────────────────────────────────────────────────
// Catch the "sign this 32-byte hash to log in" trick where the hash is
// secretly an eth_sign payload that authorizes a transaction.
export function analyzePersonalSign(message) {
    const warnings = [];
    let isRawHash = false;
    if (typeof message === 'string' && message.startsWith('0x')) {
        const hex = message.slice(2);
        if (hex.length === 64 && /^[0-9a-fA-F]+$/.test(hex)) {
            warnings.push('You are being asked to sign a raw 32-byte hash. This is the same shape as a transaction hash — if you sign it, an attacker may be able to broadcast a transaction in your name. REJECT unless you authored this hash yourself.');
            isRawHash = true;
        }
    }
    return { warnings, isRawHash };
}
