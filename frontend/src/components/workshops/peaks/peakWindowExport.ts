// Peaks window — the visible peak list as CSV (Export CSV) or TSV (Copy), and
// the d-spacing context for its d (Å) column (UX9-F). Pure: no React, no store.
//
// One table, whichever the window is showing: the fitted peaks once a fit
// exists, else the detected candidates (the same fitted-over-detected choice
// the window's "Label peaks" makes). Values are full precision; a `_1sigma`
// column appears only when some row carries that error (lib/analysisPeakTable's
// rule). The d column is the first-order Bragg d of `center` and appears only
// when the x axis is 2θ in degrees.

import { csvTextCell } from "../../../lib/csvCell";
import { fmtNum } from "../../../lib/format";
import { xAxisIsTwoThetaDegrees, xChannelIdentity } from "../../../lib/peakTableFit";
import type { Dataset } from "../../../lib/types";
import { braggD, CU_KA1_A } from "../../../lib/xrdIndex";
import { wavelengthFromMetadata } from "../../../lib/xrdWavelength";

/** λ for the d column, and whether it was assumed (no wavelength in the file). */
export interface DContext { wavelength: number; assumed: boolean }

/** The d column's wavelength, or null when x is not 2θ in degrees. */
export function peakDContext(ds: Dataset | null | undefined, xKey: number | null): DContext | null {
  if (!ds || !xAxisIsTwoThetaDegrees(xChannelIdentity(ds.data, xKey))) return null;
  const meta = wavelengthFromMetadata(ds.data.metadata);
  return { wavelength: meta ?? CU_KA1_A, assumed: meta == null };
}

/** Header text of the d column (names the assumed λ so the number is honest). */
export function dHeader(ctx: DContext): string {
  return ctx.assumed ? `d (Å, λ ${CU_KA1_A})` : "d (Å)";
}

/** The d cell(s) for one row: none without a context, else the formatted d. */
export function dCells(ctx: DContext | null, center: number): string[] {
  return ctx ? [fmtNum(braggD(center, ctx.wavelength))] : [];
}

/** The fields any peak row may carry (detected `Peak`, `FittedPeak`, or a durable entry). */
export interface ExportPeak {
  center: number;
  height: number;
  fwhm: number;
  area?: number | null;
  localSNR?: number;
  excluded?: boolean;
  centerErr?: number | null;
  fwhmErr?: number | null;
  heightErr?: number | null;
  areaErr?: number | null;
}

const num = (v: number | null | undefined): string =>
  v === null || v === undefined || !Number.isFinite(v) ? "" : String(v);
const usable = (e: unknown): e is number => typeof e === "number" && Number.isFinite(e) && e > 0;

type Col = [string, (p: ExportPeak) => string];

/** Header + string cells for `peaks` (fitted or detected). */
export function peakWindowTable(
  peaks: readonly ExportPeak[],
  kind: "fitted" | "detected",
  d: DContext | null,
): { header: string[]; rows: string[][] } {
  const errCol = (name: string, key: "centerErr" | "fwhmErr" | "heightErr" | "areaErr"): Col[] =>
    peaks.some((p) => usable(p[key])) ? [[`${name}_1sigma`, (p) => num(p[key])]] : [];
  const cols: Col[] = [
    ["peak", () => ""],
    ["center", (p) => num(p.center)],
    ...errCol("center", "centerErr"),
    ...(d ? [[d.assumed ? `d_A (lambda ${CU_KA1_A} assumed)` : "d_A", (p) => num(braggD(p.center, d.wavelength))] as Col] : []),
    ["height", (p) => num(p.height)],
    ...errCol("height", "heightErr"),
    ["fwhm", (p) => num(p.fwhm)],
    ...errCol("fwhm", "fwhmErr"),
    ...(kind === "fitted"
      ? [["area", (p) => num(p.area)] as Col, ...errCol("area", "areaErr"),
        ["included", (p) => (p.excluded ? "false" : "true")] as Col]
      : [["snr", (p) => num(p.localSNR)] as Col]),
  ];
  return {
    header: cols.map(([h]) => h),
    rows: peaks.map((p, i) => cols.map(([, get], j) => (j === 0 ? String(i + 1) : get(p)))),
  };
}

/** RFC-4180 CSV (header cells formula-neutralized, values are plain numbers). */
export function peakWindowCsv(t: { header: string[]; rows: string[][] }): string {
  return `${[t.header.map(csvTextCell).join(","), ...t.rows.map((r) => r.join(","))].join("\n")}\n`;
}

/** Tab-separated, for pasting into a spreadsheet. */
export function peakWindowTsv(t: { header: string[]; rows: string[][] }): string {
  return [t.header.join("\t"), ...t.rows.map((r) => r.join("\t"))].join("\n");
}
