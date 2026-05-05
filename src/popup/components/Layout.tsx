import { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

const backIconUrl = chrome.runtime.getURL('public/actions/back.png');

export function TopBar({
  title,
  onBack,
  right,
  iconSize = 22,
  tone = 'cream',
}: {
  title: string;
  onBack?: () => void;
  right?: ReactNode;
  iconSize?: number;
  tone?: 'cream' | 'deck';
}) {
  const nav = useNavigate();
  const loc = useLocation();
  const isDeck = tone === 'deck';
  const bg = isDeck ? '#f6c87e' : '#fbf3df';
  const iconColor = isDeck ? '#ffffff' : '#2e2114';
  const titleClass = isDeck ? 'text-white' : 'text-ink';
  // If a custom onBack is provided, use it. Otherwise, try to go back; but
  // when there's no prior history (popup just opened on this route),
  // react-router's nav(-1) does nothing — fall back to home so the button
  // is never a dead-end.
  function defaultBack() {
    if (loc.key === 'default' || window.history.length <= 1) {
      nav('/');
    } else {
      nav(-1);
    }
  }
  return (
    <div
      className="flex items-center justify-between px-4 h-12 sticky top-0 z-10"
      style={{ backgroundColor: bg }}
    >
      <button
        className="w-10 text-left"
        onClick={onBack ?? defaultBack}
        aria-label="Back"
      >
        <span
          role="img"
          aria-hidden
          className="block"
          style={{
            width: iconSize,
            height: iconSize,
            backgroundColor: iconColor,
            WebkitMaskImage: `url(${backIconUrl})`,
            maskImage: `url(${backIconUrl})`,
            WebkitMaskRepeat: 'no-repeat',
            maskRepeat: 'no-repeat',
            WebkitMaskPosition: 'center',
            maskPosition: 'center',
            WebkitMaskSize: 'contain',
            maskSize: 'contain',
          }}
        />
      </button>
      <div className={`font-bold ${titleClass}`} style={{ fontSize: isDeck ? 17 : 14 }}>{title}</div>
      <div className="w-10 text-right flex items-center justify-end">{right}</div>
    </div>
  );
}

export function Page({
  children,
  className = '',
  tone = 'cream',
}: {
  children: ReactNode;
  className?: string;
  tone?: 'cream' | 'deck';
}) {
  const bg = tone === 'deck' ? '#f6c87e' : '#fbf3df';
  return (
    <div
      className={`flex-1 overflow-y-auto p-4 ${className}`}
      style={{ backgroundColor: bg }}
    >
      {children}
    </div>
  );
}

export function Screen({ children }: { children: ReactNode }) {
  return <div className="flex flex-col h-full">{children}</div>;
}

interface NavSpec {
  to: string;
  icon: string;
  label: string;
}

const NAV_ITEMS: NavSpec[] = [
  { to: '/',        icon: 'public/nav/home.png',     label: 'Home' },
  { to: '/swap',    icon: 'public/nav/swap.png',     label: 'Swap' },
  { to: '/search',  icon: 'public/nav/search.png',   label: 'Search' },
  { to: '/history', icon: 'public/nav/activity.png', label: 'Activity' },
  { to: '/chat',    icon: 'public/nav/chat.png',     label: 'Chat' },
];

const NAV_ACTIVE_COLOR = '#6b4423';
const NAV_INACTIVE_COLOR = '#ffffff';

// All routes now use the yacht-deck color so the nav blends with the deck/page bg.
const DECK_BG = '#f6c87e';

export function BottomNav() {
  const loc = useLocation();
  return (
    <div className="grid grid-cols-5 pt-2 pb-4" style={{ backgroundColor: DECK_BG }}>
      {NAV_ITEMS.map((n) => {
        const isActive = loc.pathname === n.to;
        const url = chrome.runtime.getURL(n.icon);
        return (
          <Link
            key={n.to}
            to={n.to}
            aria-label={n.label}
            title={n.label}
            className="flex items-center justify-center py-1.5"
          >
            <span
              role="img"
              aria-hidden
              className="block w-7 h-7"
              style={{
                backgroundColor: isActive ? NAV_ACTIVE_COLOR : NAV_INACTIVE_COLOR,
                WebkitMaskImage: `url(${url})`,
                maskImage: `url(${url})`,
                WebkitMaskRepeat: 'no-repeat',
                maskRepeat: 'no-repeat',
                WebkitMaskPosition: 'center',
                maskPosition: 'center',
                WebkitMaskSize: 'contain',
                maskSize: 'contain',
              }}
            />
          </Link>
        );
      })}
    </div>
  );
}
