import { ReactNode, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

const backIconUrl = chrome.runtime.getURL('public/actions/back.png');

// All Yacht menus paint on a single dark-navy background. The `tone` prop is
// kept on TopBar/Page for backwards compatibility but both branches resolve
// to the same colour now — there's no second theme.
export const YACHT_BG = '#002849';

export function TopBar({
  title,
  onBack,
  right,
  iconSize = 22,
}: {
  /** Accepts a string OR an inline node so callers can append controls
   * (e.g. an edit-pencil that reveals on hover) next to the heading. */
  title: ReactNode;
  onBack?: () => void;
  right?: ReactNode;
  iconSize?: number;
  /** Accepted for legacy call sites. The bar is always navy now. */
  tone?: 'cream' | 'deck';
}) {
  const nav = useNavigate();
  const loc = useLocation();
  const bg = YACHT_BG;
  const iconColor = '#ffffff';
  const titleClass = 'text-white';
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
      className="flex items-center justify-between px-4 sticky top-0 z-10"
      style={{
        backgroundColor: bg,
        // Push the bar's content down past the status bar / camera notch on
        // mobile. var(--safe-top) collapses to 0 on the desktop extension.
        paddingTop: 'calc(var(--safe-top, 0px) + 0px)',
        height: 'calc(var(--safe-top, 0px) + 48px)',
      }}
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
      <div className={`font-bold ${titleClass}`} style={{ fontSize: 17 }}>{title}</div>
      <div className="w-10 text-right flex items-center justify-end">{right}</div>
    </div>
  );
}

export function Page({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
  /** Accepted for legacy call sites. The page is always navy now. */
  tone?: 'cream' | 'deck';
}) {
  return (
    <div
      className={`flex-1 overflow-y-auto p-4 ${className}`}
      // overscrollBehavior: contain stops the bounce from leaking the
      // parent's background through the scrollable area on macOS, which
      // otherwise paints a white sliver beyond the navy when the user
      // drags past the top or bottom of the page.
      style={{ backgroundColor: YACHT_BG, overscrollBehavior: 'contain' }}
    >
      {children}
    </div>
  );
}

export function Screen({ children }: { children: ReactNode }) {
  // Navy background on the outermost wrapper too so any momentary gap
  // (during route transitions, in side-panel mode, or when an overscroll
  // bounce slips past the inner Page) renders navy rather than white.
  return (
    <div
      className="flex flex-col h-full"
      style={{ backgroundColor: YACHT_BG }}
    >
      {children}
    </div>
  );
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

const NAV_ACTIVE_COLOR = '#5eccfa';   // water blue — highlights the current tab
const NAV_INACTIVE_COLOR = '#ffffff';

export function BottomNav() {
  const loc = useLocation();
  return (
    <div
      className="grid grid-cols-5 pt-2"
      style={{
        backgroundColor: YACHT_BG,
        // Pad past the home-indicator / gesture bar without losing the
        // pb-4 baseline used on desktop.
        paddingBottom: 'calc(var(--safe-bottom, 0px) + 16px)',
      }}
    >
      {NAV_ITEMS.map((n) => {
        const isActive = loc.pathname === n.to;
        const url = chrome.runtime.getURL(n.icon);
        return (
          <BounceNavItem
            key={n.to}
            to={n.to}
            label={n.label}
            url={url}
            colour={isActive ? NAV_ACTIVE_COLOR : NAV_INACTIVE_COLOR}
          />
        );
      })}
    </div>
  );
}

/**
 * Module-level handoff used so the bounce animation can SURVIVE the
 * react-router navigation. Each screen mounts its own copy of
 * BottomNav, which means clicking an inactive tab unmounts the entire
 * BottomNav (along with the span we just started animating) before
 * the browser paints. We work around it by recording the click here
 * and letting the freshly-mounted BottomNav's matching item replay
 * the animation on its first effect run. Stale entries (older than
 * 600 ms) are ignored so a delayed unmount can't re-fire the bounce
 * on an unrelated future render.
 */
let pendingBounce: { to: string; at: number } | null = null;
const BOUNCE_KEYFRAMES: Keyframe[] = [
  { transform: 'scale(1, 1) translateY(0)' },
  { transform: 'scale(0.72, 1.22) translateY(-3px)', offset: 0.3 },
  { transform: 'scale(1.16, 0.86) translateY(1px)', offset: 0.55 },
  { transform: 'scale(0.94, 1.06) translateY(0)', offset: 0.8 },
  { transform: 'scale(1, 1) translateY(0)' },
];
const BOUNCE_OPTIONS: KeyframeAnimationOptions = {
  duration: 380,
  easing: 'cubic-bezier(.5,.05,.4,1.6)',
  fill: 'none',
};

/**
 * One bottom-nav icon that runs a jelly squash-stretch animation on
 * every click — including the first click that *navigates* to this
 * tab. The Web Animations API runs the animation imperatively so
 * we don't depend on CSS class remounts.
 */
function BounceNavItem({
  to,
  label,
  url,
  colour,
}: {
  to: string;
  label: string;
  url: string;
  colour: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);

  function bounceLocal() {
    const el = ref.current;
    if (!el || typeof el.animate !== 'function') return;
    el.animate(BOUNCE_KEYFRAMES, BOUNCE_OPTIONS);
  }

  function onPointerDown() {
    // Try to play on the still-mounted span — works on the active tab
    // (no nav, no unmount).
    bounceLocal();
    // Record the intent so the freshly-mounted BottomNav of the next
    // screen can replay the bounce on the matching tab when it
    // finishes mounting (handles inactive-tab clicks).
    pendingBounce = { to, at: Date.now() };
  }

  // On mount, see if we're the target of a recent click that just
  // unmounted us mid-animation. If so, replay it now.
  useEffect(() => {
    if (!pendingBounce) return;
    if (pendingBounce.to !== to) return;
    if (Date.now() - pendingBounce.at > 600) return;
    bounceLocal();
    pendingBounce = null;
  }, [to]);

  return (
    <Link
      to={to}
      aria-label={label}
      title={label}
      className="flex items-center justify-center py-1.5"
      onPointerDown={onPointerDown}
    >
      <span
        ref={ref}
        role="img"
        aria-hidden
        className="block w-7 h-7"
        style={{
          backgroundColor: colour,
          WebkitMaskImage: `url(${url})`,
          maskImage: `url(${url})`,
          WebkitMaskRepeat: 'no-repeat',
          maskRepeat: 'no-repeat',
          WebkitMaskPosition: 'center',
          maskPosition: 'center',
          WebkitMaskSize: 'contain',
          maskSize: 'contain',
          transformOrigin: '50% 70%',
        }}
      />
    </Link>
  );
}
