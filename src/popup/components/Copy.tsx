import { useState } from 'react';

export function CopyButton({
  text,
  label = 'Copy',
  /** Clear the OS clipboard after this many ms — use for secrets like seed phrases / private keys. */
  clearAfterMs,
}: {
  text: string;
  label?: string;
  clearAfterMs?: number;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="text-xs text-brand hover:underline"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
        if (clearAfterMs && clearAfterMs > 0) {
          setTimeout(() => {
            // Best-effort: only clear if our text is still on the clipboard,
            // otherwise we'd nuke whatever the user copied next.
            navigator.clipboard.readText().then((current) => {
              if (current === text) navigator.clipboard.writeText('').catch(() => {});
            }).catch(() => {});
          }, clearAfterMs);
        }
      }}
    >
      {copied ? (clearAfterMs ? 'Copied (auto-clears)' : 'Copied!') : label}
    </button>
  );
}
