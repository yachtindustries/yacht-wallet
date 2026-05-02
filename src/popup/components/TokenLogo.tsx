import { useEffect, useMemo, useState } from 'react';
import { rpc } from '@/lib/messaging';
import { isNative, TokenMeta } from '@/lib/tokens';

const memo = new Map<string, string | null>();

interface Props {
  token: TokenMeta;
  size?: number;
  className?: string;
}

export function TokenLogo({ token, size = 36, className = '' }: Props) {
  const [logo, setLogo] = useState<string | null>(() => token.logo ?? memo.get(keyOf(token)) ?? null);

  useEffect(() => {
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

  const initials = useMemo(() => token.symbol.slice(0, 2).toUpperCase(), [token]);
  const style = { width: size, height: size, fontSize: Math.max(10, size * 0.35) };

  if (logo) {
    return (
      <img
        src={logo}
        alt={token.symbol}
        className={`rounded-full bg-bg-soft border border-line object-cover ${className}`}
        style={style}
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
      />
    );
  }

  return (
    <div
      className={`rounded-full bg-brand/15 border border-brand/30 flex items-center justify-center font-bold text-brand shrink-0 ${className}`}
      style={style}
    >
      {initials}
    </div>
  );
}

function keyOf(t: TokenMeta): string {
  return isNative(t) ? 'NATIVE' : t.address.toLowerCase();
}
