import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Page, Screen, TopBar } from '../components/Layout';
import { TokenLogo } from '../components/TokenLogo';
import { TokenPicker } from '../components/TokenPicker';
import { TxStatus } from '../components/TxStatus';
import { useApp } from '../store';
import { rpc } from '@/lib/messaging';
import { isValidEvmAddress } from '@/lib/wallet-utils';
import type { AccountSummary, Erc20Balance, HistoryEntry, SendResult } from '@/lib/evm';
import { isNative, TokenMeta, APE, safeChecksum } from '@/lib/tokens';

const TRACKED_TOKENS_KEY = 'yacht.trackedTokens.v1';
const FEE_BUFFER_APE = 0.01;     // tiny buffer for gas (ApeChain gas is cheap)

export default function Send() {
  const nav = useNavigate();
  const loc = useLocation();
  const { meta } = useApp();
  const active = meta?.publicAccounts.find((a) => a.id === meta?.activeAccountId);
  // Optional preselected token forwarded from /token/:address (Send button).
  const presetToken = (loc.state as { token?: TokenMeta } | null)?.token;
  const [token, setToken] = useState<TokenMeta>(presetToken ?? APE);
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [txMessage, setTxMessage] = useState<string>('');
  const busy = txStatus === 'pending';

  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [tokens, setTokens] = useState<Erc20Balance[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    if (!active) return;
    void (async () => {
      const r = await chrome.storage.local.get(TRACKED_TOKENS_KEY);
      const tracked: string[] = r[TRACKED_TOKENS_KEY] ?? [];
      const [s, balances, h] = await Promise.all([
        rpc({ type: 'evm.account', address: active.address }),
        tracked.length
          ? rpc({ type: 'evm.erc20.balances', tokens: tracked, address: active.address })
          : Promise.resolve([] as Erc20Balance[]),
        rpc({ type: 'evm.history', address: active.address }).catch(() => []),
      ]);
      setSummary(s);
      setTokens(balances);
      setHistory(h);
    })().catch(() => {});
  }, [active?.address]);

  // Address-poisoning detector. Scammers send 0-value txs from a vanity
  // address that matches the prefix+suffix of someone the user has interacted
  // with — the attacker hopes the user copies the wrong address from history.
  // If the recipient prefix+suffix matches an address from history but isn't
  // an exact match, flag it.
  const addressWarning = useMemo(() => {
    const dest = to.trim();
    if (!isValidEvmAddress(dest)) return null;
    const destLc = dest.toLowerCase();
    const prefix = destLc.slice(0, 8);
    const suffix = destLc.slice(-6);
    for (const h of history) {
      for (const t of h.transfers) {
        for (const candidate of [t.from, t.to].filter(Boolean) as string[]) {
          const c = candidate.toLowerCase();
          if (c === destLc) continue;
          if (c.slice(0, 8) === prefix && c.slice(-6) === suffix) {
            return `This address shares the same first/last characters as ${candidate.slice(0, 8)}…${candidate.slice(-6)} in your history but is a DIFFERENT address. This is the classic address-poisoning scam — verify the full address before sending.`;
          }
        }
      }
    }
    return null;
  }, [to, history]);

  const apeBalance = parseFloat(summary?.nativeBalance ?? '0');
  const availableApe = Math.max(0, apeBalance - FEE_BUFFER_APE);

  const spendable = useMemo(() => {
    if (isNative(token)) return availableApe;
    const t = tokens.find((b) => b.token.address.toLowerCase() === token.address.toLowerCase());
    return t ? parseFloat(t.balance) : 0;
  }, [token, availableApe, tokens]);

  const sym = token.symbol;

  const walletTokens: TokenMeta[] = useMemo(
    () => tokens.map((b) => ({
      symbol: b.token.symbol,
      name: b.token.name,
      address: safeChecksum(b.token.address),
      decimals: b.token.decimals,
    })),
    [tokens],
  );

  function setMax() {
    setAmount(trimZeros(spendable.toFixed(6)));
  }

  async function submit() {
    if (!active) return;
    setErr(null);
    try {
      if (!isValidEvmAddress(to.trim())) throw new Error('Invalid destination address');
      const n = parseFloat(amount);
      if (!Number.isFinite(n) || n <= 0) throw new Error('Invalid amount');
      if (n > spendable) throw new Error(`Amount exceeds available ${sym} (${spendable.toFixed(6)})`);

      setTxStatus('pending');
      setTxMessage(`Sending ${amount} ${sym}…`);

      let r: SendResult;
      if (isNative(token)) {
        r = await rpc({
          type: 'evm.send.native',
          from: active.address,
          to: to.trim(),
          amount,
        });
      } else {
        r = await rpc({
          type: 'evm.send.erc20',
          from: active.address,
          token: token.address,
          to: to.trim(),
          amount,
        });
      }
      if (r.status === 'success') {
        setTxStatus('success');
        setTxMessage(`Sent ${amount} ${sym}`);
      } else {
        setTxStatus('error');
        setTxMessage(`Send failed`);
      }
    } catch (e) {
      setTxStatus('error');
      setTxMessage((e as Error).message);
      setErr((e as Error).message);
    }
  }

  const overSpendable = parseFloat(amount || '0') > spendable;

  async function pasteFromClipboard() {
    // Manifest declares "clipboardRead" so navigator.clipboard.readText()
    // works inside the popup. We still wrap in try/catch in case the popup
    // momentarily lacks focus.
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setTo(text.trim());
        return;
      }
    } catch { /* fall through */ }
    // Fallback: focus the address field so the user can Cmd/Ctrl+V manually.
    const input = document.querySelector<HTMLInputElement>('input[placeholder="0x…"]');
    if (input) input.focus();
  }

  return (
    <Screen>
      <TopBar title="Send" />
      <Page>
        <div className="flex items-center justify-between">
          <label className="label !mb-0">To</label>
          <button
            onClick={pasteFromClipboard}
            className="px-3 py-1 rounded-lg text-white font-bold hover:opacity-90"
            style={{ fontSize: 12, backgroundColor: '#f6c87e' }}
          >
            Paste
          </button>
        </div>
        <input
          className="w-full bg-white border-0 rounded-xl px-3 py-2.5 mt-1.5 font-mono font-bold text-ink placeholder:text-ink-faint focus:outline-none"
          style={{ fontSize: 13 }}
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="0x…"
        />

        <label className="label mt-3">Amount</label>
        <div className="bg-bg-card rounded-xl p-3">
          <div className="flex items-center gap-2">
            <input
              className="bg-transparent flex-1 text-2xl font-semibold focus:outline-none w-0 min-w-0"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0"
            />
            <button
              className="flex items-center gap-2 bg-bg-soft border border-line rounded-xl px-2 py-2 hover:border-brand"
              onClick={() => setPickerOpen(true)}
            >
              <TokenLogo token={token} size={24} />
              <span className="text-sm font-medium">{sym.slice(0, 6)}</span>
              <span className="text-ink-dim text-xs">▾</span>
            </button>
          </div>
          <div className="flex items-center justify-between mt-1 text-[11px]">
            <button
              className="px-2 py-0.5 rounded-md bg-brand/10 border border-brand/30 text-brand hover:bg-brand/20 text-[10px] font-medium"
              onClick={setMax}
              disabled={spendable <= 0}
            >
              MAX
            </button>
            <span className={overSpendable ? 'text-danger' : 'text-ink-faint'}>
              Balance: {spendable.toLocaleString(undefined, { maximumFractionDigits: 6 })} {sym}
            </span>
          </div>
          {overSpendable && (
            <div className="mt-1 text-[11px] text-danger">
              Amount exceeds available {sym}.
            </div>
          )}
        </div>

        {addressWarning && (
          <div className="mt-3 p-2 rounded-lg bg-danger/10 border border-danger/30 text-[11px] text-danger">
            ⚠ {addressWarning}
          </div>
        )}

        {err && <div className="text-danger text-xs mt-2">{err}</div>}
        <button
          className="btn w-full mt-4 text-white font-bold bg-[#5eccfa] hover:bg-[#3eb8e8] disabled:opacity-60"
          style={{ fontSize: 17 }}
          disabled={busy || !to || !amount || overSpendable}
          onClick={submit}
        >
          {busy ? 'Submitting…' : `Send ${sym}`}
        </button>

        <TokenPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          walletTokens={walletTokens}
          onPick={(t) => {
            setToken(t);
            setPickerOpen(false);
          }}
        />
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

function trimZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}
