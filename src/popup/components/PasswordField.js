import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { passwordStrength } from '@/lib/security';
export function PasswordField({ value, onChange, placeholder = 'Password', showStrength, autoFocus }) {
    const { score, label } = passwordStrength(value);
    const barColor = score >= 4 ? 'bg-success'
        : score >= 3 ? 'bg-brand'
            : score >= 2 ? 'bg-warn'
                : 'bg-danger';
    return (_jsxs("div", { children: [_jsx("input", { autoFocus: autoFocus, className: "input", type: "password", value: value, onChange: (e) => onChange(e.target.value), placeholder: placeholder }), showStrength && value.length > 0 && (_jsxs("div", { className: "mt-1.5", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("div", { className: "h-1 flex-1 bg-bg-soft rounded-full overflow-hidden", children: _jsx("div", { className: `h-full ${barColor} transition-all`, style: { width: `${(score / 4) * 100}%` } }) }), _jsx("span", { className: `text-[10px] ${score >= 3 ? 'text-success' : score >= 2 ? 'text-warn' : 'text-danger'}`, children: label })] }), value.length < 12 && (_jsx("div", { className: "text-[10px] text-ink-faint mt-0.5", children: "Use at least 12 characters." }))] }))] }));
}
