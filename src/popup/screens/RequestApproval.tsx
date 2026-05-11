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

// Reusable section "card" the approval popup is built from. Each major
// piece of context (where the request comes from, what it costs, what
// it does) sits in its own rounded panel so the popup reads like a
// summary rather than one wall of text.
function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white/5 border border-white/10 px-3.5 py-3 space-y-2">
      {title && (
        <div
          className="font-bold text-white/55 uppercase"
          style={{ fontSize: 11, letterSpacing: '0.08em' }}
        >
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

function KV({
  label,
  value,
  mono,
  highlight,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-white/65 font-bold shrink-0" style={{ fontSize: 13 }}>{label}</span>
      <span
        className={`text-right break-all ${mono ? 'font-mono' : ''} font-bold ${highlight ? 'text-[#5eccfa]' : 'text-white'}`}
        style={{ fontSize: 14 }}
      >
        {value}
      </span>
    </div>
  );
}

function shortAddr(a?: string): string {
  if (!a) return '—';
  return a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

// Pull a wei-denominated max fee out of the unsigned tx if both gas
// fields are populated. dApps usually only set `to`/`data`/`value` and
// leave gas to the wallet, so the fallback string is what most users
// will actually see — the wording matches what other wallets show.
function txFee(tx: UnsignedEvmTx): string {
  const gas = tx.gasLimit ?? tx.gas;
  const price = tx.maxFeePerGas ?? tx.gasPrice;
  if (!gas || !price) return 'Estimated by network';
  try {
    const g = BigInt(gas);
    const p = BigInt(price);
    const wei = g * p;
    const apeStr = formatUnits(wei, 18);
    // 6 decimal places is enough for L3 fees and avoids a 0.0000000001-style tail.
    const trimmed = (() => {
      const n = parseFloat(apeStr);
      if (!isFinite(n) || n === 0) return '0';
      if (n < 0.000001) return n.toExponential(2);
      return n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
    })();
    return `~${trimmed} APE`;
  } catch {
    return 'Estimated by network';
  }
}

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
      <div
        className="p-6 text-center font-bold text-white/85"
        style={{ minHeight: '100vh', backgroundColor: '#002849', fontSize: 14 }}
      >
        Unlock the wallet from the toolbar to approve this request.
      </div>
    );
  }
  if (!req) {
    return (
      <div
        className="p-6 font-bold text-white/85"
        style={{ minHeight: '100vh', backgroundColor: '#002849' }}
      >
        Loading request…
      </div>
    );
  }

  const active = meta?.publicAccounts.find((a) => a.id === meta?.activeAccountId);
  const host = hostFromOrigin(req.origin);
  const verdict = checkHost(host);

  async function approve() {
    if (!req || !active) return;
    setBusy(true);
    setErr(null);
    try {
      // SECURITY: we send only the request ID. The background re-reads its
      // own copy of the pending payload and signs that — never the version
      // this popup is showing. So a compromised popup renderer can't make
      // us sign a different tx than what the user saw.
      await rpc({ type: 'request.approve', id: req.id });
      window.close();
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

  const ctaLabel = busy ? 'Working…' : req.type === 'connect' ? 'Connect' : 'Approve';

  return (
    <div
      className="flex flex-col"
      style={{ backgroundColor: '#002849', minHeight: '100vh' }}
    >
      <div className="flex-1 px-4 pt-4 pb-2 space-y-3">
        {/* Origin header */}
        <div className="text-center">
          <div className="text-white/60 font-bold" style={{ fontSize: 13 }}>Request from</div>
          <div
            className="font-bold break-all text-white inline-flex items-center justify-center gap-1.5 mt-0.5"
            style={{ fontSize: 18 }}
          >
            <span>{host || req.origin}</span>
            {verdict.level === 'verified' && (
              <span className="text-success" style={{ fontSize: 14 }}>✓</span>
            )}
          </div>
          {verdict.level === 'verified' && (
            <div className="text-success mt-1 font-bold" style={{ fontSize: 12 }}>
              Verified ApeChain app
            </div>
          )}
          {verdict.level === 'known-bad' && (
            <div
              className="mt-2 mx-auto inline-block px-3 py-2 rounded-xl bg-danger/20 text-white border border-danger font-bold"
              style={{ fontSize: 13 }}
            >
              ⚠ This domain is on a known phishing list. REJECT this request.
            </div>
          )}
          {verdict.level === 'suspicious' && (
            <div
              className="mt-2 mx-auto px-3 py-2 rounded-xl bg-warn/20 text-white border border-warn space-y-1"
              style={{ fontSize: 13 }}
            >
              <div className="font-bold">⚠ Suspicious domain</div>
              {verdict.reasons.map((r, i) => <div key={i}>• {r}</div>)}
            </div>
          )}
        </div>

        {/* Source: which network, which dApp, which account. */}
        <Section title="Source">
          <KV label="Network" value="ApeChain" />
          <KV label="Request from" value={host || req.origin} />
          {active && (
            <KV
              label="Account"
              value={
                <span>
                  {active.name}
                  <span className="text-white/55 font-mono ml-1.5" style={{ fontSize: 12 }}>
                    {shortAddr(active.address)}
                  </span>
                </span>
              }
            />
          )}
        </Section>

        {/* What the request actually does. The body of each variant
            renders one or two more Section blocks (interaction, value,
            fee, message preview). */}
        {req.type === 'connect' && <ConnectBody />}
        {req.type === 'signTx' && <SignTxBody payload={req.payload} />}
        {req.type === 'personalSign' && <PersonalSignBody payload={req.payload} />}
        {req.type === 'signTypedData' && <TypedDataBody payload={req.payload} />}

        {err && (
          <div
            className="text-white bg-danger/30 rounded-xl px-3 py-2 font-bold border border-danger/50"
            style={{ fontSize: 13 }}
          >
            {err}
          </div>
        )}
      </div>

      {/* Pinned action row with extra breathing room from the bottom. */}
      <div
        className="sticky bottom-0 px-4 pt-3 flex gap-2"
        style={{
          paddingBottom: 24,
          background: 'linear-gradient(180deg, rgba(0,40,73,0) 0%, #002849 35%, #002849 100%)',
        }}
      >
        <button
          className="btn flex-1 font-bold bg-white text-ink hover:bg-white/85 disabled:opacity-60"
          style={{ fontSize: 16, paddingTop: 12, paddingBottom: 12 }}
          onClick={reject}
          disabled={busy}
        >
          Reject
        </button>
        <button
          className="btn btn-shine flex-1 text-white font-bold disabled:opacity-100"
          style={{ fontSize: 16, paddingTop: 12, paddingBottom: 12 }}
          onClick={approve}
          disabled={busy}
        >
          {ctaLabel}
        </button>
      </div>
    </div>
  );
}

function ConnectBody() {
  return (
    <Section title="What this allows">
      <div className="text-white/85 font-bold" style={{ fontSize: 13 }}>
        Share your ApeChain address with this site so it can read your
        balances. Funds cannot move without a separate, explicit signature
        for each transaction.
      </div>
    </Section>
  );
}

function SignTxBody({ payload }: { payload: unknown }) {
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
    try { return BigInt(v); } catch { return 0n; }
  })();
  const valueApe = formatUnits(valueWei, 18);
  const hasData = typeof tx.data === 'string' && tx.data.length > 2 && tx.data !== '0x';
  const known = lookupContract(tx.to);
  const interactingWith = known
    ? known.name
    : labelFor(tx.to) === tx.to
      ? shortAddr(tx.to)
      : labelFor(tx.to);
  const isContract = hasData;

  return (
    <>
      {warnings.length > 0 && (
        <div
          className="rounded-xl bg-warn/15 border border-warn/40 text-warn px-3 py-2 space-y-1 font-bold"
          style={{ fontSize: 13 }}
        >
          {warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
        </div>
      )}

      {p.simulation?.ok === false && (
        <div
          className="rounded-xl bg-danger/15 border border-danger/40 text-danger px-3 py-2 font-bold"
          style={{ fontSize: 13 }}
        >
          Simulation failed{p.simulation.revertReason ? ` — “${p.simulation.revertReason}”` : ''}.
          The transaction will revert and consume gas.
        </div>
      )}

      <Section title={isContract ? 'Action' : 'Send'}>
        <KV label="Type" value={labelFromData ?? (isContract ? 'Contract interaction' : 'Send APE')} />
        <KV label="Interacting with" value={interactingWith} mono={!known} />
        {!isContract && <KV label="Amount" value={`${valueApe} APE`} highlight />}
        {p.dataAnalysis?.spender && (
          <KV
            label="Spender"
            value={`${labelFor(p.dataAnalysis.spender)} ${shortAddr(p.dataAnalysis.spender)}`}
            mono
          />
        )}
        {hasData && <KV label="Data" value={trimMid(tx.data!)} mono />}
      </Section>

      {/* Value box — APE amount the contract will receive (separate from
          the network fee). Only shown for non-zero value. */}
      {valueWei > 0n && isContract && (
        <Section title="Value">
          <KV label="Amount" value={`${valueApe} APE`} highlight />
        </Section>
      )}

      <Section title="Network fee">
        <KV label="Network fee" value={txFee(tx)} />
        <KV label="Estimated speed" value="~2s on ApeChain" />
      </Section>
    </>
  );
}

function PersonalSignBody({ payload }: { payload: unknown }) {
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
    <>
      {p.warnings && p.warnings.length > 0 && (
        <div
          className="rounded-xl bg-danger/15 border border-danger/40 text-danger px-3 py-2 space-y-1 font-bold"
          style={{ fontSize: 13 }}
        >
          {p.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
        </div>
      )}
      <Section title="Sign message">
        <div className="text-white/55 font-bold" style={{ fontSize: 12 }}>personal_sign</div>
        <pre
          className="bg-black/20 border border-white/10 rounded-xl p-3 whitespace-pre-wrap break-words max-h-64 overflow-auto text-white"
          style={{ fontSize: 13 }}
        >
          {display}
        </pre>
      </Section>
    </>
  );
}

function TypedDataBody({ payload }: { payload: unknown }) {
  const p = payload as { typedData: TypedDataPayload; analysis?: TypedDataAnalysis };
  const a = p.analysis;
  return (
    <>
      {a?.isDrainerPattern && (
        <div
          className="rounded-xl bg-danger/15 border border-danger/40 text-danger px-3 py-2 space-y-1 font-bold"
          style={{ fontSize: 13 }}
        >
          <div className="font-bold">⚠ Drainer pattern</div>
          <div>
            This signature is a known type that, once submitted on-chain, lets
            the spender move your assets without any further action from you.
          </div>
        </div>
      )}
      {a?.warnings && a.warnings.length > 0 && (
        <div
          className="rounded-xl bg-warn/15 border border-warn/40 text-warn px-3 py-2 space-y-1 font-bold"
          style={{ fontSize: 13 }}
        >
          {a.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
        </div>
      )}
      <Section title="Sign typed data (EIP-712)">
        <KV label="Type" value={a?.summary ?? a?.primaryType ?? p.typedData.primaryType ?? '—'} />
        {a?.spender && <KV label="Spender" value={shortAddr(a.spender)} mono />}
        {a?.token && <KV label="Token" value={shortAddr(a.token)} mono />}
        {a?.amount && <KV label="Amount" value={a.amount} highlight />}
        {a?.deadline && <KV label="Deadline" value={new Date(a.deadline * 1000).toLocaleString()} />}
      </Section>
    </>
  );
}

function trimMid(s: string): string {
  if (s.length <= 24) return s;
  return `${s.slice(0, 12)}…${s.slice(-8)}`;
}
