// Copy the currently displayed plot to the clipboard as TSV — the fastest way to
// drop exactly what's on screen into Origin / Excel / a notebook. Reads the
// display payload, so it honors the x-axis source, plotted-channel selection,
// waterfall offsets, and any overlays (fit / baseline / peaks). The TSV builder
// is pure + tested; the clipboard write is a thin, capability-guarded wrapper.

import type { PlotPayload } from "./plotdata";

/** Serialize the display payload to tab-separated values with a header row.
 *  Columns are x then each plotted series (overlays included); `null` cells
 *  (gaps / NaN) become empty fields so the row width stays constant. */
export function payloadToTSV(payload: PlotPayload): string {
  const header = [
    payload.xUnit ? `${payload.xLabel} (${payload.xUnit})` : payload.xLabel,
    ...payload.series.map((s) => (s.unit ? `${s.label} (${s.unit})` : s.label)),
  ];
  const cols = payload.data;
  const nRows = cols[0]?.length ?? 0;
  const lines = [header.join("\t")];
  for (let i = 0; i < nRows; i++) {
    lines.push(cols.map((c) => (c[i] == null ? "" : String(c[i]))).join("\t"));
  }
  return lines.join("\n");
}

/** Serialize a header row + data rows to TSV (the row-oriented complement to
 *  payloadToTSV — used by the worksheet "Copy rows"). Cells: null/undefined →
 *  empty field, else String(cell) at full precision. */
export function tableToTSV(
  headers: string[],
  rows: (number | string | null | undefined)[][],
): string {
  const cell = (v: number | string | null | undefined): string => (v == null ? "" : String(v));
  const lines = [headers.join("\t")];
  for (const row of rows) lines.push(row.map(cell).join("\t"));
  return lines.join("\n");
}

/** Write text to the clipboard; resolves false when unavailable (insecure
 *  context / permission denied) so callers can surface a status message. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* permission denied or non-secure context — fall through to false */
  }
  return false;
}
