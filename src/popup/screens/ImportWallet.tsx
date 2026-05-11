import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen, TopBar, Page } from '../components/Layout';
import { PasswordField } from '../components/PasswordField';
import { rpc } from '@/lib/messaging';
import { passwordStrength } from '@/lib/security';
import { isValidMnemonic } from '@/lib/wallet-utils';
import { useApp } from '../store';

const MIN_PASSWORD_LEN = 12;

type Mode = 'mnemonic' | 'privateKey';

export default function ImportWallet() {
  const nav = useNavigate();
  const { refreshStatus } = useApp();
  const [mode, setMode] = useState<Mode>('mnemonic');
  const [secret, setSecret] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setErr(null);
    setBusy(true);
    try {
      if (mode === 'mnemonic') {
        if (!isValidMnemonic(secret.trim())) throw new Error('Invalid recovery phrase');
        await rpc({ type: 'vault.create.mnemonic', password: pw, mnemonic: secret.trim() });
      } else {
        const trimmed = secret.trim();
        const pk = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
        if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error('Private key must be 32 bytes (64 hex chars)');
        await rpc({ type: 'vault.create.privateKey', password: pw, privateKey: pk });
      }
      await refreshStatus();
      nav('/');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const validInput = mode === 'mnemonic' ? secret.trim().split(/\s+/).length >= 12 : secret.trim().length >= 64;

  return (
    <Screen>
      <TopBar title="Import wallet" onBack={() => nav('/')} />
      <Page>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <button
            onClick={() => setMode('mnemonic')}
            className={`py-2 rounded-xl border font-bold text-sm ${mode === 'mnemonic' ? 'border-[#5eccfa] bg-[#5eccfa]/20 text-white' : 'border-white/30 bg-white/10 text-white/85'}`}
          >
            Recovery phrase
          </button>
          <button
            onClick={() => setMode('privateKey')}
            className={`py-2 rounded-xl border font-bold text-sm ${mode === 'privateKey' ? 'border-[#5eccfa] bg-[#5eccfa]/20 text-white' : 'border-white/30 bg-white/10 text-white/85'}`}
          >
            Private key
          </button>
        </div>

        <label className="label">
          {mode === 'mnemonic' ? '12 / 24-word recovery phrase' : 'Private key (0x…)'}
        </label>
        <textarea
          className="input min-h-[80px] font-mono text-xs"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder={mode === 'mnemonic' ? 'word1 word2 word3 …' : '0x…'}
        />
        <p className="text-[11px] text-white/70 mt-2">
          {mode === 'mnemonic'
            ? 'Standard BIP-39 phrase. Compatible with MetaMask, Rabby, Rainbow.'
            : 'Hex-encoded EVM private key. Imported accounts cannot derive new accounts.'}
        </p>

        <label className="label mt-3">Wallet password</label>
        <PasswordField value={pw} onChange={setPw} showStrength />
        <label className="label mt-3">Confirm password</label>
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
        />
        {err && <div className="text-danger text-xs mt-2">{err}</div>}
        <button
          className="btn-primary w-full mt-4"
          disabled={busy || !validInput || pw.length < MIN_PASSWORD_LEN || passwordStrength(pw).score < 2 || pw !== pw2}
          onClick={go}
        >
          {busy ? 'Importing…' : 'Import'}
        </button>
      </Page>
    </Screen>
  );
}
