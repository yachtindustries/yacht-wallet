import { useState } from 'react';

const copyIconUrl = chrome.runtime.getURL('copy.png');
const apescanIconUrl = chrome.runtime.getURL('apescan.png');

interface Props {
  address: string;
  /** Color for the masked icons. White on dark surfaces, deep ink on light ones. */
  color?: string;
  size?: number;
}

/**
 * Copy + Apescan buttons used next to wallet addresses on the Accounts and
 * Dashboard screens.
 */
export function AddressActions({ address, color = '#ffffff', size = 18 }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* clipboard denied — silently no-op */ }
  }

  function openApescan(e: React.MouseEvent) {
    e.stopPropagation();
    // Don't preventDefault — let the anchor open in a new tab.
    window.open(`https://apescan.io/address/${address}`, '_blank', 'noopener,noreferrer');
  }

  const maskStyle = (url: string) => ({
    width: size,
    height: size,
    backgroundColor: color,
    WebkitMaskImage: `url(${url})`,
    maskImage: `url(${url})`,
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center',
    maskPosition: 'center',
    WebkitMaskSize: 'contain',
    maskSize: 'contain',
  } as const);

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={copy}
        title={copied ? 'Copied' : 'Copy address'}
        aria-label={copied ? 'Copied' : 'Copy address'}
        className="hover:opacity-75 inline-flex items-center justify-center"
      >
        {copied ? (
          <span style={{ color, fontSize: size, lineHeight: 1, fontWeight: 700 }}>✓</span>
        ) : (
          <span role="img" aria-hidden className="block" style={maskStyle(copyIconUrl)} />
        )}
      </button>
      <button
        type="button"
        onClick={openApescan}
        title="View on Apescan"
        aria-label="View on Apescan"
        className="hover:opacity-75 inline-flex items-center justify-center"
      >
        <span role="img" aria-hidden className="block" style={maskStyle(apescanIconUrl)} />
      </button>
    </div>
  );
}
