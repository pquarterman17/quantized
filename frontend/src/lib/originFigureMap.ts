// Origin heatmap / contour / ternary figures (`OriginFigure.map` / `.ternary`,
// backend `io/origin_project/opju_map_plots.py`) -> the view that draws them.
// Apply-only: reached through `lib/originFigureSelection`'s re-export inside
// the lazy Origin-apply chunk (`store/originApplyLibs.ts`), never eagerly.
//
// A matrix map opens the Map tab on the matrix dataset (a 2-D map's default
// X/Y/Z picks ARE its X, Y, Z). An XYZ contour opens it only when the Map
// tab's own default picks are Origin's (X, Y, Z) columns: the picks are
// per-window local state this apply cannot set, so any other order is left
// in the plot view rather than mapped against the wrong columns. Colour
// limits stay auto (the data's own Z extent): Origin's colour scale is not
// decoded (`map_scale_not_decoded`). A ternary figure opens the ternary
// workshop with Origin's A, B, C columns in that order (`lib/ternaryPending`).

import { defaultMapKeys } from "./mapdataFetch";
import { requestTernaryPicks } from "./ternaryPending";
import type { Dataset, OriginFigure } from "./types";

/** Column letter -> aux-column index: the X column is -1, a value channel
 *  its index in `origin_column_names`; null when the dataset lacks it. */
function columnIndex(ds: Dataset, letter: string): number | null {
  const meta = (ds.data.metadata ?? {}) as Record<string, unknown>;
  if (letter === String(meta.x_column_name ?? "")) return -1;
  const letters = Array.isArray(meta.origin_column_names) ? meta.origin_column_names.map(String) : [];
  const i = letters.indexOf(letter);
  return i >= 0 ? i : null;
}

function bookOf(ds: Dataset): string {
  return String((ds.data.metadata ?? {}).origin_book ?? "");
}

/** The store patch that opens `figure`'s heatmap / contour in the Map tab on
 *  `ds`, or `{}` when the figure is no map of this dataset (module header). */
export function figureMapState(
  figure: OriginFigure,
  ds: Dataset | undefined,
): { stageTab?: "map"; contourOn?: boolean } {
  const map = figure.map;
  if (!map || !ds || bookOf(ds) !== map.book) return {};
  const isMatrix = ds.data.metadata?.["is2D"] === true;
  if (map.z === undefined) {
    if (!isMatrix) return {};
  } else {
    const want = [map.x, map.y, map.z].map((l) => columnIndex(ds, l ?? ""));
    // mapColumns(ds) puts the X column first: channel i is map column i + 1
    const keys = defaultMapKeys(ds.data).map((k) => k - 1);
    if (isMatrix || want.some((k, i) => k === null || k !== keys[i])) return {};
  }
  return { stageTab: "map", contourOn: map.kind === "contour" };
}

/** Queue `figure`'s ternary columns (A, B, C in Origin's order) for the
 *  ternary workshop and open it; true when queued. */
export function queueFigureTernary(figure: OriginFigure, ds: Dataset | undefined): boolean {
  const t = figure.ternary;
  if (!t || !ds || bookOf(ds) !== t.book) return false;
  const [a, b, c] = [t.a, t.b, t.c].map((l) => columnIndex(ds, l));
  if (a === null || b === null || c === null || new Set([a, b, c]).size !== 3) return false;
  requestTernaryPicks({ datasetId: ds.id, a, b, c });
  return true;
}
