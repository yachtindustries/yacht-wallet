import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen, TopBar, Page } from '../components/Layout';
import { PasswordField } from '../components/PasswordField';
import { CopyButton } from '../components/Copy';
import { rpc } from '@/lib/messaging';
import { passwordStrength } from '@/lib/security';
import { useApp } from '../store';

const MIN_PASSWORD_LEN = 12;

type Step = 'password' | 'showSeed' | 'confirm';

export default function CreateWallet() {
  const nav = useNavigate();
  const { refreshStatus, setBackupNotice } = useApp();
  const [step, setStep] = useState<Step>('password');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  async function createWallet() {
    setErr(null);
    setBusy(true);
    try {
      const r = await rpc({ type: 'vault.create.new', password: pw });
      setMnemonic(r.mnemonic);
      setStep('showSeed');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function finalize() {
    setBackupNotice(true);
    await refreshStatus();
    nav('/');
  }

  const strength = passwordStrength(pw).score;
  const tooShort = pw.length < MIN_PASSWORD_LEN;
  const tooWeak = strength < 2;
  const mismatch = pw !== pw2;
  const disabled = busy || tooShort || tooWeak || mismatch;

  if (step === 'password') {
    return (
      <Screen>
        <TopBar title="Create wallet" onBack={() => nav('/')} />
        <Page>
          <h2 className="text-lg font-semibold mb-4 text-white">Set a password</h2>
          <label className="label">Password</label>
          <div className="mb-3">
            <PasswordField value={pw} onChange={setPw} autoFocus showStrength />
          </div>
          <label className="label">Confirm password</label>
          <input
            className="input mb-4"
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
          />
          {err && <div className="text-danger text-xs mb-2">{err}</div>}
          <button
            className="btn btn-shine w-full text-white font-bold disabled:opacity-100 flex items-center justify-center"
            style={{ minHeight: 44 }}
            disabled={disabled}
            onClick={createWallet}
          >
            {busy ? <Spinner /> : 'Continue'}
          </button>
        </Page>
      </Screen>
    );
  }

  if (step === 'showSeed' && mnemonic) {
    const words = mnemonic.split(/\s+/);
    return (
      <Screen>
        <TopBar title="Backup phrase" onBack={() => setStep('password')} />
        <Page>
          {/* Body text on this screen is critical (recovery phrase, lose-
              your-funds warning) so we deliberately render it ~30% larger
              than the rest of the app and bold. Title in the TopBar stays
              at its standard size for visual hierarchy. */}
          <div className="card border-warn/30 bg-warn/5 mb-3 text-warn font-bold" style={{ fontSize: 15 }}>
            ⚠ This 12-word phrase is the ONLY way to recover your wallet. Write it down on
            paper and store it safely. Anyone with this phrase can spend your funds.
          </div>
          <div className="card mb-3">
            <div className="grid grid-cols-3 gap-2">
              {words.map((w, i) => (
                <div key={i} className="bg-bg-soft border border-line rounded-lg px-2 py-1.5 font-bold" style={{ fontSize: 17 }}>
                  <span className="text-ink-faint mr-1 font-bold">{i + 1}.</span>
                  <span className="font-mono font-bold">{w}</span>
                </div>
              ))}
            </div>
            <div className="text-center mt-3">
              <CopyButton text={mnemonic} label="Copy phrase" clearAfterMs={60_000} />
            </div>
          </div>
          <label className="flex items-start gap-2 text-white/85 font-bold mt-2 mb-3 cursor-pointer" style={{ fontSize: 16 }}>
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 accent-[#5eccfa]"
            />
            <span>I have saved my recovery phrase. I understand Yacht cannot recover it for me.</span>
          </label>
          <button
            className="btn btn-shine w-full text-white font-bold disabled:opacity-50"
            style={{ fontSize: 18 }}
            disabled={!acknowledged}
            onClick={finalize}
          >
            Open wallet
          </button>
        </Page>
      </Screen>
    );
  }

  return null;
}

function Spinner() {
  return (
    <span
      className="inline-block animate-spin rounded-full"
      style={{
        width: 22,
        height: 22,
        border: '3px solid rgba(255,255,255,0.45)',
        borderTopColor: '#ffffff',
      }}
      aria-label="Working"
    />
  );
}
