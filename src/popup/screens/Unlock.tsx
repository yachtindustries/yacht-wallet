import { useState } from 'react';
import { Screen } from '../components/Layout';
import { rpc } from '@/lib/messaging';
import { useApp } from '../store';

const logoUrl = chrome.runtime.getURL('yacht-icon.png');

export default function Unlock() {
  const { refreshStatus } = useApp();
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Counter that increments on every password keystroke. We re-key the
  // yacht logo with this so React unmounts/remounts the element, which
  // restarts the CSS `yacht-wave` animation. Net effect: the boat bobs
  // briefly each time a character lands, like ripples on a pier.
  const [waveTick, setWaveTick] = useState(0);

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await rpc({ type: 'vault.unlock', password: pw });
      await refreshStatus();
    } catch (e2) {
      setErr((e2 as Error).message || 'Incorrect password');
    } finally {
      setBusy(false);
    }
  }

  // While the field is empty we keep the placeholder "Password" at the
  // ordinary 17 px so it doesn't overflow; once the user starts typing the
  // dots scale up by ~50%. Box height is pinned via explicit height +
  // line-height so the input itself doesn't grow with the text.
  const dotsStyle: React.CSSProperties = pw
    ? { fontSize: 22, lineHeight: '52px', height: 52, letterSpacing: '0.18em' }
    : { fontSize: 17, lineHeight: '52px', height: 52 };

  return (
    <Screen>
      <form
        onSubmit={unlock}
        className="flex flex-col h-full px-6 py-5"
        style={{
          backgroundColor: '#002849',
          paddingTop: 'calc(var(--safe-top, 0px) + 20px)',
          paddingBottom: 'calc(var(--safe-bottom, 0px) + 20px)',
        }}
      >
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-white">Yacht</h1>
        </div>

        {/* The logo lives in a flex-1 zone that *shrinks* when the soft
            keyboard takes the bottom half of the screen. min-h-0 lets the
            zone collapse below its intrinsic content size; overflow-hidden
            clips the boat instead of letting it slide over the password
            input. The input + Unlock button sit together as their own
            block below, with a fixed gap between them so the button can
            never crash into the input regardless of viewport height. */}
        <div className="flex-1 flex flex-col items-center justify-center min-h-0 overflow-hidden mt-2">
          <span key={waveTick} className="yacht-wave inline-block">
            <img src={logoUrl} alt="Yacht" className="object-contain max-h-full" style={{ width: 250, height: 250 }} />
          </span>
        </div>

        <div className="flex flex-col items-center w-full mt-4">
          <input
            autoFocus
            className="w-full max-w-xs rounded-xl px-3 text-center font-bold bg-white text-ink placeholder:text-ink-faint border border-white focus:outline-none focus:ring-2 focus:ring-white"
            style={dotsStyle}
            type="password"
            autoComplete="current-password"
            spellCheck={false}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={() => setWaveTick((t) => t + 1)}
            placeholder="Password"
          />
          {err && <div className="text-danger text-xs mt-2">{err}</div>}
          <button
            className="btn-shine w-full max-w-xs rounded-xl px-3 py-3 text-center font-bold text-white disabled:opacity-100 flex items-center justify-center mt-4"
            style={{ fontSize: 17 }}
            disabled={busy || !pw}
          >
            {busy ? <Spinner /> : 'Unlock'}
          </button>
        </div>
      </form>
    </Screen>
  );
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
      aria-label="Unlocking"
    />
  );
}
