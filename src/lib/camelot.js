// Camelot V2 swap integration on ApeChain.
//
// Camelot V2 is a Uniswap-V2-fork DEX with a fee-on-transfer-aware router.
// It backs the bulk of ApeChain liquidity and supports any ERC-20 listed there
// (which is "all of them" in practice on ApeChain). For tokens that only have
// V3 pools we fall back to a "no route" error and the user can use the
// "Trade on DexScreener" link in the swap screen.
//
// Verified contract addresses (https://docs.camelot.exchange/contracts/orbit-chains/apechain):
//   Router V2:  0x18E621B64d7808c3C47bccbbD7485d23F257D26f
//   Factory V2: 0x7d8c6B58BA2d40FC6E34C25f9A488067Fe0D2dB4
//   WAPE:       0x48b62137EdfA95a428D35C09E44256a739F6B557
import { Contract, Interface, ZeroAddress, Wallet, formatUnits, parseUnits, } from 'ethers';
import { NETWORKS } from './networks';
import { getProvider } from './evm';
export const CAMELOT_V2_ROUTER = '0x18E621B64d7808c3C47bccbbD7485d23F257D26f';
export const WAPE_ADDRESS = '0x48b62137EdfA95a428D35C09E44256a739F6B557';
// Camelot V2 is a Uniswap V2 fork with one extra `referrer` argument on the
// "SupportingFeeOnTransferTokens" variants. We always pass address(0).
const ROUTER_ABI = [
    'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)',
    'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, address referrer, uint256 deadline) payable',
    'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, address referrer, uint256 deadline)',
    'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, address referrer, uint256 deadline)',
];
const ERC20_ABI = [
    'function allowance(address owner, address spender) view returns (uint256)',
    'function approve(address spender, uint256 amount) returns (bool)',
];
const routerIface = new Interface(ROUTER_ABI);
export function isNativeAddress(addr) {
    return !addr || addr === ZeroAddress;
}
/** Resolve to the contract address used in router paths (native → WAPE). */
function asPathAddress(addr) {
    return isNativeAddress(addr) ? WAPE_ADDRESS : addr;
}
/** Build an ordered token path for V2 routing. Direct A→B if not native; else A→WAPE→B (or vice-versa). */
export function buildPath(tokenIn, tokenOut) {
    const inAddr = asPathAddress(tokenIn.address);
    const outAddr = asPathAddress(tokenOut.address);
    if (inAddr.toLowerCase() === outAddr.toLowerCase())
        return [inAddr];
    // Direct path is preferred for ERC-20 ↔ ERC-20 if a pool exists; otherwise
    // route via WAPE which is the deepest bridge token on ApeChain.
    if (inAddr.toLowerCase() === WAPE_ADDRESS.toLowerCase() ||
        outAddr.toLowerCase() === WAPE_ADDRESS.toLowerCase()) {
        return [inAddr, outAddr];
    }
    return [inAddr, WAPE_ADDRESS, outAddr];
}
async function tryGetAmountsOut(provider, amountIn, path) {
    try {
        const router = new Contract(CAMELOT_V2_ROUTER, ROUTER_ABI, provider);
        const out = await router.getAmountsOut(amountIn, path);
        if (!out || out.length !== path.length)
            return null;
        return out;
    }
    catch {
        return null;
    }
}
export async function quoteSwap(req) {
    if (req.network !== 'mainnet')
        return null;
    const provider = getProvider(req.network);
    const inN = parseFloat(req.amountIn);
    if (!Number.isFinite(inN) || inN <= 0)
        return null;
    const amountInRaw = parseUnits(req.amountIn, req.tokenIn.decimals);
    // Try the most direct path first (in→out); fall back to in→WAPE→out.
    const inAddr = asPathAddress(req.tokenIn.address);
    const outAddr = asPathAddress(req.tokenOut.address);
    if (inAddr.toLowerCase() === outAddr.toLowerCase())
        return null;
    const candidates = [];
    if (inAddr.toLowerCase() === WAPE_ADDRESS.toLowerCase() ||
        outAddr.toLowerCase() === WAPE_ADDRESS.toLowerCase()) {
        candidates.push({ path: [inAddr, outAddr], direct: true });
    }
    else {
        candidates.push({ path: [inAddr, outAddr], direct: true });
        candidates.push({ path: [inAddr, WAPE_ADDRESS, outAddr], direct: false });
    }
    let best = null;
    for (const c of candidates) {
        const amounts = await tryGetAmountsOut(provider, amountInRaw, c.path);
        if (!amounts)
            continue;
        const out = amounts[amounts.length - 1];
        if (out <= 0n)
            continue;
        if (!best || out > best.amountOut) {
            best = { ...c, amountOut: out };
        }
    }
    if (!best)
        return null;
    const amountInDisplay = formatUnits(amountInRaw, req.tokenIn.decimals);
    const amountOutDisplay = formatUnits(best.amountOut, req.tokenOut.decimals);
    const rate = parseFloat(amountOutDisplay) / parseFloat(amountInDisplay);
    return {
        amountInRaw: amountInRaw.toString(),
        amountOutRaw: best.amountOut.toString(),
        amountInDisplay,
        amountOutDisplay,
        rate,
        path: best.path,
        router: CAMELOT_V2_ROUTER,
        direct: best.direct,
    };
}
const MAX_GAS_PRICE_GWEI = 500n;
async function buildOverrides(provider, base, fromAddress) {
    const fee = await provider.getFeeData();
    const overrides = { ...base };
    if (fee.maxFeePerGas && fee.maxPriorityFeePerGas) {
        overrides.maxFeePerGas = fee.maxFeePerGas;
        overrides.maxPriorityFeePerGas = fee.maxPriorityFeePerGas;
        overrides.type = 2;
    }
    else if (fee.gasPrice) {
        overrides.gasPrice = fee.gasPrice;
    }
    const cap = MAX_GAS_PRICE_GWEI * 10n ** 9n;
    for (const k of ['gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas']) {
        const v = overrides[k];
        if (typeof v === 'bigint' && v > cap) {
            throw new Error(`Network gas price too high (${k} > ${MAX_GAS_PRICE_GWEI} gwei)`);
        }
    }
    // 'pending' nonce so back-to-back queued sends don't collide on nonce.
    if (overrides.nonce == null) {
        overrides.nonce = await provider.getTransactionCount(fromAddress, 'pending');
    }
    return overrides;
}
/**
 * Ensure the router has at least `amount` allowance for tokenIn. Sends an
 * approve tx if not.
 *
 * SECURITY: we approve `amount × 1.5` (rounded up to absorb any rounding /
 * fee-on-transfer slack), NOT `MaxUint256`. Unlimited approvals are the
 * #1 wallet-drainer vector — if the router is ever exploited, every user who
 * granted unlimited approval is drained simultaneously. Bounded approvals
 * mean each swap re-approves just what it needs.
 */
export async function ensureAllowance(network, privateKey, token, amount) {
    if (isNativeAddress(token))
        return null;
    const provider = getProvider(network);
    const wallet = new Wallet(privateKey, provider);
    const erc20 = new Contract(token, ERC20_ABI, wallet);
    const current = await erc20.allowance(wallet.address, CAMELOT_V2_ROUTER);
    // 1.5x to allow for rounding / fee-on-transfer skim. Still bounded.
    const desired = (amount * 3n) / 2n;
    if (current >= desired)
        return null;
    const overrides = await buildOverrides(provider, {}, wallet.address);
    const tx = await erc20.approve(CAMELOT_V2_ROUTER, desired, overrides);
    const receipt = await tx.wait();
    if (!receipt)
        throw new Error('Approval dropped from mempool');
    return { hash: receipt.hash, status: receipt.status === 1 ? 'success' : 'failed' };
}
export async function executeSwap(params) {
    const provider = getProvider(params.network);
    const wallet = new Wallet(params.privateKey, provider);
    const recipient = params.recipient ?? wallet.address;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + (params.deadlineSeconds ?? 600));
    const cfg = NETWORKS[params.network];
    if (params.network !== 'mainnet')
        throw new Error(`Camelot swaps are only available on ${cfg.label}`);
    const path = buildPath(params.tokenIn, params.tokenOut);
    if (path.length < 2)
        throw new Error('Cannot swap a token to itself');
    const amountIn = parseUnits(params.amountIn, params.tokenIn.decimals);
    const expectedOut = parseFloat(params.expectedOut);
    if (!Number.isFinite(expectedOut) || expectedOut <= 0)
        throw new Error('Invalid expected output');
    const slip = Math.max(0, Math.min(2000, params.slippageBps));
    const minOutFloat = (expectedOut * (10000 - slip)) / 10000;
    const minOut = parseUnits(minOutFloat.toFixed(Math.min(18, params.tokenOut.decimals)), params.tokenOut.decimals);
    const isNativeIn = isNativeAddress(params.tokenIn.address);
    const isNativeOut = isNativeAddress(params.tokenOut.address);
    let txData;
    let value = 0n;
    if (isNativeIn && !isNativeOut) {
        txData = routerIface.encodeFunctionData('swapExactETHForTokensSupportingFeeOnTransferTokens', [
            minOut, path, recipient, ZeroAddress, deadline,
        ]);
        value = amountIn;
    }
    else if (!isNativeIn && isNativeOut) {
        txData = routerIface.encodeFunctionData('swapExactTokensForETHSupportingFeeOnTransferTokens', [
            amountIn, minOut, path, recipient, ZeroAddress, deadline,
        ]);
    }
    else if (!isNativeIn && !isNativeOut) {
        txData = routerIface.encodeFunctionData('swapExactTokensForTokensSupportingFeeOnTransferTokens', [
            amountIn, minOut, path, recipient, ZeroAddress, deadline,
        ]);
    }
    else {
        // Both sides native — caller error
        throw new Error('Cannot swap APE for APE');
    }
    const overrides = await buildOverrides(provider, { to: CAMELOT_V2_ROUTER, data: txData, value }, wallet.address);
    // Estimate gas; pad 25% — Camelot's FoT path can vary.
    try {
        const est = await provider.estimateGas({ from: wallet.address, ...overrides });
        overrides.gasLimit = (est * 125n) / 100n;
    }
    catch (e) {
        throw new Error(`Swap simulation failed: ${e.message}`);
    }
    const sent = await wallet.sendTransaction(overrides);
    const receipt = await sent.wait();
    if (!receipt)
        throw new Error('Swap dropped from mempool');
    return {
        hash: receipt.hash,
        status: receipt.status === 1 ? 'success' : 'failed',
        blockNumber: receipt.blockNumber,
        raw: receipt,
    };
}
