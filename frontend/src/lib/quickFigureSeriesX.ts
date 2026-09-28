// Per-series X for the Quick Figure Builder (LIBRARY_WORKBOOK_UX_PLAN,
// "Required column-role inference": `X, Y, X, Y, X, Y` and "multiple
// independent X channels in one worksheet").
//
// `PlotView`/`FigureDocument` bind ONE X per figure, and this deliberately
// does not add a second, per-series X field to them. A worksheet whose Y
// columns each have their own X is instead rendered the way the app already
// renders one: a derived SEGMENT-CONCATENATED overlay (`lib/originOverlay.ts`,
// the representation Origin multi-X figure apply and "Plot selected
// together" land). One X block per distinct X, in first-series order; the
// overlay's `time` is those X columns concatenated, and each series' values
// live only inside its own block (NaN elsewhere). Never a sorted X union, so
// a non-monotonic sweep (a hysteresis loop) keeps its acquisition row order.
// The preview draws this overlay and the created figure binds to it as a new
// Library dataset, so the two cannot disagree.
//
// X error: an X-error binding (`target: -1`) means the SHARED axis everywhere
// in the render pipeline (`lib/errorbars.ts`'s `buildErrorSpans`), and there
// is no way to say "this series' own X" -- the same limit
// `lib/originBookRoles.ts` documents. So X error fills only the shared-X
// block; a series on its own X draws no X bars rather than another X's.

import type { ErrorBinding } from "./errorRoles";
import type { QuickFigureMapping } from "./quickFigureMapping";
import { droppedRows } from "./rowstate";
import type { DataStruct, Dataset } from "./types";

/** The X a Y series plots against: its own override, else the shared X. */
export function seriesXKey(mapping: QuickFigureMapping, y: number): number | null {
  const own = mapping.xKeyByY;
  return own && Object.hasOwn(own, y) ? (own[y] ?? null) : mapping.xKey;
}

/** True when at least one assigned Y plots against something other than the
 *  shared X -- the only case that needs the overlay. */
export function usesPerSeriesX(mapping: QuickFigureMapping): boolean {
  return mapping.yKeys.some((y) => seriesXKey(mapping, y) !== mapping.xKey);
}

/** Display name of one X source (null = acquisition axis) -- the same
 *  fallback chain `axisDisplayName`/`buildColumns` use for the time axis. */
export function xSourceName(data: DataStruct, x: number | null): string {
  if (x !== null) return data.labels[x] ?? `col ${x}`;
  return String(data.metadata?.["x_column_long"] || data.metadata?.["x_column_name"] || "Acquisition axis");
}

export interface QuickFigureOverlay {
  /** The segment-concatenated data: `blocks.length * n` rows. */
  data: DataStruct;
  /** A SHARED-X mapping over `data` (acquisition axis = the concatenated X):
   *  Y series first (same order), then error columns, then the group column.
   *  No `labelKey`: point labels are data-anchored and computed from the
   *  source (`lib/quickFigureLabels.ts`), so they need no overlay column. */
  mapping: QuickFigureMapping;
  /** Each block's X source, in block order. */
  blocks: (number | null)[];
}

/** Build the overlay for a per-series-X mapping, or null when every Y shares
 *  one X (then the source data plots directly, unchanged). Pure. */
export function quickFigureOverlay(data: DataStruct, mapping: QuickFigureMapping): QuickFigureOverlay | null {
  if (!usesPerSeriesX(mapping)) return null;
  const n = data.time.length;
  const blocks: (number | null)[] = [];
  const blockOf = (x: number | null): number => {
    const at = blocks.indexOf(x);
    return at >= 0 ? at : blocks.push(x) - 1;
  };
  // `block: -1` = every block (the group column: its level applies to a row
  // whichever series is drawn there).
  const cols = mapping.yKeys.map((src) => ({ src, block: blockOf(seriesXKey(mapping, src)) }));
  const errorBindings: ErrorBinding[] = [];
  for (const b of mapping.errorBindings) {
    const target = b.axis === "x" ? -1 : mapping.yKeys.indexOf(b.target);
    // -1: a Y error whose target is not a plotted Y, or an X error with no
    // series on the shared X -- neither could draw a bar, so neither is carried.
    const block = b.axis === "x" ? blocks.indexOf(mapping.xKey) : target < 0 ? -1 : cols[target].block;
    if (block < 0) continue;
    errorBindings.push({ channel: cols.length, target, axis: b.axis, side: b.side });
    cols.push({ src: b.channel, block });
  }
  const g = mapping.groupKey ?? null;
  const groupKey = g === null ? null : cols.push({ src: g, block: -1 }) - 1;

  const time: number[] = [];
  const values: number[][] = [];
  blocks.forEach((x, bi) => {
    for (let r = 0; r < n; r++) {
      const row = data.values[r];
      time.push(x === null ? data.time[r] : (row?.[x] ?? NaN));
      values.push(cols.map((c) => (c.block === bi || c.block === -1 ? (row?.[c.src] ?? NaN) : NaN)));
    }
  });
  const rekey = <T>(src: Record<number, T> | undefined): Record<number, T> | undefined => {
    if (!src) return undefined;
    const out: Record<number, T> = {};
    cols.forEach((c, i) => {
      if (src[c.src] !== undefined) out[i] = src[c.src];
    });
    return Object.keys(out).length > 0 ? out : undefined;
  };
  const catLevels = rekey(data.cat_levels);
  const levelOrder = rekey(data.level_order);
  const names = [...new Set(blocks.map((x) => xSourceName(data, x)))];
  const units = [...new Set(blocks.map((x) => (x === null ? String(data.metadata?.["x_column_unit"] ?? "") : (data.units[x] ?? ""))))];
  return {
    data: {
      time,
      values,
      labels: cols.map((c) => data.labels[c.src] ?? `col ${c.src}`),
      units: cols.map((c) => data.units[c.src] ?? ""),
      metadata: {
        source_format: "quick-figure-overlay",
        x_column_long: names.join(" / "),
        x_column_unit: units.length === 1 ? units[0] : "",
      },
      ...(catLevels ? { cat_levels: catLevels } : {}),
      ...(levelOrder ? { level_order: levelOrder } : {}),
    },
    mapping: {
      xKey: null,
      yKeys: mapping.yKeys.map((_, i) => i),
      errorBindings,
      ignoredKeys: [],
      ...(groupKey !== null ? { groupKey } : {}),
    },
    blocks,
  };
}

/** The Library dataset a created per-series-X figure binds to. Rows the
 *  source hides (exclusion or local filter) stay hidden: they are carried as
 *  excluded rows of every block, so the figure drops exactly the points a
 *  shared-X figure on the source would. Provenance is stamped in metadata;
 *  never `derivedFrom`, which would enter the recalc graph. */
export function quickFigureOverlayDataset(id: string, source: Dataset, overlay: QuickFigureOverlay): Dataset {
  const n = source.data.time.length;
  const dropped = [...droppedRows(source)].sort((a, b) => a - b);
  const excluded = overlay.blocks.flatMap((_, bi) => dropped.map((r) => bi * n + r));
  return {
    id,
    name: `${source.name} — per-series X`,
    data: { ...overlay.data, metadata: { ...overlay.data.metadata, quick_figure_source: source.id } },
    errorRoles: overlay.mapping.errorBindings,
    ...(excluded.length > 0 ? { excludedRows: excluded } : {}),
  };
}
