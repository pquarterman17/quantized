// Pins of the follow windows other than Data (WORKSPACE_LAYOUT_PLAN P4, D8):
// the Analysis window and each tool window follow the focused plot's dataset
// unless pinned to one. Pure: `(layout, ...) -> layout`, a no-op returns the
// same object. Data keeps its own `layout.data` (P3); these live in
// `layout.pins`, saved with the project like every placement.

import type { Dataset } from "../types";
import type { WindowLayoutV1, WindowRef } from "./types";

/** The dataset `ref` is pinned to, or null when it follows. */
export const pinOf = (layout: WindowLayoutV1 | null, ref: WindowRef): string | null => layout?.pins?.[ref] ?? null;

/** Pin `ref` to dataset `id`. */
export function setPin(layout: WindowLayoutV1, ref: WindowRef, id: string): WindowLayoutV1 {
  if (pinOf(layout, ref) === id) return layout;
  return { ...layout, pins: { ...layout.pins, [ref]: id } };
}

/** Let `ref` follow again. */
export function clearPin(layout: WindowLayoutV1, ref: WindowRef): WindowLayoutV1 {
  if (pinOf(layout, ref) === null) return layout;
  const pins = { ...layout.pins };
  delete pins[ref];
  return { ...layout, pins };
}

export type FollowSource =
  | { kind: "dataset"; mode: "plot" | "pinned"; datasetId: string }
  | { kind: "none"; mode: "plot"; reason: string }
  | { kind: "missing"; mode: "pinned"; pinned: string; reason: string };

export const FOLLOW_NO_PLOT = "The focused plot shows no dataset; focus a plot window to see its analysis.";
export const FOLLOW_PIN_GONE = "The pinned dataset was removed, so there is nothing to show until you unpin the window.";

/** What a follow window shows: its pin, else the focused plot's dataset. A pin
 *  to a removed dataset fails closed (never some other dataset). */
export function resolveFollow(pinned: string | null, datasets: readonly Pick<Dataset, "id">[], plotDatasetId: string | null): FollowSource {
  if (pinned !== null) {
    return datasets.some((d) => d.id === pinned)
      ? { kind: "dataset", mode: "pinned", datasetId: pinned }
      : { kind: "missing", mode: "pinned", pinned, reason: FOLLOW_PIN_GONE };
  }
  if (plotDatasetId !== null && datasets.some((d) => d.id === plotDatasetId)) return { kind: "dataset", mode: "plot", datasetId: plotDatasetId };
  return { kind: "none", mode: "plot", reason: FOLLOW_NO_PLOT };
}

// The names of datasets a window has shown, so a pin to one that was removed can still say which
// ("two-peaks.csv was removed", not "removed dataset"; UX pass 3 m-7). Session memory, not saved.
const seenNames = new Map<string, string>();
export const rememberDatasetName = (id: string, name: string): void => void seenNames.set(id, name);
export const rememberedDatasetName = (id: string): string | undefined => seenNames.get(id);
