import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Page, Screen, TopBar } from '../components/Layout';
import { rpc } from '@/lib/messaging';
import { hostFromOrigin, looksHomograph } from '@/lib/security';
export default function ConnectedSites() {
    const [origins, setOrigins] = useState([]);
    const [loading, setLoading] = useState(true);
    async function load() {
        setLoading(true);
        const o = await rpc({ type: 'origins.list' });
        setOrigins(o);
        setLoading(false);
    }
    useEffect(() => { void load(); }, []);
    async function revoke(origin) {
        if (!confirm(`Revoke ${hostFromOrigin(origin)}? They'll need to reconnect to use this wallet.`))
            return;
        await rpc({ type: 'origins.revoke', origin });
        await load();
    }
    return (_jsxs(Screen, { children: [_jsx(TopBar, { title: "Connected sites" }), _jsxs(Page, { children: [loading && _jsx("div", { className: "text-ink-dim text-sm", children: "Loading\u2026" }), !loading && origins.length === 0 && (_jsxs("div", { className: "card text-center text-sm text-ink-dim py-6", children: ["No sites connected.", _jsx("div", { className: "text-[11px] text-ink-faint mt-2", children: "Sites you connect to will appear here. You can revoke any site at any time." })] })), _jsx("div", { className: "space-y-2", children: origins.map((o) => {
                            const host = hostFromOrigin(o);
                            const homograph = looksHomograph(host);
                            return (_jsxs("div", { className: "card flex justify-between items-center", children: [_jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("div", { className: "text-sm font-medium truncate", children: host }), _jsx("div", { className: "text-[11px] text-ink-faint truncate font-mono", children: o }), homograph && (_jsx("div", { className: "text-[11px] text-warn mt-0.5", children: "\u26A0 Possible look-alike domain" }))] }), _jsx("button", { className: "text-xs text-danger hover:underline ml-2", onClick: () => revoke(o), children: "Revoke" })] }, o));
                        }) })] })] }));
}
