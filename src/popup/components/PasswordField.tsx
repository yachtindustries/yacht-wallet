import { passwordStrength } from '@/lib/security';

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  showStrength?: boolean;
  autoFocus?: boolean;
}

export function PasswordField({ value, onChange, placeholder = 'Password', showStrength, autoFocus }: Props) {
  const { score, label } = passwordStrength(value);

  const barColor =
    score >= 4 ? 'bg-success'
    : score >= 3 ? 'bg-brand'
    : score >= 2 ? 'bg-warn'
    : 'bg-danger';

  return (
    <div>
      <input
        autoFocus={autoFocus}
        className="input"
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {showStrength && value.length > 0 && (
        <div className="mt-1.5">
          <div className="flex items-center gap-2">
            <div className="h-1 flex-1 bg-bg-soft rounded-full overflow-hidden">
              <div
                className={`h-full ${barColor} transition-all`}
                style={{ width: `${(score / 4) * 100}%` }}
              />
            </div>
            <span className={`text-[10px] ${score >= 3 ? 'text-success' : score >= 2 ? 'text-warn' : 'text-danger'}`}>
              {label}
            </span>
          </div>
          {value.length < 12 && (
            <div className="text-[10px] text-white/70 mt-0.5">Use at least 12 characters.</div>
          )}
        </div>
      )}
    </div>
  );
}
