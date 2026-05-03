// Content script — bridges the page's window.ethereum (Yacht) with the
// background service worker.
//
// Trust boundary: messages arriving from the page over postMessage are
// adversary-controlled. We:
//  • verify event.source === window (rejects iframe/parent)
//  • verify event.origin === window.location.origin (no cross-origin postMessage)
//  • never forward an "origin" string to the background (background uses sender.origin)
//  • sanitize errors before sending back to the page
import { rpc } from '@/lib/messaging';
// The inpage provider is injected as its own MAIN-world content script (see
// manifest.config.ts), not via a manually-appended <script>. This avoids the
// MIME-type rejection Chrome enforces for module scripts and lets crxjs
// bundle the inpage source correctly.
const RPC_PREFIX = 'yacht.dapp';
window.addEventListener('message', async (event) => {
    if (event.source !== window)
        return;
    if (event.origin !== window.location.origin)
        return;
    const data = event.data;
    if (!data || data.kind !== `${RPC_PREFIX}.request`)
        return;
    if (typeof data.id !== 'string' || typeof data.method !== 'string')
        return;
    const reply = (ok, payload) => {
        window.postMessage(ok
            ? { kind: `${RPC_PREFIX}.reply`, id: data.id, ok: true, result: payload }
            : { kind: `${RPC_PREFIX}.reply`, id: data.id, ok: false, error: sanitizeErr(payload) }, window.location.origin);
    };
    try {
        switch (data.method) {
            case 'eth_requestAccounts':
            case 'wallet_requestPermissions':
            case 'connect': {
                const r = await rpc({ type: 'dapp.connect' });
                // EIP-1193 returns an address array for eth_requestAccounts
                if (data.method === 'eth_requestAccounts')
                    return reply(true, [r.address]);
                if (data.method === 'wallet_requestPermissions') {
                    return reply(true, [{ parentCapability: 'eth_accounts', caveats: [{ type: 'restrictReturnedAccounts', value: [r.address] }] }]);
                }
                return reply(true, r);
            }
            case 'eth_accounts': {
                try {
                    const r = await rpc({ type: 'dapp.getAddress' });
                    return reply(true, [r.address]);
                }
                catch {
                    return reply(true, []);
                }
            }
            case 'eth_chainId':
            case 'net_version': {
                try {
                    const r = await rpc({ type: 'dapp.getAddress' });
                    if (data.method === 'eth_chainId')
                        return reply(true, r.chainId);
                    return reply(true, String(parseInt(r.chainId, 16)));
                }
                catch {
                    // Default to ApeChain mainnet when no connection is established.
                    if (data.method === 'eth_chainId')
                        return reply(true, '0x8173');
                    return reply(true, '33139');
                }
            }
            case 'eth_sendTransaction': {
                const tx = (data.params?.[0] ?? data.params);
                if (!tx || typeof tx !== 'object')
                    return reply(false, 'Invalid transaction');
                const r = await rpc({ type: 'dapp.signTx', tx });
                return reply(true, r.hash);
            }
            case 'personal_sign': {
                const params = data.params;
                // EIP-1193 personal_sign argument order: [message, address] (some
                // wallets reverse). We forward the message and let the user approve.
                const message = typeof params?.[0] === 'string' ? params[0] : typeof params?.[1] === 'string' ? params[1] : '';
                if (!message)
                    return reply(false, 'Invalid message');
                const r = await rpc({ type: 'dapp.personalSign', message });
                return reply(true, r.signature);
            }
            case 'eth_signTypedData_v4':
            case 'eth_signTypedData': {
                const params = data.params;
                const raw = typeof params?.[1] === 'string' ? params[1] : params?.[1];
                let payload;
                try {
                    payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
                }
                catch {
                    return reply(false, 'Invalid typed data JSON');
                }
                if (!payload?.domain || !payload?.types || !payload?.message) {
                    return reply(false, 'Invalid typed data payload');
                }
                const r = await rpc({ type: 'dapp.signTypedData', payload });
                return reply(true, r.signature);
            }
            case 'wallet_switchEthereumChain': {
                const params = data.params?.[0];
                if (params?.chainId === '0x8173')
                    return reply(true, null);
                return reply(false, 'Yacht only supports ApeChain (chainId 0x8173)');
            }
            case 'wallet_addEthereumChain': {
                // Yacht is single-chain ApeChain. We accept the call only if the
                // dApp supplies the correct ApeChain config — otherwise we refuse
                // (so a dApp can't trick us into "approving" a malicious RPC URL by
                // bundling it under chainId 0x8173).
                const params = data.params?.[0];
                if (params?.chainId !== '0x8173') {
                    return reply(false, 'Yacht only supports ApeChain (chainId 0x8173)');
                }
                const sym = params.nativeCurrency?.symbol;
                if (sym && sym !== 'APE') {
                    return reply(false, 'ApeChain native currency must be APE');
                }
                const rpcs = params.rpcUrls ?? [];
                if (rpcs.length > 0 && !rpcs.some((u) => u === 'https://rpc.apechain.com')) {
                    return reply(false, 'ApeChain RPC must be https://rpc.apechain.com (Yacht ignores dApp-supplied RPCs)');
                }
                return reply(true, null);
            }
            case 'getAddress': {
                const r = await rpc({ type: 'dapp.getAddress' });
                return reply(true, r);
            }
            default:
                return reply(false, `Method not supported: ${data.method}`);
        }
    }
    catch (e) {
        reply(false, e);
    }
});
function sanitizeErr(e) {
    if (e instanceof Error)
        return e.message;
    if (typeof e === 'string')
        return e;
    return 'Wallet error';
}
