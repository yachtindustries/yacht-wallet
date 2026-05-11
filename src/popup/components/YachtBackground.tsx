// Static yacht background — water on top, navy deck below. No waves, no
// animation. Anchored to the top of the scrollable container at the design
// height (600px). Below that, the parent container's navy bg takes over so
// side-panel mode (taller container) doesn't squish the artwork.

export function YachtBackground() {
  return (
    <svg
      viewBox="0 0 380 600"
      // preserveAspectRatio="none" stretches the artwork to the device
      // width on Capacitor (any phone wider than the 380 design width)
      // so the water-blue rect and deck curve fill edge-to-edge instead
      // of leaving navy gutters at the top sides of the homepage.
      preserveAspectRatio="none"
      className="absolute top-0 left-0 w-full pointer-events-none"
      style={{ height: 600 }}
      aria-hidden
    >
      <rect x="0" y="0" width="380" height="600" fill="#5eccfa" />

      {/* Yacht deck — now navy to match the rest of the menus.
          Deck top now at y=341 (was 353) — nudged up 12 units (~2%) so
          the tokens box feels closer to the action grid above. */}
      <path
        d="M 0 366
           Q 0 341 26 341
           L 354 341
           Q 380 341 380 366
           L 380 600
           L 0 600 Z"
        fill="#002849"
      />
    </svg>
  );
}
