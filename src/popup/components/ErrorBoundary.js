import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Component } from 'react';
// Last line of defence against a render bug white-screening the popup mid-flow
// (e.g. mid-signing). Catches synchronous render errors anywhere in the tree
// and shows a recovery card with a Reload button.
//
// Async errors (promise rejections, setTimeout throws) bypass error boundaries
// by design — we wire window.unhandledrejection / window.error in main.tsx to
// at least log them and forward into here for surfacing.
export class ErrorBoundary extends Component {
    state = { error: null };
    static getDerivedStateFromError(error) {
        return { error };
    }
    componentDidCatch(error, info) {
        console.error('[Yacht] popup render error:', error, info.componentStack);
    }
    reset = () => {
        this.setState({ error: null });
    };
    reload = () => {
        window.location.reload();
    };
    render() {
        if (!this.state.error)
            return this.props.children;
        return (_jsxs("div", { className: "p-6 flex flex-col items-center justify-center text-center", style: { minHeight: '100%' }, children: [_jsx("div", { className: "text-4xl mb-3", children: "\u2693" }), _jsx("h1", { className: "font-bold mb-2", style: { fontSize: 19 }, children: "Something went wrong" }), _jsx("p", { className: "text-ink-dim mb-4", style: { fontSize: 14 }, children: "The wallet hit an unexpected error. Your funds and recovery phrase are safe \u2014 they live in your encrypted vault on disk, not in this view." }), _jsx("pre", { className: "bg-bg-soft border border-line rounded-xl p-3 mb-4 text-left whitespace-pre-wrap break-words max-w-full overflow-auto", style: { fontSize: 12, maxHeight: 160 }, children: this.state.error.message || String(this.state.error) }), _jsxs("div", { className: "flex gap-2 w-full", children: [_jsx("button", { className: "btn-ghost flex-1 font-bold", style: { fontSize: 16 }, onClick: this.reset, children: "Dismiss" }), _jsx("button", { className: "btn flex-1 text-white font-bold bg-[#5eccfa] hover:bg-[#3eb8e8]", style: { fontSize: 16 }, onClick: this.reload, children: "Reload" })] })] }));
    }
}
