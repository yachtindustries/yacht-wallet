import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link } from 'react-router-dom';
const logoUrl = chrome.runtime.getURL('yacht-icon.png');
export default function Welcome() {
    return (_jsxs("div", { className: "flex flex-col h-full px-6 py-5", style: { backgroundColor: '#f6c87e' }, children: [_jsx("div", { className: "text-center", children: _jsx("h1", { className: "text-2xl font-bold tracking-tight text-white", children: "Yacht" }) }), _jsx("div", { className: "flex-1 flex flex-col items-center", style: { paddingTop: '10%' }, children: _jsx("img", { src: logoUrl, alt: "Yacht", className: "object-contain", style: { width: 250, height: 250 } }) }), _jsxs("div", { className: "flex flex-col items-center gap-2 mb-[10%]", children: [_jsx(Link, { to: "/create", className: "w-full max-w-xs rounded-xl px-3 py-3 text-center font-bold text-white bg-[#5eccfa] hover:bg-[#3eb8e8]", style: { fontSize: 17 }, children: "Create wallet" }), _jsx(Link, { to: "/import", className: "w-full max-w-xs rounded-xl px-3 py-3 text-center font-bold text-black bg-white", style: { fontSize: 17 }, children: "Import wallet" })] })] }));
}
