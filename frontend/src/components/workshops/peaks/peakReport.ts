// Peaks workshop — the `multipeak_fit` report payload ("→ Report"). Pure: no
// React, no store, no fetch. Ported from PR #434's `reportResult`, adapted to
// this branch's PeakTable field names (lib/peakTable.ts).
//
// A classic (Peaks-workshop) fit sends the fit result exactly as before, so its
// report is byte-identical to the one it always produced. A table the Peak
// Analyzer's model fit PUBLISHED (`provenance.producer === "model_fit"`) sends
// the durable rows instead — the same "one source for the numbers" the panel's
// cells read (PeaksPanel.tsx) — with every 1σ column (`ERR_COLUMNS`: centre,
// FWHM, height, area, η, the Voigt widths; null where the fit reported none,
// which the report prints as a dash), the Voigt width values, and the fit's
// objective, SSR, χ² and R². calc/report_emit.py's `from_multipeak_fit`
// prints them as "±" columns and goodness-of-fit rows.

import { ERR_COLUMNS, ERR_FIELDS, type MultiFitResult, type PeakTable, type PeakTableEntry } from "../../../lib/peakTable";

/** One peak as the report reads it. */
function reportPeak(e: PeakTableEntry): Record<string, unknown> {
  const out: Record<string, unknown> = {
    model: e.model,
    center: e.center,
    fwhm: e.fwhm,
    height: e.height,
    area: e.area,
    bg: e.bg,
    eta: e.eta,
    status: e.status,
    fwhmG: e.fwhmG ?? null,
    fwhmL: e.fwhmL ?? null,
  };
  for (const f of ERR_FIELDS) out[ERR_COLUMNS[f]] = e[ERR_COLUMNS[f]] ?? null;
  return out;
}

/** The `result` of the Peaks workshop's `multipeak_fit` report request.
 *  `entries` are the durable rows ONLY when the panel has paired them with the
 *  shown fit (same dataset, same row count); null otherwise. */
export function peakReportResult(
  fit: MultiFitResult,
  entries: readonly PeakTableEntry[] | null,
  table: PeakTable | null | undefined,
): Record<string, unknown> {
  const p = table?.provenance;
  if (!entries || p?.producer !== "model_fit") return fit as unknown as Record<string, unknown>;
  return {
    ...fit,
    peaks: entries.map(reportPeak),
    nPeaks: entries.length,
    model: p.model,
    R2: p.R2,
    rmse: p.rmse,
    objective: p.objective ?? "ssr",
    ssr: p.ssr ?? null,
    chi2: p.chi2 ?? null,
  };
}
