// The plot's row window (ROW_RANGE_CONTRACT 3.3) for the aux figures that are drawn by the server from the whole
// sheet: the polar map and the G15 plots (parallel coordinates, hexbin, 2-D KDE, Pareto, Bland-Altman). The
// preview and Export both build their request from the sheet CUT to the window's rows (`lib/rowWindowDataset`, the
// one cut every other plot kind uses), so the picture is the window's rows alone, on screen and in the export.
//   - no window: the sheet itself;
//   - a window that does not fit the sheet: not applied on screen (every row, the chip says "not applied"), and the
//     export refuses it, as every figure export does;
//   - a named link that cannot be read (deleted, stale): NO rows on screen with the reason as the problem, and the
//     export refuses with the same reason. Never widened to every row.

import { useMemo } from "react";

import { plotRowRangeState } from "../../../lib/plotRowRangeState";
import { rowRangeRefusal, type RowRange } from "../../../lib/rowRange";
import { windowedDataset } from "../../../lib/rowWindowDataset";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";

/** `active` cut to the plot's window, and why a named link draws nothing (null otherwise). */
export function useWindowedActive<T extends Dataset | null | undefined>(active: T): { sheet: T; windowProblem: string | null } {
  const range = useApp((s) => s.rowRange);
  const { from, to, refused } = range ?? {}; // by value: a window's view is a fresh object
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sheet = useMemo(() => windowedDataset(active, range), [active, from, to, refused]);
  return { sheet, windowProblem: range?.refused !== undefined ? `Plot row range: ${range.refused}.` : null };
}

/** The full sheet `ds` cut to `range` for an export. A window that cannot be applied is refused (thrown, with the reason). */
export function windowForExport(ds: Dataset, range: RowRange | null | undefined): Dataset {
  if (!range) return ds;
  const refusal = ds.pending != null ? "the worksheet's full data is still loading" : rowRangeRefusal(range, ds.data.time.length);
  if (refusal) throw new Error(`Plot row range: ${refusal}.`);
  return windowedDataset(ds, range);
}

/** One sentence naming the window a workshop panel (no stage chip of its own) draws from, in SOURCE rows, or null
 *  without a window. A window that does not fit says it is not applied; the Export then refuses it. */
export function windowNote(range: RowRange | null | undefined, rows: number): string | null {
  if (!range) return null;
  const { applied, label, refusal } = plotRowRangeState(range, rows);
  if (applied) return `Plot row range: only ${label} are drawn.`;
  return range.refused !== undefined ? null : `Plot row range ${label}: ${refusal}. Every row is drawn here; Export refuses it.`;
}

/** `windowNote` for the active sheet and the plot's current window. */
export function useWindowNote(): string | null {
  const range = useApp((s) => s.rowRange);
  const rows = useApp((s) => s.datasets.find((d) => d.id === s.activeId)?.data.time.length ?? 0);
  return windowNote(range, rows);
}
