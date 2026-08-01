// Multivariate workbench figure-export wrappers (JMP_GAP_PLAN #10 residual)
// — split out as its own sibling (not folded into api.ts, which sits at its
// size-ratchet pin, and not into api/stats.ts, which is scoped to `/api/
// stats/*`; these hit `/api/export/*`). Re-exported by `lib/api.ts` so
// MultivarPanel keeps importing from `./lib/api` unchanged, same convention
// as `api/stats.ts`.
//
// Each wrapper sends the SAME numbers the interactive canvas already fetched/
// computed (CorrelationResponse.r, the listwise-complete columns, PCAResponse
// scores/loadings, the scree explained/cumulative arrays) — server-side
// rendering (calc.figure_multivar) matches the on-screen read exactly, never
// re-deriving anything.

import { postDownload } from "./http";

export interface CorrelationHeatmapFigureSpec {
  labels: string[];
  r: number[][];
  title?: string;
  fmt?: string;
  style?: string;
  dpi?: number;
  width_in?: number;
  height_in?: number;
  filename?: string;
}

/** Render the correlation matrix as a publication heatmap (matplotlib) and
 *  download it. */
export function exportCorrelationHeatmapFigure(body: CorrelationHeatmapFigureSpec): Promise<void> {
  return postDownload(
    "/api/export/correlation-heatmap-figure",
    body,
    `correlation.${body.fmt ?? "pdf"}`,
  );
}

export interface SplomFigureSpec {
  labels: string[];
  /** Column-major — same shape as `statsCorrelation`'s `columns` argument. */
  columns: number[][];
  title?: string;
  fmt?: string;
  style?: string;
  dpi?: number;
  bins?: string | number;
  width_in?: number;
  height_in?: number;
  filename?: string;
}

/** Render the full n x n scatterplot matrix (matplotlib) and download it. */
export function exportSplomFigure(body: SplomFigureSpec): Promise<void> {
  return postDownload("/api/export/splom-figure", body, `splom.${body.fmt ?? "pdf"}`);
}

export interface PcaVectorSpec {
  x: number;
  y: number;
  label: string;
}

export interface PcaFigureSpec {
  mode: "scores" | "loadings" | "biplot";
  points?: number[][];
  vectors?: PcaVectorSpec[];
  x_label?: string;
  y_label?: string;
  title?: string;
  fmt?: string;
  style?: string;
  dpi?: number;
  width_in?: number;
  height_in?: number;
  filename?: string;
}

/** Render a PCA scores/loadings/biplot panel (matplotlib) and download it. */
export function exportPcaFigure(body: PcaFigureSpec): Promise<void> {
  return postDownload("/api/export/pca-figure", body, `pca.${body.fmt ?? "pdf"}`);
}

export interface PcaScreeFigureSpec {
  explained: number[];
  cumulative: number[];
  title?: string;
  fmt?: string;
  style?: string;
  dpi?: number;
  width_in?: number;
  height_in?: number;
  filename?: string;
}

/** Render a PCA scree plot (percent-explained bars + cumulative curve) and
 *  download it. */
export function exportPcaScreeFigure(body: PcaScreeFigureSpec): Promise<void> {
  return postDownload("/api/export/pca-scree-figure", body, `pca-scree.${body.fmt ?? "pdf"}`);
}
