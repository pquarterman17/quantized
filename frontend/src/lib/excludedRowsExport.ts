// Greyed excluded rows on the publication export wire (FIGURE_AUTHORING_
// WORKFLOW_PLAN F4.2c (a), owner decision 2026-09-29).
//
// The canvas has two ways to draw a row that is excluded or dropped by the
// Data Filter (the app-wide "Excluded rows" preference): hide it, or keep it
// visible as a muted, point-only "(excluded)" companion of its series
// (`plotdata.maskExcludedPayload`). Every export used to omit those rows
// unconditionally (`rowstate.pruneToLiveDataset`), so a greyed screen
// exported as a hidden one. This module builds the "greyed" export from
// fields the `/api/export/figure` request already has — no backend change:
//
//   * the pruned wire `dataset` is re-indexed as [kept rows…, dropped rows…],
//     so every kept row sits exactly where the "omit" export put it and the
//     plotted series draw byte-identically; on the appended dropped rows the
//     plotted channels are NaN (they draw nothing there);
//   * one ghost CHANNEL per plotted channel is appended, NaN on kept rows and
//     the dropped value on dropped rows, labelled "<label> (excluded)" — the
//     canvas companion's own label — and added to `y_keys` AFTER the plotted
//     ones, so every display-position-keyed list (palette slot, dash/marker
//     cycle, fill `vs`) is untouched;
//   * each ghost gets an explicit grey, line-free, small-marker style and its
//     parent's secondary-axis membership, waterfall and decade offsets, the
//     same order the canvas applies them in (offset first, then mask).
//
// Like the canvas, a ghost counts as a series: a lone series plus its ghost
// gets a legend and loses its solo-axis title on screen AND in the export.
//
// NOT supported (the spec is returned unchanged, so a caller comparing the
// two builds sees "no difference" and does not ask): a faceted request (the
// faceted Stage grid never greys either — its panels are built from the
// pruned view) and a Color/Symbol-encoded request (the encoded renderer
// colours every split series by its level, which would repaint the ghosts).

import type { FigureSpec } from "./api/figures";
import type { ExcludedRowsGhoster } from "./figureSpec";
import type { ExportSeriesStyle } from "./exportStyles";
import { activeRowIndices } from "./rowstate";
import { sliceRowSidecars } from "./rowSidecars";
import type { DataStruct } from "./types";
import type { ExcludedDisplay } from "../store/useApp";

/** How an export draws excluded/filter-dropped rows — chosen per export. */
export type ExcludedRowsExport = "grey" | "omit";

/** The ghost marker style. A literal on purpose: this is the colour of ink on
 *  the exported paper, not a themed screen colour (the canvas uses its own
 *  `--text-dim` token), and matplotlib needs a concrete value. */
export const EXCLUDED_GHOST_STYLE: Readonly<ExportSeriesStyle> = {
  color: "#9a9a9a",
  line: "none",
  width: 0,
  marker: true,
  marker_size: 3,
};

/** Append greyed "(excluded)" companion series to a finished flat export
 *  spec. `data` is the UNPRUNED DataStruct the spec was built from and
 *  `dropped` the rows the spec's `dataset` omits; returns `spec` itself (same
 *  reference) when there is nothing to grey or the request shape cannot
 *  carry ghosts (see the module header). */
export function withExcludedGhosts(
  spec: FigureSpec,
  data: DataStruct,
  dropped: ReadonlySet<number>,
): FigureSpec {
  const n = data.time.length;
  const plotted = spec.y_keys;
  if (dropped.size === 0 || spec.facets || spec.encoding || !plotted?.length) return spec;
  if (plotted.some((k) => typeof k !== "number")) return spec;
  const kept = activeRowIndices(n, dropped);
  // The spec must be the pruned view of THIS data, or its rows do not line up.
  if (spec.dataset.time.length !== kept.length) return spec;
  const lost = [...dropped].filter((r) => r >= 0 && r < n).sort((a, b) => a - b);
  if (lost.length === 0) return spec;
  const keys = plotted as number[];
  const width = spec.dataset.labels.length;
  const xKey = typeof spec.x_key === "number" ? spec.x_key : null;
  const order = [...kept, ...lost];
  const values = order.map((r, i) => {
    const src = data.values[r] ?? [];
    const row = src.slice(0, width);
    const isLost = i >= kept.length;
    if (isLost) for (const k of keys) if (k !== xKey) row[k] = Number.NaN;
    for (const k of keys) row.push(isLost ? (src[k] ?? Number.NaN) : Number.NaN);
    return row;
  });
  const ghostKeys = keys.map((_k, j) => width + j);
  const ghostOf = new Map(keys.map((k, j) => [k, ghostKeys[j]] as const));
  const dataset: DataStruct = {
    ...spec.dataset,
    time: order.map((r) => data.time[r]),
    values,
    labels: [...spec.dataset.labels, ...keys.map((k) => `${spec.dataset.labels[k] ?? `col ${k}`} (excluded)`)],
    units: [...spec.dataset.units, ...keys.map((k) => spec.dataset.units[k] ?? "")],
    metadata: sliceRowSidecars(data.metadata, order),
  };
  const styles = spec.series_styles ?? keys.map(() => null);
  const ghostStyles = keys.map((_k, j) => {
    const legend = styles[j]?.legend;
    return { ...EXCLUDED_GHOST_STYLE, ...(legend ? { legend: `${legend} (excluded)` } : {}) };
  });
  const repeat = <T>(list: T[] | undefined): T[] | undefined => (list ? [...list, ...list.slice(0, keys.length)] : undefined);
  return {
    ...spec,
    dataset,
    y_keys: [...keys, ...ghostKeys],
    ...(spec.y2_keys ? { y2_keys: [...spec.y2_keys, ...spec.y2_keys.map((k) => ghostOf.get(k as number) ?? k)] } : {}),
    series_styles: [...styles, ...ghostStyles],
    ...(spec.error_spans ? { error_spans: [...spec.error_spans, ...keys.map(() => null)] } : {}),
    ...(spec.waterfall_offsets ? { waterfall_offsets: repeat(spec.waterfall_offsets) } : {}),
    ...(spec.log_offsets ? { log_offsets: repeat(spec.log_offsets) } : {}),
  };
}

/** The transform a builder is handed for the app-wide display mode — what
 *  a preview that mirrors the canvas (the Figure Page composer) renders with. */
export function ghosterFor(mode: ExcludedDisplay): ExcludedRowsGhoster | undefined {
  return mode === "grey" ? withExcludedGhosts : undefined;
}

/** Does a "grey" build carry anything its "omit" twin does not? The one
 *  question every export entry point asks before prompting: no masked rows,
 *  or a shape that cannot grey them, means both builds are identical and the
 *  export goes ahead without a question. */
export function excludedChoiceMatters(grey: FigureSpec, omit: FigureSpec): boolean {
  return (grey.y_keys?.length ?? 0) !== (omit.y_keys?.length ?? 0);
}
