import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Page, Screen, TopBar } from '../components/Layout';
import { useApp } from '../store';
const QR_SIZE = 240;
export default function Receive() {
    const { meta } = useApp();
    const active = meta?.publicAccounts.find((a) => a.id === meta?.activeAccountId);
    const [qr, setQr] = useState('');
    const [copied, setCopied] = useState(false);
    useEffect(() => {
        if (!active)
            return;
        QRCode.toDataURL(active.address, {
            margin: 1,
            width: QR_SIZE,
            color: { dark: '#ffffff', light: '#f6c87e' },
        }).then(setQr);
    }, [active?.address]);
    async function copy() {
        if (!active)
            return;
        await navigator.clipboard.writeText(active.address);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    }
    if (!active)
        return null;
    return (_jsxs(Screen, { children: [_jsx(TopBar, { title: "Receive", tone: "deck" }), _jsxs(Page, { tone: "deck", className: "flex flex-col items-center text-center", children: [_jsxs("div", { className: "flex flex-col items-center", style: { width: QR_SIZE }, children: [qr && _jsx("img", { src: qr, alt: "address QR" }), _jsx("button", { type: "button", onClick: copy, className: "bg-white rounded-xl px-3 py-3 break-all font-bold w-full text-center hover:opacity-90", style: { marginTop: '20%', fontSize: 16, color: '#f6c87e' }, "aria-label": "Copy address", title: "Click to copy", children: active.address }), _jsx("button", { onClick: copy, className: "mt-3 px-6 py-2 rounded-xl bg-[#5eccfa] hover:bg-[#3eb8e8] text-white font-bold w-full", style: { fontSize: 15 }, children: copied ? 'Copied!' : 'Copy' })] }), _jsx("p", { className: "text-white mt-auto pt-4 font-bold", style: { fontSize: 12 }, children: "Only Send ApeChain Tokens to this Address" })] })] }));
}
