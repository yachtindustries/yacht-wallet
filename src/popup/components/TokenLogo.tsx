import { useEffect, useMemo, useState } from 'react';
import { rpc } from '@/lib/messaging';
import { isNative, TokenMeta } from '@/lib/tokens';

const memo = new Map<string, string | null>();

interface Props {
  token: TokenMeta;
  size?: number;
  className?: string;
}

// Fallback circle colour when a token has no remote logo. Light grey-blue
// reads on both white cards and the navy page background while staying
// visually muted — not competing with verified-token logos.
const FALLBACK_BG = '#a3b8c7';

export function TokenLogo({ token, size = 36, className = '' }: Props) {
  const [logo, setLogo] = useState<string | null>(() => token.logo ?? memo.get(keyOf(token)) ?? null);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    setBroken(false);
    if (token.logo) { setLogo(token.logo); return; }
    const k = keyOf(token);
    if (memo.has(k)) {
      setLogo(memo.get(k) ?? null);
      return;
    }
    if (isNative(token)) {
      memo.set(k, null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const pair = await rpc({ type: 'dex.token', query: token.address });
        const url = pair?.info?.imageUrl ?? null;
        if (!cancelled) {
          memo.set(k, url);
          setLogo(url);
        }
      } catch {
        memo.set(k, null);
      }
    })();
    return () => { cancelled = true; };
  }, [token.address, token.logo]);

  const initial = useMemo(() => (token.symbol[0] ?? '?').toUpperCase(), [token.symbol]);
  const style = { width: size, height: size };
  const showFallback = !logo || broken;

  if (showFallback) {
    return (
      <div
        className={`rounded-full flex items-center justify-center font-bold text-white shrink-0 ${className}`}
        style={{ ...style, backgroundColor: FALLBACK_BG, fontSize: Math.max(12, Math.round(size * 0.45)) }}
      >
        {initial}
      </div>
    );
  }

  return (
    <img
      src={logo!}
      alt={token.symbol}
      className={`rounded-full bg-white object-cover shrink-0 ${className}`}
      style={style}
      onError={() => { if (!broken) setBroken(true); }}
    />
  );
}

function keyOf(t: TokenMeta): string {
  return isNative(t) ? 'NATIVE' : t.address.toLowerCase();
}
