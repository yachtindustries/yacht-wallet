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
import type { TypedDataPayload, UnsignedEvmTx } from '@/lib/messaging';

// The inpage provider is injected as its own MAIN-world content script (see
// manifest.config.ts), not via a manually-appended <script>. This avoids the
// MIME-type rejection Chrome enforces for module scripts and lets crxjs
// bundle the inpage source correctly.

const RPC_PREFIX = 'yacht.dapp';

window.addEventListener('message', async (event) => {
  if (event.source !== window) return;
  if (event.origin !== window.location.origin) return;
  const data = event.data;
  if (!data || data.kind !== `${RPC_PREFIX}.request`) return;
  if (typeof data.id !== 'string' || typeof data.method !== 'string') return;

  const reply = (ok: boolean, payload: any) => {
    window.postMessage(
      ok
        ? { kind: `${RPC_PREFIX}.reply`, id: data.id, ok: true, result: payload }
        : { kind: `${RPC_PREFIX}.reply`, id: data.id, ok: false, error: sanitizeErr(payload) },
      window.location.origin,
    );
  };

  try {
    switch (data.method) {
      case 'eth_requestAccounts':
      case 'wallet_requestPermissions':
      case 'connect': {
        const r = await rpc({ type: 'dapp.connect' });
        // EIP-1193 returns an address array for eth_requestAccounts
        if (data.method === 'eth_requestAccounts') return reply(true, [r.address]);
        if (data.method === 'wallet_requestPermissions') {
          return reply(true, [{ parentCapability: 'eth_accounts', caveats: [{ type: 'restrictReturnedAccounts', value: [r.address] }] }]);
        }
        return reply(true, r);
      }
      case 'eth_accounts': {
        try {
          const r = await rpc({ type: 'dapp.getAddress' });
          return reply(true, [r.address]);
        } catch {
          return reply(true, []);
        }
      }
      case 'eth_chainId':
      case 'net_version': {
        try {
          const r = await rpc({ type: 'dapp.getAddress' });
          if (data.method === 'eth_chainId') return reply(true, r.chainId);
          return reply(true, String(parseInt(r.chainId, 16)));
        } catch {
          // Default to ApeChain mainnet when no connection is established.
          if (data.method === 'eth_chainId') return reply(true, '0x8173');
          return reply(true, '33139');
        }
      }
      case 'eth_sendTransaction': {
        const tx = (data.params?.[0] ?? data.params) as UnsignedEvmTx;
        if (!tx || typeof tx !== 'object') return reply(false, 'Invalid transaction');
        const r = await rpc({ type: 'dapp.signTx', tx });
        return reply(true, r.hash);
      }
      case 'personal_sign': {
        const params = data.params as any[];
        // Standard EIP-1193 order is [message, address]. MetaMask
        // historically also accepts the reversed [address, message]
        // and a number of older dApps still ship that form. We pick the
        // arg that ISN'T a 20-byte address and treat it as the message
        // — so a reversed call never ends up signing the address bytes.
        const a = typeof params?.[0] === 'string' ? params[0] : '';
        const b = typeof params?.[1] === 'string' ? params[1] : '';
        const isAddr = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);
        let message = '';
        if (a && b) {
          if (isAddr(b) && !isAddr(a)) message = a;       // standard
          else if (isAddr(a) && !isAddr(b)) message = b;  // reversed
          else message = a;                                // both/neither
        } else {
          message = a || b;
        }
        if (!message) return reply(false, 'Invalid message');
        const r = await rpc({ type: 'dapp.personalSign', message });
        return reply(true, r.signature);
      }
      case 'eth_signTypedData_v4':
      case 'eth_signTypedData': {
        const params = data.params as any[];
        const raw = typeof params?.[1] === 'string' ? params[1] : params?.[1];
        let payload: TypedDataPayload;
        try {
          payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch {
          return reply(false, 'Invalid typed data JSON');
        }
        if (!payload?.domain || !payload?.types || !payload?.message) {
          return reply(false, 'Invalid typed data payload');
        }
        const r = await rpc({ type: 'dapp.signTypedData', payload });
        return reply(true, r.signature);
      }
      case 'wallet_switchEthereumChain': {
        const params = data.params?.[0] as { chainId?: string } | undefined;
        if (params?.chainId === '0x8173') return reply(true, null);
        return reply(false, 'Yacht only supports ApeChain (chainId 0x8173)');
      }
      case 'wallet_addEthereumChain': {
        // Yacht is single-chain ApeChain. The wallet uses its own RPC
        // regardless of what the dApp suggests, so the dApp's rpcUrls /
        // explorer / iconUrls fields are advisory only — they cannot
        // change which RPC Yacht hits, and they cannot trick the wallet
        // into trusting a malicious URL because the wallet never reads
        // them. We therefore accept this call as long as the chain is
        // ApeChain and the native currency (if specified) is APE.
        // Refusing on rpcUrls mismatch was the historical implementation
        // and broke OpenSea, which uses the Conduit RPC.
        const params = data.params?.[0] as {
          chainId?: string;
          nativeCurrency?: { symbol?: string; decimals?: number };
        } | undefined;
        if (params?.chainId !== '0x8173') {
          return reply(false, 'Yacht only supports ApeChain (chainId 0x8173)');
        }
        const sym = params.nativeCurrency?.symbol;
        if (sym && sym !== 'APE') {
          return reply(false, 'ApeChain native currency must be APE');
        }
        return reply(true, null);
      }
      case 'getAddress': {
        const r = await rpc({ type: 'dapp.getAddress' });
        return reply(true, r);
      }
      // Explicit refusals — these methods exist in the EIP-1193 spec but we
      // intentionally do not implement them.
      case 'eth_sign':
        // Pre-EIP-191 raw signing. Drainer vector. No good wallet supports it.
        return reply(false, 'eth_sign is unsafe and not supported. Use personal_sign instead.');
      case 'eth_signTransaction':
        // Yacht signs and sends in one step. Standalone signing without
        // submission isn't part of our flow.
        return reply(false, 'eth_signTransaction is not supported. Use eth_sendTransaction.');
      default: {
        // Read-only chain RPC passthrough (eth_getBalance, eth_estimateGas,
        // eth_call, eth_getLogs, eth_blockNumber, etc). The background
        // enforces a method whitelist and origin approval. Anything outside
        // the whitelist comes back as "Method not supported".
        try {
          const r = await rpc({ type: 'dapp.rpc', method: data.method, params: data.params });
          return reply(true, r);
        } catch (e) {
          return reply(false, sanitizeErr(e));
        }
      }
    }
  } catch (e) {
    reply(false, e);
  }
});

function sanitizeErr(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return 'Wallet error';
}
