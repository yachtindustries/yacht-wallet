// Static yacht background — water on top, deck below. No waves, no animation.
// Anchored to the top of the scrollable container at the design height
// (600px). Below that, the parent container's deck-color bg takes over so
// side-panel mode (taller container) doesn't squish the artwork.

export function YachtBackground() {
  return (
    <svg
      viewBox="0 0 380 600"
      preserveAspectRatio="xMidYMin meet"
      className="absolute top-0 left-0 w-full pointer-events-none"
      style={{ height: 600 }}
      aria-hidden
    >
      <rect x="0" y="0" width="380" height="600" fill="#5eccfa" />

      {/* Yacht deck */}
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
