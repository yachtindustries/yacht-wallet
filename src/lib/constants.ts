// Single source of truth for cross-cutting addresses and policy numbers.
// If you need a value here in two places, import it from this file — never
// re-declare it. Duplicating a treasury address is the easiest way to ship
// a silent fee-misroute when one copy is rotated and the other isn't.

/** Address that receives the Yacht trading-fee skim from every swap. */
export const TRADING_FEE_TREASURY = '0xC435423522ac13A0405E86eaB07B3F022c748f59';

/** Trading-fee skim, in basis points (50 = 0.5%). */
export const TRADING_FEE_BPS = 50;
