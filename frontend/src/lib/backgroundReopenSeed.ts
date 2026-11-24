// "Open in Magnetometry / Hysteresis" for a background-subtraction output
// (OPEN_ITEMS row 12, reopen-seven lane): the recorded settings read back
// strictly. FAIL CLOSED: null unless EVERY setting is present and of the right
// type, so a partial record is never seeded. The plotted channels are proved
// separately by position AND name (`extra.channels`, store/toolReopenChannels.ts).
// Lazy: imported by the Magnetometry hook and the lazy opener only.

import type { ReopenSeed } from "./committedOutputReopen";

const isIndex = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
const isChannel = (value: unknown): value is number | null => value === null || isIndex(value);

export interface MagBackgroundSeed {
  /** The routine that ran: the M(T) high-T tail or the M(H) loop path. */
  path: "mt" | "mh";
  /** That routine's own fraction (the other path's fraction is not an input). */
  fraction: number;
  xKey: number | null;
  yKey: number;
}

/** The Magnetometry Background tab's recorded run (`settings` of producer `mag-background` v2). */
export function magBackgroundSeed(s: ReopenSeed | null | undefined): MagBackgroundSeed | null {
  if (!s) return null;
  const { path, fraction, xKey, yKey } = s;
  if (path !== "mt" && path !== "mh") return null;
  // The tab clamps its fraction to [0.01, 1]; anything else was not made by it.
  if (typeof fraction !== "number" || !Number.isFinite(fraction) || fraction < 0.01 || fraction > 1) return null;
  if (!isChannel(xKey) || !isIndex(yKey)) return null;
  return { path, fraction, xKey, yKey };
}

export interface HysteresisBackgroundSeed {
  xKey: number | null;
  yKey: number;
}

/** The Hysteresis tool's recorded run: the routine has no parameters, only the channels it read. */
export function hysteresisBackgroundSeed(s: ReopenSeed | null | undefined): HysteresisBackgroundSeed | null {
  if (!s) return null;
  const { xKey, yKey } = s;
  if (!isChannel(xKey) || !isIndex(yKey)) return null;
  return { xKey, yKey };
}
