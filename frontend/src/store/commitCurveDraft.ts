// The draft behind the Plot details popup (plan item 50, E7): every tab of ONE
// curve's editor edits this, and Apply commits it as ONE undo step.
//
// The draft holds a copy of the style map, not one `SeriesStyle`: "Floats from
// the series above" writes the series above too (SeriesBarsControl), and the
// sub-controls call `setSeriesStyle(channel, patch)` for whichever channel they
// need, so the draft takes the same call the store does. It also holds the
// curve's error column, which is not a style field (it lives in `errKeys` and
// the dataset's error roles, written by `pickSeriesYError`).

import type { SeriesStyle } from "../lib/types";
import { pickSeriesYError } from "./pickSeriesYError";
import { useApp } from "./useApp";

export interface CurveDraft {
  styles: Record<number, SeriesStyle>;
  /** The error column drawn for the curve; null = none. */
  errCol: number | null;
}

export type DraftSetStyle = (channel: number, patch: Partial<SeriesStyle>, coalesce?: string) => void;

const live = (s: SeriesStyle | undefined): [string, unknown][] =>
  Object.entries(s ?? {}).filter(([, v]) => v !== undefined);

/** The keys of `next` that differ from `cur` (a key `next` lacks reads undefined). */
export function stylePatch(cur: SeriesStyle | undefined, next: SeriesStyle | undefined): Partial<SeriesStyle> | null {
  const a = Object.fromEntries(live(cur));
  const b = Object.fromEntries(live(next));
  const patch: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) patch[k] = b[k];
  }
  return Object.keys(patch).length ? (patch as Partial<SeriesStyle>) : null;
}

/** Write the draft through the store's own setters as ONE undo step. Returns
 *  false (and records nothing) when the draft equals the live state. */
export function commitCurveDraft(channel: number, datasetId: string, draft: CurveDraft, initialErr: number | null): boolean {
  const s = useApp.getState();
  const edits: [number, Partial<SeriesStyle> | "reset"][] = [];
  for (const key of new Set([...Object.keys(s.seriesStyles), ...Object.keys(draft.styles)].map(Number))) {
    const patch = stylePatch(s.seriesStyles[key], draft.styles[key]);
    if (!patch) continue;
    edits.push([key, live(draft.styles[key]).length === 0 ? "reset" : patch]);
  }
  const errChanged = draft.errCol !== initialErr;
  if (edits.length === 0 && !errChanged) return false;
  // Each setter records its own entry; keep only the first, whose snapshot is
  // the state before any of them ran, so one Ctrl+Z undoes the whole Apply.
  s.recordHistory("edit curve");
  const mark = useApp.getState().history.at(-1)?.seq;
  for (const [key, patch] of edits) {
    if (patch === "reset") s.resetSeriesStyle(key);
    else s.setSeriesStyle(key, patch);
  }
  if (errChanged) pickSeriesYError(datasetId, channel, draft.errCol);
  useApp.setState((st) => {
    const i = st.history.findIndex((e) => e.seq === mark);
    return i < 0 ? {} : { history: st.history.slice(0, i + 1) };
  });
  return true;
}
