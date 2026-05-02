import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Page, Screen, TopBar } from '../components/Layout';
import { useApp } from '../store';
import { CopyButton } from '../components/Copy';
export default function Receive() {
    const { meta } = useApp();
    const active = meta?.publicAccounts.find((a) => a.id === meta?.activeAccountId);
    const [qr, setQr] = useState('');
    useEffect(() => {
        if (!active)
            return;
        QRCode.toDataURL(active.address, { margin: 1, width: 220, color: { dark: '#f3e9da', light: '#1c130a' } }).then(setQr);
    }, [active?.address]);
    if (!active)
        return null;
    return (_jsxs(Screen, { children: [_jsx(TopBar, { title: "Receive" }), _jsxs(Page, { className: "flex flex-col items-center text-center", children: [_jsxs("div", { className: "card flex flex-col items-center w-full", children: [qr && _jsx("img", { src: qr, alt: "address QR", className: "rounded-xl" }), _jsx("div", { className: "font-mono text-xs mt-3 break-all select-all", children: active.address }), _jsx("div", { className: "mt-2", children: _jsx(CopyButton, { text: active.address, label: "Copy address" }) })] }), _jsx("p", { className: "text-xs text-ink-faint mt-4 max-w-[280px]", children: "Only send APE and ApeChain (chain id 33139) ERC-20 tokens to this address. Sending tokens from another chain will result in lost funds." })] })] }));
}
