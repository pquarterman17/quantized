// The plot's row window setter (ROW_RANGE_CONTRACT 3.3): a view edit, so one undo step restores it. Lazy: only the
// worksheet's "Plot only these rows" and the plot chip's clear call it, so it costs the startup chunk nothing.
// An unreadable range is refused, never clamped.

import { resolveRangeLink } from "../lib/rangeLink";
import { sanitizeRowRange } from "../lib/rowRangeSanitize";
import type { RowRange } from "../lib/rowRange";
import { installRangeLinkSync } from "./rangeLinkSync";
import { useApp } from "./useApp";

export function setPlotRowRange(range: RowRange | null): void {
  const next = sanitizeRowRange(range);
  if (range && !next) return;
  useApp.getState().recordHistory(next ? "plot row range" : "clear plot row range");
  useApp.setState({ rowRange: next });
}

/** Make the plot FOLLOW a named range (ROW_RANGE_CONTRACT 5.2, `rowRange = { named: id }`): the window is whatever the name
 *  covers now, so a retarget, a row insert or a delete moves it, and a range that is deleted or whose rows were replaced
 *  refuses (no rows drawn, the chip says why) instead of widening. One undo step. Refused, with nothing changed, for a
 *  range that cannot be read now or that sits on another worksheet than the plot's. */
export function linkPlotRowRange(id: string): { ok: true } | { ok: false; reason: string } {
  const s = useApp.getState();
  if (!s.activeId) return { ok: false, reason: "no worksheet is plotted" };
  const link = resolveRangeLink(id, s.activeId, s.namedRanges, s.datasets);
  if (link.refused !== undefined) return { ok: false, reason: link.refused };
  s.recordHistory("plot row range from named range");
  useApp.setState({ rowRange: link });
  installRangeLinkSync();
  return { ok: true };
}
