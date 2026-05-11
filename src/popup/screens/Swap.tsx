import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { BottomNav, Page, Screen, TopBar } from '../components/Layout';
import { TokenPicker, TokenStats as PickerStats } from '../components/TokenPicker';
import { TokenLogo } from '../components/TokenLogo';
import { TxStatus } from '../components/TxStatus';
import { useApp } from '../store';
import { rpc } from '@/lib/messaging';
import type { AccountSummary, Erc20Balance } from '@/lib/evm';
import type { SwapQuote, SwapToken } from '@/lib/camelot';
import { isNative, TokenMeta, APE, CURTIS, safeChecksum } from '@/lib/tokens';

const TRACKED_TOKENS_KEY = 'yacht.trackedTokens.v1';
const PICKER_STATS_KEY = 'yacht.pickerStats.v1';
const SLIPPAGE_OPTIONS = [50, 100, 300, 500];
const FEE_BUFFER_APE = 0.005;
const swapIconUrl = chrome.runtime.getURL('public/actions/swap.png');
const settingsIconUrl = chrome.runtime.getURL('public/actions/settings.png');
const successSoundUrl = chrome.runtime.getURL('successsound.wav');

// Yacht swaps run through the Camelot V2 router on ApeChain. Camelot is the
// dominant DEX on ApeChain so most listed ERC-20s have liquidity there.

export default function Swap() {
  const loc = useLocation();
  const { meta } = useApp();
  const active = meta?.publicAccounts.find((a) => a.id === meta?.activeAccountId);
  // Optional preselection forwarded from /token/:address (Swap button).
  const presetIn = (loc.state as { tokenIn?: TokenMeta } | null)?.tokenIn;
  const presetOut = (loc.state as { tokenOut?: TokenMeta } | null)?.tokenOut;
  const [tokenA, setTokenA] = useState<TokenMeta>(presetIn ?? APE);
  const [tokenB, setTokenB] = useState<TokenMeta>(presetOut ?? CURTIS);
  const [amountIn, setAmountIn] = useState('');
  const [pickerFor, setPickerFor] = useState<'A' | 'B' | null>(null);

  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);

  const [showSettings, setShowSettings] = useState(false);
  const [slippageBps, setSlippageBps] = useState(100);
  const [customSlip, setCustomSlip] = useState('');
  const [refreshSeconds, setRefreshSeconds] = useState(0);

  const [txStatus, setTxStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [txMessage, setTxMessage] = useState<string>('');
  const submitting = txStatus === 'pending';

  // Fire the celebratory chime the moment the success overlay (water-blue
  // backdrop + check + confetti) appears. Single-shot — no looping. Audio
  // playback may be blocked by the browser if the page hasn't seen a user
  // gesture yet, but a swap requires the user to click "Swap" first so
  // we're always inside a gesture-allowed window when this fires.
  useEffect(() => {
    if (txStatus !== 'success') return;
    try {
      const a = new Audio(successSoundUrl);
      a.volume = 0.6;
      void a.play().catch(() => { /* browser blocked autoplay — silent */ });
    } catch { /* Audio API unavailable */ }
  }, [txStatus]);

  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [tokens, setTokens] = useState<Erc20Balance[]>([]);
  const [tokenAUsd, setTokenAUsd] = useState<number | null>(null);
  const [tokenBUsd, setTokenBUsd] = useState<number | null>(null);
  const [pickerStats, setPickerStats] = useState<Record<string, PickerStats>>({});

  // Read the dashboard's cached balances + prices once, so the TokenPicker
  // can show them without firing any new network requests.
  useEffect(() => {
    chrome.storage.local.get(PICKER_STATS_KEY).then((r) => {
      const v = r[PICKER_STATS_KEY] as Record<string, PickerStats> | undefined;
      if (v) setPickerStats(v);
    }).catch(() => {});
  }, []);

  const debounceRef = useRef<number | null>(null);
  const refreshRef = useRef<number | null>(null);

  async function refreshBalances() {
    if (!active) return;
    const r = await chrome.storage.local.get(TRACKED_TOKENS_KEY);
    const tracked: string[] = r[TRACKED_TOKENS_KEY] ?? [];
    const [s, balances] = await Promise.all([
      rpc({ type: 'evm.account', address: active.address }),
      tracked.length
        ? rpc({ type: 'evm.erc20.balances', tokens: tracked, address: active.address })
        : Promise.resolve([] as Erc20Balance[]),
    ]);
    setSummary(s);
    setTokens(balances);
  }

  useEffect(() => {
    void refreshBalances().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.address]);

  useEffect(() => {
    if (isNative(tokenA)) {
      // dex.token('apecoin') doesn't reliably return an APE-priced ApeChain
      // pair (APE is the native gas token; pools are TOKEN/WAPE). Use the
      // dedicated CoinGecko-backed price.get route for APE.
      rpc({ type: 'price.get' })
        .then((p) => setTokenAUsd(p?.usd ?? null))
        .catch(() => setTokenAUsd(null));
      return;
    }
    rpc({ type: 'dex.token', query: tokenA.address })
      .then((p) => setTokenAUsd(p?.priceUsd ? parseFloat(p.priceUsd) : null))
      .catch(() => setTokenAUsd(null));
  }, [tokenA.address]);

  useEffect(() => {
    if (isNative(tokenB)) {
      rpc({ type: 'price.get' })
        .then((p) => setTokenBUsd(p?.usd ?? null))
        .catch(() => setTokenBUsd(null));
      return;
    }
    const q = tokenB.address;
    rpc({ type: 'dex.token', query: q })
      .then((p) => setTokenBUsd(p?.priceUsd ? parseFloat(p.priceUsd) : null))
      .catch(() => setTokenBUsd(null));
  }, [tokenB.address]);

  const apeBalance = parseFloat(summary?.nativeBalance ?? '0');
  const availableApe = Math.max(0, apeBalance - FEE_BUFFER_APE);

  function balanceOf(t: TokenMeta): number {
    if (isNative(t)) return apeBalance;
    const b = tokens.find((x) => x.token.address.toLowerCase() === t.address.toLowerCase());
    return b ? parseFloat(b.balance) : 0;
  }

  function spendableOf(t: TokenMeta): number {
    if (isNative(t)) return availableApe;
    return balanceOf(t);
  }

  const inputNumber = parseFloat(amountIn || '0');
  const balB = balanceOf(tokenB);
  const spendableA = spendableOf(tokenA);
  const overSpendable = inputNumber > spendableA;
  const sameToken = isNative(tokenA) === isNative(tokenB) &&
    (isNative(tokenA) || tokenA.address.toLowerCase() === tokenB.address.toLowerCase());
  const canQuote = !!active && inputNumber > 0 && !overSpendable && !sameToken;

  function asSwapToken(t: TokenMeta): SwapToken {
    return {
      address: isNative(t) ? '' : safeChecksum(t.address),
      decimals: t.decimals,
      symbol: t.symbol,
    };
  }

  async function refreshQuote() {
    if (!canQuote) return;
    setQuoteErr(null);
    try {
      const q = await rpc({
        type: 'swap.quote',
        tokenIn: asSwapToken(tokenA),
        tokenOut: asSwapToken(tokenB),
        amountIn,
      });
      setQuote(q);
      if (!q) setQuoteErr('No Camelot route found for this pair');
    } catch (e) {
      setQuoteErr((e as Error).message);
      setQuote(null);
    } finally {
      setQuoting(false);
    }
  }

  useEffect(() => {
    if (!active) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (refreshRef.current) window.clearInterval(refreshRef.current);
    setQuote(null);
    setQuoteErr(null);
    if (!canQuote) return;
    setQuoting(true);
    debounceRef.current = window.setTimeout(async () => {
      await refreshQuote();
      setRefreshSeconds(15);
      refreshRef.current = window.setInterval(() => {
        setRefreshSeconds((s) => {
          if (s <= 1) {
            void refreshQuote();
            return 15;
          }
          return s - 1;
        });
      }, 1000);
    }, 400);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      if (refreshRef.current) window.clearInterval(refreshRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.address, tokenA.address, tokenB.address, amountIn]);

  const minReceived = useMemo(() => {
    if (!quote) return null;
    const out = parseFloat(quote.amountOutDisplay);
    return ((out * (10000 - slippageBps)) / 10000).toFixed(6);
  }, [quote, slippageBps]);

  const inUsd = useMemo(
    () => (tokenAUsd != null ? (inputNumber * tokenAUsd).toFixed(2) : null),
    [inputNumber, tokenAUsd],
  );
  const outUsd = useMemo(() => {
    if (!quote) return null;
    const n = parseFloat(quote.amountOutDisplay);
    return tokenBUsd != null ? (n * tokenBUsd).toFixed(2) : null;
  }, [quote, tokenBUsd]);

  const priceImpactPct = useMemo(() => {
    if (!quote || tokenAUsd == null || tokenBUsd == null) return null;
    const outN = parseFloat(quote.amountOutDisplay);
    if (inputNumber <= 0 || outN <= 0) return null;
    const fairOut = (inputNumber * tokenAUsd) / tokenBUsd;
    if (fairOut <= 0) return null;
    return ((fairOut - outN) / fairOut) * 100;
  }, [quote, inputNumber, tokenAUsd, tokenBUsd]);

  function flip() {
    setTokenA(tokenB);
    setTokenB(tokenA);
    setAmountIn('');
    setQuote(null);
  }

  function setFraction(pct: number) {
    const v = spendableA * pct;
    setAmountIn(v > 0 ? trimZeros(v.toFixed(6)) : '0');
  }

  async function doSwap() {
    if (!active || !quote) return;
    setTxStatus('pending');
    setTxMessage(`Swapping ${tokenA.symbol} → ${tokenB.symbol}…`);
    try {
      const r = await rpc({
        type: 'swap.execute',
        account: active.address,
        tokenIn: asSwapToken(tokenA),
        tokenOut: asSwapToken(tokenB),
        amountIn,
        expectedOut: quote.amountOutDisplay,
        slippageBps,
      });
      if (r.swap.status === 'success') {
        // Auto-track the output token so it appears on the dashboard.
        if (!isNative(tokenB)) await trackToken(tokenB.address);
        setTxStatus('success');
        setTxMessage(`Swapped ${tokenA.symbol} → ${tokenB.symbol}`);
        // Refresh balances so Pay/Receive boxes reflect the new amounts
        // immediately, instead of forcing the user to reopen the screen.
        void refreshBalances().catch(() => {});
      } else {
        setTxStatus('error');
        setTxMessage('Swap reverted');
      }
    } catch (e) {
      setTxStatus('error');
      setTxMessage((e as Error).message);
    }
  }

  async function trackToken(addr: string) {
    const r = await chrome.storage.local.get(TRACKED_TOKENS_KEY);
    const list: string[] = r[TRACKED_TOKENS_KEY] ?? [];
    const lower = addr.toLowerCase();
    if (list.some((t) => t.toLowerCase() === lower)) return;
    await chrome.storage.local.set({ [TRACKED_TOKENS_KEY]: [...list, addr] });
  }

  const walletTokens: TokenMeta[] = useMemo(
    () => tokens.map((b) => ({
      symbol: b.token.symbol,
      name: b.token.name,
      address: safeChecksum(b.token.address),
      decimals: b.token.decimals,
    })),
    [tokens],
  );

  const showLowApeWarning = isNative(tokenA) && summary != null && availableApe < 0.001 && apeBalance > 0;

  return (
    <Screen>
      <TopBar
        title="Swap"
        tone="deck"
        right={
          <button
            onClick={() => setShowSettings(true)}
            className="hover:opacity-80"
            aria-label="Swap settings"
          >
            <span
              role="img"
              aria-hidden
              className="block"
              style={{
                width: 20,
                height: 20,
                backgroundColor: '#ffffff',
                WebkitMaskImage: `url(${settingsIconUrl})`,
                maskImage: `url(${settingsIconUrl})`,
                WebkitMaskRepeat: 'no-repeat',
                maskRepeat: 'no-repeat',
                WebkitMaskPosition: 'center',
                maskPosition: 'center',
                WebkitMaskSize: 'contain',
                maskSize: 'contain',
              }}
            />
          </button>
        }
      />
      <Page tone="deck" className="mobile-scale-120">
        {showLowApeWarning && (
          <div className="mb-3 p-3 rounded-xl bg-warn/10 border border-warn/30 text-xs text-warn">
            Low APE balance — leave a small amount for gas.
          </div>
        )}

        <div className="card mb-1">
          <div className="text-[11px] text-ink-dim mb-2 flex justify-between items-center">
            <span>You pay</span>
            <div className="flex items-center gap-1">
              <button
                className="px-2 py-0.5 rounded-md bg-bg-soft border border-line text-ink-dim hover:text-brand hover:border-brand text-[10px]"
                onClick={() => setFraction(0.25)}
                disabled={spendableA <= 0}
              >
                25%
              </button>
              <button
                className="px-2 py-0.5 rounded-md bg-bg-soft border border-line text-ink-dim hover:text-brand hover:border-brand text-[10px]"
                onClick={() => setFraction(0.5)}
                disabled={spendableA <= 0}
              >
                50%
              </button>
              <button
                className="px-2 py-0.5 rounded-md bg-brand/10 border border-brand/30 text-brand hover:bg-brand/20 text-[10px] font-medium"
                onClick={() => setFraction(1)}
                disabled={spendableA <= 0}
              >
                MAX
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              className="bg-transparent flex-1 font-semibold focus:outline-none w-0 min-w-0"
              style={{ fontSize: 30 }}
              inputMode="decimal"
              value={amountIn}
              onChange={(e) => setAmountIn(e.target.value)}
              placeholder="0.0"
            />
            <button
              className="flex items-center gap-2 bg-bg-soft border border-line rounded-xl px-2 py-2 hover:border-brand"
              onClick={() => setPickerFor('A')}
            >
              <TokenLogo token={tokenA} size={31} />
              <span className="font-bold" style={{ fontSize: 16 }}>{tokenA.symbol.slice(0, 6)}</span>
            </button>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-ink-faint" style={{ fontSize: 14 }}>
              {inUsd != null ? `≈ $${inUsd}` : ''}
            </span>
            <span className={`font-bold ${overSpendable ? 'text-danger' : 'text-ink-faint'}`} style={{ fontSize: 14 }}>
              {spendableA.toLocaleString(undefined, { maximumFractionDigits: 3 })}
            </span>
          </div>
          {overSpendable && (
            <div className="mt-1 text-[11px] text-danger">
              Insufficient {tokenA.symbol}.
            </div>
          )}
        </div>

        <div className="flex justify-center -my-3 z-[1] relative">
          <button
            onClick={flip}
            className="rounded-full flex items-center justify-center hover:opacity-90"
            style={{ width: 28, height: 28, backgroundColor: '#5eccfa' }}
            aria-label="Swap tokens"
          >
            <span
              role="img"
              aria-hidden
              className="block"
              style={{
                width: 16,
                height: 16,
                backgroundColor: '#ffffff',
                WebkitMaskImage: `url(${swapIconUrl})`,
                maskImage: `url(${swapIconUrl})`,
                WebkitMaskRepeat: 'no-repeat',
                maskRepeat: 'no-repeat',
                WebkitMaskPosition: 'center',
                maskPosition: 'center',
                WebkitMaskSize: 'contain',
                maskSize: 'contain',
                transform: 'rotate(90deg)',
              }}
            />
          </button>
        </div>

        <div className="card mt-1">
          <div className="text-[11px] text-ink-dim mb-2">
            You receive {quoting && <span className="text-ink-faint">· quoting…</span>}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 font-semibold text-ink" style={{ fontSize: 30 }}>
              {quote ? Number(quote.amountOutDisplay).toLocaleString(undefined, { maximumFractionDigits: 3 }) : '—'}
            </div>
            <button
              className="flex items-center gap-2 bg-bg-soft border border-line rounded-xl px-2 py-2 hover:border-brand"
              onClick={() => setPickerFor('B')}
            >
              <TokenLogo token={tokenB} size={31} />
              <span className="font-bold" style={{ fontSize: 16 }}>{tokenB.symbol.slice(0, 6)}</span>
            </button>
          </div>
          <div className="flex items-center justify-between mt-1 text-ink-faint">
            <span style={{ fontSize: 14 }}>{outUsd != null ? `≈ $${outUsd}` : ''}</span>
            <span className="font-bold" style={{ fontSize: 14 }}>{balB.toLocaleString(undefined, { maximumFractionDigits: 3 })}</span>
          </div>
        </div>

        {quoteErr && <div className="text-danger text-xs mt-3">{quoteErr}</div>}

        <button
          className="btn btn-shine w-full mt-4 text-white font-bold disabled:opacity-60"
          style={{ fontSize: 17 }}
          disabled={!quote || submitting || !canQuote || overSpendable}
          onClick={doSwap}
        >
          {submitting
            ? 'Submitting…'
            : overSpendable
            ? `Insufficient ${tokenA.symbol}`
            : !canQuote
            ? 'Enter an amount'
            : !quote
            ? 'No route'
            : 'Swap'}
        </button>

        {quote && (
          <div className="card mt-3 space-y-1.5 text-xs">
            <Row label="Rate" value={`1 ${tokenA.symbol} ≈ ${quote.rate.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${tokenB.symbol}`} />
            <Row
              label={`Yacht fee (${(quote.feeBps / 100).toFixed(2)}%)`}
              value={`${parseFloat(quote.feeAmountInDisplay).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${tokenA.symbol}`}
              muted
            />
            <Row label="Slippage" value={`${(slippageBps / 100).toFixed(2)}%`} />
            <Row label="Min received" value={`${minReceived ?? '—'} ${tokenB.symbol}`} />
            {priceImpactPct != null && (
              <Row
                label="Price impact"
                value={`${priceImpactPct.toFixed(2)}%`}
                tone={priceImpactPct > 5 ? 'warn' : priceImpactPct > 1 ? 'dim' : 'ok'}
              />
            )}
            <Row label="Route" value={quote.direct ? 'Direct on Camelot' : 'Via WAPE on Camelot'} />
            <Row label="Refreshes in" value={`${refreshSeconds}s`} muted />
          </div>
        )}

        <TokenPicker
          open={pickerFor !== null}
          onClose={() => setPickerFor(null)}
          walletTokens={walletTokens}
          stats={pickerStats}
          exclude={pickerFor === 'A' ? tokenB : tokenA}
          onPick={(t) => {
            if (pickerFor === 'A') setTokenA(t);
            else if (pickerFor === 'B') setTokenB(t);
            setPickerFor(null);
          }}
        />

        {showSettings && (
          <div className="fixed inset-0 bg-black/70 flex items-end z-30" onClick={() => setShowSettings(false)}>
            <div
              className="w-full p-4 rounded-t-2xl"
              style={{ backgroundColor: '#002849' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-white" style={{ fontSize: 24 }}>Slippage</h3>
                <button
                  onClick={() => setShowSettings(false)}
                  className="text-white font-extrabold leading-none hover:opacity-80"
                  style={{ fontSize: 28 }}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <div className="grid grid-cols-5 gap-2 mb-3">
                {SLIPPAGE_OPTIONS.map((bps) => (
                  <button
                    key={bps}
                    onClick={() => { setSlippageBps(bps); setCustomSlip(''); }}
                    className={`py-2 rounded-xl font-bold ${
                      slippageBps === bps && !customSlip
                        ? 'bg-[#5eccfa] text-white'
                        : 'bg-white text-black'
                    }`}
                    style={{ fontSize: 16 }}
                  >
                    {(bps / 100).toFixed(bps < 100 ? 1 : 0)}%
                  </button>
                ))}
                <input
                  className="w-full rounded-xl bg-white px-3 py-2 font-bold text-black placeholder:text-black/60 focus:outline-none"
                  style={{ fontSize: 16 }}
                  placeholder="Custom"
                  inputMode="decimal"
                  value={customSlip}
                  onChange={(e) => {
                    setCustomSlip(e.target.value);
                    const n = parseFloat(e.target.value);
                    if (!Number.isNaN(n) && n > 0 && n <= 5) setSlippageBps(Math.round(n * 100));
                  }}
                />
              </div>
              {slippageBps >= 300 && (
                <div className="text-danger text-xs mb-3 font-bold">
                  High slippage ({(slippageBps / 100).toFixed(2)}%) — your trade may be sandwiched by MEV bots.
                </div>
              )}
              <button
                className="btn w-full text-white font-bold bg-[#5eccfa] hover:bg-[#3eb8e8]"
                onClick={() => setShowSettings(false)}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </Page>
      <BottomNav />
      {txStatus !== 'idle' && (
        <TxStatus
          status={txStatus}
          message={txMessage}
          onDismiss={() => {
            // Stay on the Swap menu so the user can swap again immediately.
            // Reset the input so they're not staring at the last amount.
            setTxStatus('idle');
            setAmountIn('');
            setQuote(null);
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

function Row({ label, value, muted, tone }: { label: string; value: string; muted?: boolean; tone?: 'ok' | 'warn' | 'dim' }) {
  const valColor = tone === 'warn' ? 'text-warn' : tone === 'dim' ? 'text-ink-dim' : 'text-ink';
  return (
    <div className={`flex justify-between ${muted ? 'text-ink-faint' : ''}`}>
      <span className="text-ink-dim">{label}</span>
      <span className={`font-mono ${valColor}`}>{value}</span>
    </div>
  );
}
