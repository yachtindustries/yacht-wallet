import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { formatUnits } from 'ethers';
import { rpc } from '@/lib/messaging';
import { useApp } from '../store';
import type { PendingRequest, TypedDataPayload, UnsignedEvmTx } from '@/lib/messaging';
import { hostFromOrigin } from '@/lib/security';
import { checkHost } from '@/lib/phishing';
import type { TxDataAnalysis, TypedDataAnalysis } from '@/lib/signing-detect';
import type { SimulationResult } from '@/lib/evm';
import { labelFor, lookupContract } from '@/lib/known-contracts';

export default function RequestApproval() {
  const { id } = useParams<{ id: string }>();
  const { meta, unlocked } = useApp();
  const [req, setReq] = useState<PendingRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    rpc({ type: 'request.get', id }).then(setReq);
  }, [id]);

  if (!id) return null;
  if (!unlocked) {
    return (
      <div className="p-6 text-center text-sm text-ink-dim">
        Unlock the wallet from the toolbar to approve this request.
      </div>
    );
  }
  if (!req) return <div className="p-6 text-ink-dim">Loading request…</div>;

  const active = meta?.publicAccounts.find((a) => a.id === meta?.activeAccountId);
  const host = hostFromOrigin(req.origin);
  const verdict = checkHost(host);

  async function approve() {
    if (!req || !active) return;
    setBusy(true);
    setErr(null);
    try {
      if (req.type === 'connect') {
        await rpc({ type: 'request.resolve', id: req.id, result: { address: active.address, chainId: '0x8173' } });
        window.close();
      } else if (req.type === 'signTx') {
        const tx = (req.payload as { tx: UnsignedEvmTx }).tx;
        const r = await rpc({ type: 'evm.sign.tx', account: active.address, tx });
        await rpc({ type: 'request.resolve', id: req.id, result: r });
        window.close();
      } else if (req.type === 'personalSign') {
        const message = (req.payload as { message: string }).message;
        const r = await rpc({ type: 'evm.sign.message', account: active.address, message });
        await rpc({ type: 'request.resolve', id: req.id, result: r });
        window.close();
      } else if (req.type === 'signTypedData') {
        const payload = (req.payload as { typedData: TypedDataPayload }).typedData;
        const r = await rpc({ type: 'evm.sign.typedData', account: active.address, payload });
        await rpc({ type: 'request.resolve', id: req.id, result: r });
        window.close();
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!req) return;
    await rpc({ type: 'request.reject', id: req.id, error: 'User rejected' });
    window.close();
  }

  return (
    <div className="p-4 flex flex-col h-full">
      <div className="text-center mb-3">
        <div className="text-xs text-ink-dim">Request from</div>
        <div className="text-sm font-medium break-all flex items-center justify-center gap-1">
          <span>{host || req.origin}</span>
          {verdict.level === 'verified' && <span className="text-success text-xs">✓</span>}
        </div>
        {verdict.level === 'verified' && (
          <div className="text-[11px] text-success mt-1">Verified ApeChain app</div>
        )}
        {verdict.level === 'known-bad' && (
          <div className="mt-2 mx-auto inline-block px-3 py-2 rounded-md bg-danger/10 text-danger border border-danger/30 text-[11px]">
            ⚠ This domain is on a known phishing list. REJECT this request.
          </div>
        )}
        {verdict.level === 'suspicious' && (
          <div className="mt-2 mx-auto px-3 py-2 rounded-md bg-warn/10 text-warn border border-warn/30 text-[11px] space-y-1">
            <div className="font-medium">⚠ Suspicious domain</div>
            {verdict.reasons.map((r, i) => <div key={i}>• {r}</div>)}
          </div>
        )}
      </div>

      {req.type === 'connect' && (
        <div className="card flex-1">
          <h2 className="text-base font-semibold mb-2">Connect wallet</h2>
          <p className="text-sm text-ink-dim">
            This site is requesting your ApeChain address. It cannot move funds without a separate, explicit approval for each transaction.
          </p>
          {active && (
            <div className="mt-4 p-3 rounded-xl bg-bg-soft border border-line">
              <div className="text-xs text-ink-dim">Account</div>
              <div className="text-sm font-medium">{active.name}</div>
              <div className="font-mono text-[11px] text-ink-faint break-all">{active.address}</div>
            </div>
          )}
        </div>
      )}

      {req.type === 'signTx' && <SignTxPanel payload={req.payload} />}
      {req.type === 'personalSign' && <PersonalSignPanel payload={req.payload} />}
      {req.type === 'signTypedData' && <TypedDataPanel payload={req.payload} />}

      {err && <div className="text-danger text-xs mt-2">{err}</div>}
      <div className="flex gap-2 mt-3">
        <button className="btn-ghost flex-1" onClick={reject} disabled={busy}>Reject</button>
        <button className="btn-primary flex-1" onClick={approve} disabled={busy}>
          {busy ? 'Working…' : req.type === 'connect' ? 'Connect' : 'Approve'}
        </button>
      </div>
    </div>
  );
}

function SignTxPanel({ payload }: { payload: unknown }) {
  const p = payload as {
    tx: UnsignedEvmTx;
    warnings?: string[];
    dataAnalysis?: TxDataAnalysis;
    simulation?: SimulationResult;
  };
  const tx = p.tx;
  const warnings = p.warnings ?? [];
  const labelFromData = p.dataAnalysis?.label;

  const valueWei = (() => {
    const v = tx.value;
    if (v == null) return 0n;
    try {
      if (typeof v === 'string') return v.startsWith('0x') ? BigInt(v) : BigInt(v);
      return BigInt(v as any);
    } catch {
      return 0n;
    }
  })();
  const valueApe = formatUnits(valueWei, 18);
  const hasData = typeof tx.data === 'string' && tx.data.length > 2 && tx.data !== '0x';
  const toLabel = labelFor(tx.to);
  const known = lookupContract(tx.to);

  return (
    <div className="card flex-1 overflow-y-auto">
      <h2 className="text-base font-semibold mb-1">
        {labelFromData ?? (hasData ? 'Contract interaction' : 'Send APE')}
      </h2>
      <div className="text-[11px] text-ink-faint mb-3">Sign transaction</div>

      {warnings.length > 0 && (
        <div className="mb-3 p-2 rounded-lg bg-warn/10 border border-warn/30 text-[11px] text-warn space-y-1">
          {warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
        </div>
      )}

      {p.simulation?.ok === false && (
        <div className="mb-3 p-2 rounded-lg bg-danger/10 border border-danger/30 text-[11px] text-danger">
          Simulation failed{p.simulation.revertReason ? ` — “${p.simulation.revertReason}”` : ''}. The transaction will revert and consume gas.
        </div>
      )}

      <div className="space-y-1.5 text-xs">
        <Row label="To" value={toLabel === tx.to ? (tx.to ?? '—') : `${known?.name} (${tx.to})`} mono />
        <Row label="Value" value={`${valueApe} APE`} />
        {p.dataAnalysis?.spender && (
          <Row label="Spender" value={`${labelFor(p.dataAnalysis.spender)} ${p.dataAnalysis.spender}`} mono />
        )}
        {hasData && <Row label="Data" value={trimMid(tx.data!)} mono />}
      </div>

      <details className="mt-3">
        <summary className="text-[11px] text-ink-faint cursor-pointer">Raw transaction</summary>
        <pre className="text-[10px] bg-bg-soft border border-line rounded-xl p-2 overflow-auto font-mono whitespace-pre-wrap mt-1 max-h-48">
          {JSON.stringify(tx, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function PersonalSignPanel({ payload }: { payload: unknown }) {
  const p = payload as { message: string; warnings?: string[]; isRawHash?: boolean };
  let display = p.message;
  if (typeof display === 'string' && display.startsWith('0x')) {
    try {
      const bytes = display.slice(2).match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) ?? [];
      const decoded = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
      if (decoded && /^[\x20-\x7E\s]*$/.test(decoded)) display = decoded;
    } catch { /* keep hex */ }
  }
  return (
    <div className="card flex-1 overflow-y-auto">
      <h2 className="text-base font-semibold mb-1">Sign message</h2>
      <div className="text-[11px] text-ink-faint mb-3">personal_sign</div>
      {p.warnings && p.warnings.length > 0 && (
        <div className="mb-3 p-2 rounded-lg bg-danger/10 border border-danger/30 text-[11px] text-danger space-y-1">
          {p.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
        </div>
      )}
      <pre className="text-xs bg-bg-soft border border-line rounded-xl p-3 whitespace-pre-wrap break-words max-h-64 overflow-auto">
        {display}
      </pre>
    </div>
  );
}

function TypedDataPanel({ payload }: { payload: unknown }) {
  const p = payload as { typedData: TypedDataPayload; analysis?: TypedDataAnalysis };
  const a = p.analysis;
  return (
    <div className="card flex-1 overflow-y-auto">
      <h2 className="text-base font-semibold mb-1">{a?.summary ?? 'Sign typed data (EIP-712)'}</h2>
      <div className="text-[11px] text-ink-faint mb-3">{a?.primaryType ?? p.typedData.primaryType ?? '—'}</div>

      {a?.isDrainerPattern && (
        <div className="mb-3 p-2 rounded-lg bg-danger/10 border border-danger/30 text-[11px] text-danger space-y-1">
          <div className="font-medium">⚠ Drainer pattern</div>
          <div>This signature is a known type that, once submitted on-chain, lets the spender move your assets without any further action from you.</div>
        </div>
      )}

      {a?.warnings && a.warnings.length > 0 && (
        <div className="mb-3 p-2 rounded-lg bg-warn/10 border border-warn/30 text-[11px] text-warn space-y-1">
          {a.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
        </div>
      )}

      {a?.spender && (
        <Row label="Spender" value={`${labelFor(a.spender)}${labelFor(a.spender) !== a.spender ? ` (${a.spender})` : ''}`} mono />
      )}
      {a?.token && <Row label="Token" value={a.token} mono />}
      {a?.amount && <Row label="Amount" value={a.amount} />}
      {a?.deadline && <Row label="Deadline" value={new Date(a.deadline * 1000).toLocaleString()} />}

      <details className="mt-3">
        <summary className="text-[11px] text-ink-faint cursor-pointer">Raw typed data</summary>
        <pre className="text-[10px] bg-bg-soft border border-line rounded-xl p-2 overflow-auto font-mono whitespace-pre-wrap max-h-64">
          {JSON.stringify(p.typedData, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 text-xs">
      <span className="text-ink-dim shrink-0">{label}</span>
      <span className={`text-right break-all ${mono ? 'font-mono' : ''} text-ink`}>{value}</span>
    </div>
  );
}

function trimMid(s: string): string {
  if (s.length <= 24) return s;
  return `${s.slice(0, 12)}…${s.slice(-8)}`;
}
