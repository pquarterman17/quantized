// The app-level figure commands' way into the statistics stage's own export.
//
// "Export figure…", "Copy figure" and "Send figure to report" build an XY
// `FigureSpec` (lib/figureSpecStage.ts), which cannot describe a box / violin /
// strip / bar / Q-Q / histogram plot. The stat stage already has a correct
// export (Stage/statStageExport.ts, gated on a settled draw by
// Stage/useStatStageExport.ts), but it lives in a React hook. The FOCUSED
// StatStage registers that exporter here while it is mounted; the commands look
// it up and route to it instead of exporting XY (lib/statFigureCommands.ts).
// Background stat windows never register: they are not what the commands
// export.
//
// lib/ may not import components/, so the request type lives here and
// statStageExport.ts imports it.

import type { CategoricalFigureSpec, StatplotFigureSpec } from "./api/figures";
import { postBlob } from "./api/http";

/** One stat figure request: which export route renders it, and its body. */
export type StatStageRequest =
  | { route: "statplot"; spec: StatplotFigureSpec }
  | { route: "categorical"; spec: CategoricalFigureSpec };

/** How a caller wants the stat figure: publication style / DPI, where the
 *  built request goes (default: downloaded as a file), and the caller's own
 *  Cancel signal (then the stage opens no StatusBar op of its own). */
export interface StatExportOut {
  style?: string;
  dpi?: number;
  deliver?: (req: StatStageRequest, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
}

/** The stage's export: waits for the settled draw, builds the request in
 *  `fmt` and delivers it. Resolves false when cancelled; rejects on failure. */
export type StatStageExporter = (fmt: string, out?: StatExportOut) => Promise<boolean>;

let registered: StatStageExporter | null = null;

/** Register the focused stat stage's exporter; the returned function
 *  unregisters it (only if it is still the registered one). */
export function registerStatStageExporter(fn: StatStageExporter): () => void {
  registered = fn;
  return () => {
    if (registered === fn) registered = null;
  };
}

/** The exporter for the plot on screen: the stat stage's when stat mode is
 *  what the Stage draws (polar wins over it, as in PlotStage), else null. */
export function activeStatExporter(st: { polarMode: boolean; statMode: boolean }): StatStageExporter | null {
  return st.statMode && !st.polarMode ? registered : null;
}

/** The route path for each request kind (lib/api/figures.ts posts the same). */
const ROUTE_PATH = {
  statplot: "/api/export/statplot-figure",
  categorical: "/api/export/categorical-figure",
} as const;

/** Render the stat figure through its own route and return the bytes, for
 *  the paths that need an image rather than a download (copy, report).
 *  `outlines` asks for SVG glyphs as paths (`svg_text_as_paths`). */
export async function renderStatFigureBlob(
  exporter: StatStageExporter,
  fmt: string,
  out: StatExportOut,
  outlines = false,
): Promise<Blob> {
  const got: { blob: Blob | null } = { blob: null };
  const done = await exporter(fmt, {
    ...out,
    deliver: async (req, signal) => {
      const body = outlines ? { ...req.spec, svg_text_as_paths: true } : req.spec;
      got.blob = await postBlob(ROUTE_PATH[req.route], body, signal);
    },
  });
  if (!done) throw new DOMException("cancelled", "AbortError");
  if (!got.blob) throw new Error("the statistics plot has nothing to render yet");
  return got.blob;
}
