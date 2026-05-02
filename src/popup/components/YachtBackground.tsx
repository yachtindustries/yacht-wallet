// Static yacht background — water on top, deck below. No waves, no animation.

export function YachtBackground() {
  return (
    <svg
      viewBox="0 0 380 600"
      preserveAspectRatio="xMidYMin slice"
      className="absolute inset-0 w-full h-full pointer-events-none"
      aria-hidden
    >
      <rect x="0" y="0" width="380" height="600" fill="#5eccfa" />

      {/* Yacht deck — nudged up ~2% from previous position */}
      <path
        d="M 0 252
           Q 0 227 26 227
           L 354 227
           Q 380 227 380 252
           L 380 600
           L 0 600 Z"
        fill="#f6c87e"
      />
    </svg>
  );
}
