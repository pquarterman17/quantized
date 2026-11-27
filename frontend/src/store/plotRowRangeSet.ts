// The plot's row window setter (ROW_RANGE_CONTRACT 3.3): a view edit, so one undo step restores it. Lazy: only the
// worksheet's "Plot only these rows" and the plot chip's clear call it, so it costs the startup chunk nothing.
// An unreadable range is refused, never clamped.

import { sanitizeRowRange } from "../lib/rowRangeSanitize";
import type { RowRange } from "../lib/rowRange";
import { useApp } from "./useApp";

export function setPlotRowRange(range: RowRange | null): void {
  const next = sanitizeRowRange(range);
  if (range && !next) return;
  useApp.getState().recordHistory(next ? "plot row range" : "clear plot row range");
  useApp.setState({ rowRange: next });
}
