// Panel insets (audit item #15): a movable/resizable box INSIDE a graph that
// shows something OTHER than that graph's own data -- another dataset's
// columns with their own axes/scale/legend ("dataset"), a raster photo or
// schematic ("image"), or a small table such as fit parameters ("table").
// This generalizes the magnifier inset's "floating box over the plot" family
// (`PlotView.inset` / `Stage/InsetPlot.tsx` / `calc/figure_inset.py`) rather
// than the canvas-plugin annotation/shape family: same `at` placement
// convention (frame fractions, top-origin), same screen/export parity
// discipline, but MULTIPLE boxes per plot (an array, like `shapes`/
// `annotations`) since a user may want a zoomed trace, a photo, AND a fit
// table on one figure at once.
//
// A "dataset" panel inset is a FROZEN SNAPSHOT of another dataset's columns,
// captured by the screen when the inset is inserted -- not a live binding.
// The live cross-series linking machinery (lib/linkedCurves*, perSeriesX*,
// figureSpecPerSeriesX*, …) is a separate, actively-changing workstream; a
// frozen snapshot needs none of it (re-insert to refresh from a changed
// source, same tradeoff `FigureDoc.dataSnapshot` already makes for a whole
// frozen document). Imported only by lazy code (the overlay layer, the
// insert dialog, and the export projection).

import { clampAt } from "./inset";
import type { FigureOverrides } from "./figureOverrides";

export type PanelInsetKind = "dataset" | "image" | "table";

/** Another dataset's columns, frozen at insertion time. `x`/each series' `y`
 *  are plain finite-number arrays (no live dataset reference) so the inset
 *  survives save/reload and undo/redo with no dependency on the source
 *  dataset still existing. */
export interface PanelInsetDatasetContent {
  kind: "dataset";
  title?: string;
  x: number[];
  series: { label: string; y: number[]; color?: string }[];
  xScale?: "linear" | "log";
  yScale?: "linear" | "log";
  legend?: boolean;
}

/** A raster image (PNG/JPEG), captured via file picker or paste as a data
 *  URL, same as the digitizer's calibration-image capture
 *  (`components/workshops/digitizer/DigitizerView.tsx`). */
export interface PanelInsetImageContent {
  kind: "image";
  title?: string;
  /** `data:image/png;base64,...` or `data:image/jpeg;base64,...`. */
  dataUrl: string;
}

/** A small text table (e.g. fit parameters). */
export interface PanelInsetTableContent {
  kind: "table";
  title?: string;
  headers?: string[];
  rows: string[][];
}

export type PanelInsetContent =
  | PanelInsetDatasetContent
  | PanelInsetImageContent
  | PanelInsetTableContent;

export interface PanelInset {
  id: string;
  /** The box's plot area as fractions of the main plot frame: [left, top,
   *  width, height], top-origin -- `InsetView.at`'s exact convention. */
  at: [number, number, number, number];
  content: PanelInsetContent;
}

/** Where a newly-inserted panel inset starts: the UPPER LEFT of the frame
 *  (the magnifier's own default, `DEFAULT_INSET_AT`, sits lower-right, so the
 *  two never start stacked when both are present). */
export const DEFAULT_PANEL_INSET_AT: PanelInset["at"] = [0.06, 0.06, 0.34, 0.3];

const IMAGE_DATA_URL = /^data:image\/(png|jpeg);base64,/;

function sanitizeDatasetContent(o: Record<string, unknown>): PanelInsetDatasetContent | null {
  if (!Array.isArray(o.x) || !o.x.every((n): n is number => typeof n === "number" && Number.isFinite(n))) {
    return null;
  }
  if (!Array.isArray(o.series) || o.series.length === 0) return null;
  const series: PanelInsetDatasetContent["series"] = [];
  for (const raw of o.series) {
    if (typeof raw !== "object" || raw === null) continue;
    const s = raw as Record<string, unknown>;
    if (!Array.isArray(s.y) || s.y.length !== o.x.length) continue;
    const y = s.y.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
    if (y.length !== o.x.length) continue;
    series.push({
      label: typeof s.label === "string" ? s.label : "",
      y,
      ...(typeof s.color === "string" && s.color ? { color: s.color } : {}),
    });
  }
  if (!series.length) return null;
  const scaleOf = (v: unknown): "linear" | "log" | undefined => (v === "log" ? "log" : v === "linear" ? "linear" : undefined);
  return {
    kind: "dataset",
    x: o.x as number[],
    series,
    ...(scaleOf(o.xScale) ? { xScale: scaleOf(o.xScale) } : {}),
    ...(scaleOf(o.yScale) ? { yScale: scaleOf(o.yScale) } : {}),
    ...(o.legend === true ? { legend: true } : {}),
    ...(typeof o.title === "string" && o.title ? { title: o.title } : {}),
  };
}

function sanitizeImageContent(o: Record<string, unknown>): PanelInsetImageContent | null {
  if (typeof o.dataUrl !== "string" || !IMAGE_DATA_URL.test(o.dataUrl)) return null;
  return {
    kind: "image",
    dataUrl: o.dataUrl,
    ...(typeof o.title === "string" && o.title ? { title: o.title } : {}),
  };
}

function sanitizeTableContent(o: Record<string, unknown>): PanelInsetTableContent | null {
  if (!Array.isArray(o.rows) || o.rows.length === 0) return null;
  const rows = o.rows
    .filter((r): r is unknown[] => Array.isArray(r))
    .map((r) => r.map((c) => (typeof c === "string" ? c : String(c))));
  if (!rows.length) return null;
  const headers = Array.isArray(o.headers) ? o.headers.map((h) => String(h)) : undefined;
  return {
    kind: "table",
    rows,
    ...(headers ? { headers } : {}),
    ...(typeof o.title === "string" && o.title ? { title: o.title } : {}),
  };
}

function sanitizeContent(v: unknown): PanelInsetContent | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o.kind === "dataset") return sanitizeDatasetContent(o);
  if (o.kind === "image") return sanitizeImageContent(o);
  if (o.kind === "table") return sanitizeTableContent(o);
  return null;
}

/** Validate a persisted panel-inset list (`.dwk` / undo-redo / plot recipes)
 *  -- an entry missing its required `id`/finite `at`/valid `content` is
 *  dropped (nothing sane to fall back to for a single list entry); `at` is
 *  clamped into the frame like the magnifier's own saved placement
 *  (`lib/inset.ts`'s `clampAt`). Never throws. */
export function sanitizePanelInsets(v: unknown): PanelInset[] {
  if (!Array.isArray(v)) return [];
  const out: PanelInset[] = [];
  for (const e of v) {
    if (typeof e !== "object" || e === null) continue;
    const o = e as Record<string, unknown>;
    if (typeof o.id !== "string" || !o.id) continue;
    const content = sanitizeContent(o.content);
    if (!content) continue;
    out.push({ id: o.id, at: clampAt(o.at as PanelInset["at"] | null | undefined), content });
  }
  return out;
}

type PanelInsetWire = NonNullable<FigureOverrides["panel_insets"]>[number];

/** One panel inset's export wire shape (no `id` -- the render request needs
 *  no identity, same as `shapes`/`annotations`). */
export function panelInsetWire(p: PanelInset): PanelInsetWire {
  const c = p.content;
  if (c.kind === "dataset") {
    return {
      at: p.at,
      content: {
        kind: "dataset",
        x: c.x,
        series: c.series.map((s) => ({ label: s.label, y: s.y, ...(s.color ? { color: s.color } : {}) })),
        ...(c.xScale ? { x_scale: c.xScale } : {}),
        ...(c.yScale ? { y_scale: c.yScale } : {}),
        ...(c.legend ? { legend: true } : {}),
        ...(c.title ? { title: c.title } : {}),
      },
    };
  }
  if (c.kind === "image") {
    const comma = c.dataUrl.indexOf(",");
    const format = c.dataUrl.includes("image/jpeg") ? "jpeg" : "png";
    return {
      at: p.at,
      content: {
        kind: "image",
        data: c.dataUrl.slice(comma + 1),
        format,
        ...(c.title ? { title: c.title } : {}),
      },
    };
  }
  return {
    at: p.at,
    content: {
      kind: "table",
      rows: c.rows,
      ...(c.headers ? { headers: c.headers } : {}),
      ...(c.title ? { title: c.title } : {}),
    },
  };
}
