// Figure-page (GOTO #4 multi-panel composer) endpoint wrappers — the
// `/api/export/figure-page` half of the typed backend client. Extracted
// from `lib/api.ts` (FIGURE_AUTHORING_WORKFLOW_PLAN F3.5): that file sits at
// its size-ratchet pin (JMP_GAP #14, `architecture.test.ts`), and F3.5's new
// layout-control fields (row_gap/col_gap/link_x/link_y/align_labels/
// resize_mode) would have pushed it back over. Same template as
// `api/plot.ts`/`api/stats.ts` — new figure-page fields/wrappers go HERE,
// not in api.ts.
//
// Re-exported by `lib/api.ts`, so every consumer (the Figure Page workshop)
// keeps importing from `./lib/api` unchanged. `FigureSpec` is a type-only
// import from `../api` (erased at compile time -- no runtime circular
// dependency), since it is api.ts's own single-figure payload type and the
// established sibling convention (api/plot.ts, api/stats.ts) is to avoid a
// VALUE dependency on api.ts, not a type-only one.

import { postBlob, postDownload } from "./http";
import type { FigureSpec } from "../api";

/** One figure-page panel (GOTO #4): a single-figure payload + its grid cell.
 *  The nested figure's own fmt/style/dpi/filename are ignored (page-level). */
export interface PagePanelSpec {
  figure: FigureSpec;
  row: number;
  col: number;
  row_span?: number;
  col_span?: number;
  /** Explicit label; omit = auto "(a)", "(b)", … in placement order; "" = none. */
  label?: string;
  /** Per-panel title override; omit = the nested figure payload's title. */
  title?: string;
  /** #54 residual: page-normalized [x, y, w, h], TOP-LEFT origin (the
   *  frontend's NormalizedFrameRect convention). When EVERY panel on the
   *  page sets this, the composer places panels at their true page
   *  coordinates instead of row/col (see calc.figure_page). Omit (the
   *  default) for the ordinary grid path; row/col are still required by
   *  this schema but unused when every panel sets page_rect. */
  page_rect?: [number, number, number, number];
}

/** Multi-panel figure page request (GOTO #4): N plots -> ONE exported page. */
export interface FigurePageSpec {
  rows: number;
  cols: number;
  panels: PagePanelSpec[];
  fmt?: string; // pdf (default) / svg vector; png / tiff raster — vector-first
  style?: string;
  dpi?: number;
  width_in?: number;
  height_in?: number;
  label_format?: string; // (a) | a) | a. | (A) | A) | A. | none
  label_pos?: string; // nw | ne | outside
  filename?: string;
  // F3.5 layout controls (calc.figure_page_layout) -- all default to
  // today's exact rendering when omitted (byte-identical).
  row_gap?: number | null;
  col_gap?: number | null;
  link_x?: boolean;
  link_y?: boolean;
  align_labels?: boolean;
  resize_mode?: string; // constrained | tight | none
}

/** Compose N plots onto one publication page server-side and download it. */
export function exportFigurePage(body: FigurePageSpec): Promise<void> {
  return postDownload("/api/export/figure-page", body, `figure_page.${body.fmt ?? "pdf"}`);
}

/** Render the page and return the raw image bytes — the composer UI's
 *  low-DPI PNG preview (same pattern as api.ts's renderFigureBlob). */
export function renderFigurePageBlob(body: FigurePageSpec): Promise<Blob> {
  return postBlob("/api/export/figure-page", body);
}
