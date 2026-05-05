import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
const copyIconUrl = chrome.runtime.getURL('copy.png');
const apescanIconUrl = chrome.runtime.getURL('apescan.png');
/**
 * Copy + Apescan buttons used next to wallet addresses on the Accounts and
 * Dashboard screens.
 */
export function AddressActions({ address, color = '#ffffff', size = 18 }) {
    const [copied, setCopied] = useState(false);
    async function copy(e) {
        e.stopPropagation();
        e.preventDefault();
        try {
            await navigator.clipboard.writeText(address);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
        }
        catch { /* clipboard denied — silently no-op */ }
    }
    function openApescan(e) {
        e.stopPropagation();
        // Don't preventDefault — let the anchor open in a new tab.
        window.open(`https://apescan.io/address/${address}`, '_blank', 'noopener,noreferrer');
    }
    const maskStyle = (url) => ({
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
    });
    return (_jsxs("div", { className: "inline-flex items-center gap-2", children: [_jsx("button", { type: "button", onClick: copy, title: copied ? 'Copied' : 'Copy address', "aria-label": copied ? 'Copied' : 'Copy address', className: "hover:opacity-75 inline-flex items-center justify-center", children: copied ? (_jsx("span", { style: { color, fontSize: size, lineHeight: 1, fontWeight: 700 }, children: "\u2713" })) : (_jsx("span", { role: "img", "aria-hidden": true, className: "block", style: maskStyle(copyIconUrl) })) }), _jsx("button", { type: "button", onClick: openApescan, title: "View on Apescan", "aria-label": "View on Apescan", className: "hover:opacity-75 inline-flex items-center justify-center", children: _jsx("span", { role: "img", "aria-hidden": true, className: "block", style: maskStyle(apescanIconUrl) }) })] }));
}
