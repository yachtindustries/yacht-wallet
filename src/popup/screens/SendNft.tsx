import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Page, Screen, TopBar } from '../components/Layout';
import { TxStatus } from '../components/TxStatus';
import { useApp } from '../store';
import { rpc } from '@/lib/messaging';
import { isValidEvmAddress } from '@/lib/wallet-utils';
import type { SendResult } from '@/lib/evm';

/**
 * Send a single NFT to another address. The dashboard's NFT-cell hover
 * popover navigates here with `?contract=…&tokenId=…&image=…&name=…`.
 *
 * The transfer goes through `safeTransferFrom` so the wallet refuses to
 * send to a contract that doesn't implement IERC721Receiver — protecting
 * the user from accidentally locking the NFT in a non-NFT-aware contract.
 */
export default function SendNft() {
  const nav = useNavigate();
  const loc = useLocation();
  const { meta } = useApp();
  const active = meta?.publicAccounts.find((a) => a.id === meta?.activeAccountId);

  const params = useMemo(() => new URLSearchParams(loc.search), [loc.search]);
  const contract = params.get('contract') ?? '';
  const tokenId = params.get('tokenId') ?? '';
  const image = params.get('image') ?? '';
  const name = params.get('name') ?? '';
  const collection = params.get('collection') ?? '';

  const [to, setTo] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [txMessage, setTxMessage] = useState<string>('');
  const busy = txStatus === 'pending';

  const display = name || (collection ? `${collection} #${shortenTokenId(tokenId)}` : `#${shortenTokenId(tokenId)}`);

  async function submit() {
    if (!active) return;
    setErr(null);
    try {
      if (!isValidEvmAddress(to.trim())) throw new Error('Invalid destination address');
      if (!contract || !tokenId) throw new Error('Missing NFT identity');
      setTxStatus('pending');
      setTxMessage(`Sending ${display}…`);
      const r: SendResult = await rpc({
        type: 'evm.send.nft',
        from: active.address,
        contract,
        tokenId,
        to: to.trim(),
      });
      if (r.status === 'success') {
        setTxStatus('success');
        setTxMessage(`Sent ${display}`);
      } else {
        setTxStatus('error');
        setTxMessage('Transfer failed on-chain');
      }
    } catch (e) {
      setTxStatus('error');
      setTxMessage((e as Error).message);
      setErr((e as Error).message);
    }
  }

  return (
    <Screen>
      <TopBar title="Send NFT" />
      <Page>
        <div className="card mb-3 flex items-center gap-3">
          {image ? (
            <img
              src={image}
              alt={display}
              className="rounded-xl object-cover shrink-0"
              style={{ width: 72, height: 72 }}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <div
              className="rounded-xl bg-bg-soft border border-line shrink-0 flex items-center justify-center"
              style={{ width: 72, height: 72 }}
            >
              <span className="font-bold text-ink-faint" style={{ fontSize: 12 }}>NFT</span>
            </div>
          )}
          <div className="min-w-0">
            <div className="font-bold truncate" style={{ fontSize: 16 }}>{display}</div>
            {collection && name && (
              <div className="text-ink-faint truncate font-bold" style={{ fontSize: 13 }}>{collection}</div>
            )}
            <div className="text-ink-faint font-mono truncate font-bold" style={{ fontSize: 12 }}>
              {contract.slice(0, 6)}…{contract.slice(-4)} #{shortenTokenId(tokenId)}
            </div>
          </div>
        </div>

        <label className="label">Recipient address</label>
        <input
          className="input font-mono"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="0x…"
          autoComplete="off"
          spellCheck={false}
        />

        {err && (
          <div className="mt-3 px-3 py-2 rounded-xl bg-danger/15 border border-danger/40 text-danger font-bold" style={{ fontSize: 13 }}>
            {err}
          </div>
        )}

        <button
          className="btn btn-shine w-full mt-4 text-white font-bold disabled:opacity-60"
          style={{ fontSize: 18 }}
          disabled={busy || !to.trim() || !isValidEvmAddress(to.trim())}
          onClick={submit}
        >
          {busy ? 'Sending…' : 'Send NFT'}
        </button>
      </Page>
      {txStatus !== 'idle' && (
        <TxStatus
          status={txStatus}
          message={txMessage}
          onDismiss={() => {
            const wasSuccess = txStatus === 'success';
            setTxStatus('idle');
            if (wasSuccess) nav('/');
          }}
        />
      )}
    </Screen>
  );
}

function shortenTokenId(id: string): string {
  if (!id) return '';
  return id.length > 8 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
}
