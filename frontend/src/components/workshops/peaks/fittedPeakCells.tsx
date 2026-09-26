// Peaks workshop — how the durable table's uncertainties read in the fitted-
// peaks table (audit P2.1). A value with a 1σ error shows "value ± err"; a
// value whose producer said WHY it has no error (the Peak Analyzer's model
// fit, or a hand edit of such a row) shows "± —" with that reason on hover,
// the same convention as the analyzer's own results view; a classic-fit row,
// which never had errors, shows the bare value exactly as before.

import type { ReactNode } from "react";

import { fmtNum } from "../../../lib/format";
import type { MultiFitResult, PeakErrKey, PeakTableEntry, PeakTableProvenance } from "../../../lib/peakTable";

const faint = { color: "var(--text-faint)" } as const;

/** The 1σ error the table holds for `field`, or null. */
export function entryErr(entry: PeakTableEntry, field: PeakErrKey): number | null {
  return (field === "area" ? entry.areaErr : entry[`${field}Err`]) ?? null;
}

export function ValueErr({ value, entry, field }: {
  value: number | null;
  entry: PeakTableEntry | undefined;
  field: PeakErrKey;
}): ReactNode {
  const err = entry ? entryErr(entry, field) : null;
  const reason = entry?.errReasons?.[field];
  if (err === null && !reason) return fmtNum(value);
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      {fmtNum(value)}{" "}
      {err !== null ? (
        <span style={faint}>± {fmtNum(err)}</span>
      ) : (
        <span style={faint} title={reason} data-no-error="">
          ± —
        </span>
      )}
    </span>
  );
}

/** " · model fit · SSR = …" for a model-fit table; "" for a classic one. The
 *  objective keeps its honest name: χ² only for a weighted fit. */
export function producerNote(p: PeakTableProvenance | undefined): string {
  if (p?.producer !== "model_fit") return "";
  const o = p.objective;
  const obj = o && o.value !== null ? ` · ${o.kind === "chi2" ? "χ²" : "SSR"} = ${fmtNum(o.value)}` : "";
  return ` · model fit${obj}`;
}

/** The `multipeak_fit` report payload: the fit result, plus — when the rows
 *  are paired with the durable table — each peak's 1σ errors (null where the
 *  producer reported none) and the model fit's objective, which
 *  calc/report_emit.py's `from_multipeak_fit` prints as "±" columns and
 *  goodness-of-fit rows. A classic table carries no errors, so its report is
 *  unchanged. */
export function reportResult(
  fit: MultiFitResult,
  entries: readonly PeakTableEntry[] | null,
  provenance: PeakTableProvenance | undefined,
): MultiFitResult & { objective?: PeakTableProvenance["objective"] } {
  if (!entries || entries.length !== fit.peaks.length) return fit;
  return {
    ...fit,
    peaks: fit.peaks.map((p, i) => ({
      ...p,
      centerErr: entryErr(entries[i], "center"),
      fwhmErr: entryErr(entries[i], "fwhm"),
      heightErr: entryErr(entries[i], "height"),
      areaErr: entryErr(entries[i], "area"),
    })),
    ...(provenance?.objective ? { objective: provenance.objective } : {}),
  };
}
