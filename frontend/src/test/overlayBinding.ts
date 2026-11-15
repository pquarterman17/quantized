// The binding single-X overlay tests give their overlays: channel 0 against
// the time column. A single-X view never reads it (lib/overlayPlacement.ts
// passes every overlay through untouched there), so it only satisfies the type.
import type { OverlayBinding } from "../lib/types";

export const SINGLE_X: OverlayBinding = { yKey: 0, xKey: null };
