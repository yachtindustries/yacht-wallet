// EVM wallet utilities. ApeChain uses standard Ethereum HD wallets:
// 12-word BIP-39 mnemonic, derive accounts at m/44'/60'/0'/0/i.
import { HDNodeWallet, Mnemonic, Wallet, getAddress, isAddress } from 'ethers';
export const ETH_DERIVATION_BASE = "m/44'/60'/0'/0";
export function generateMnemonic() {
    // Ethers wraps BIP-39: `Mnemonic.fromEntropy(randomBytes(16))` → 12 words.
    return Mnemonic.fromEntropy(crypto.getRandomValues(new Uint8Array(16))).phrase;
}
export function isValidMnemonic(phrase) {
    try {
        Mnemonic.fromPhrase(phrase.trim());
        return true;
    }
    catch {
        return false;
    }
}
export function deriveAccount(mnemonic, index = 0) {
    const path = `${ETH_DERIVATION_BASE}/${index}`;
    const node = HDNodeWallet.fromPhrase(mnemonic.trim(), undefined, path);
    return {
        address: node.address,
        privateKey: node.privateKey,
        derivationPath: path,
        index,
    };
}
// Import from a raw private key (0x-prefixed or not). Returns the canonical
// checksummed address + the 0x-prefixed key.
export function walletFromPrivateKey(privateKey) {
    const trimmed = privateKey.trim();
    const w = new Wallet(trimmed);
    return { address: w.address, privateKey: w.privateKey };
}
export function isValidEvmAddress(a) {
    if (typeof a !== 'string' || !a)
        return false;
    try {
        return isAddress(a.trim());
    }
    catch {
        return false;
    }
}
export function checksumAddress(a) {
    return getAddress(a.trim());
}
export function shortAddress(a, prefix = 6, suffix = 4) {
    if (!a)
        return '';
    if (a.length <= prefix + suffix + 1)
        return a;
    return `${a.slice(0, prefix)}…${a.slice(-suffix)}`;
}
