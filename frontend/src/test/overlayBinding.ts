// The binding single-X overlay tests give their overlays: channel 0 against
// the time column. A single-X view still checks it (lib/overlayPlacement.ts:
// the Y must be plotted and the plot's X must be the bound X, else the overlay
// is not drawn), so a test that plots another channel or X binds its own.
import type { OverlayBinding } from "../lib/types";

export const SINGLE_X: OverlayBinding = { yKey: 0, xKey: null };
