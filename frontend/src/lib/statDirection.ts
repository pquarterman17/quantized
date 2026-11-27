// The colours of the paired plot's direction lines (item 20): increase, decrease,
// no change, each a design token resolved to hex. The canvas and the export request
// both read this one function, so a line is the same colour on screen and in the
// figure. Neutral hues, not good / bad: a rise is not always an improvement.
// Lazy only (the Stat Stage).

import { resolveToHex } from "./color";
import { cssVar } from "./seriesStyleCycle";

export const DIRECTION_TOKENS = ["--accent", "--warn", "--text-dim"] as const;

/** [increase, decrease, no change] as hex, or null when a token does not resolve
 *  (no theme loaded): the request then carries none and the canvas falls back to the ink. */
export function directionColors(): string[] | null {
  const hex = DIRECTION_TOKENS.map((t) => (cssVar(t) ? resolveToHex(cssVar(t)) : null));
  return hex.every((h): h is string => h !== null) ? hex : null;
}
