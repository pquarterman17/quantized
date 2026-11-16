// Peak analyzer step ④ — the mixed-shape model fit's result (audit P2.4
// slice 2): convergence, the warnings (first, and loud), per-peak derived
// centre / FWHM / height / area with standard errors, the parameter table,
// and the metrics under the objective's honest label. Every missing error is
// a "—" whose tooltip says WHY (./modelFitReasons).

import type { PeakModelFitResponse } from "../../../lib/api/peaks";
import { sigFigs } from "../../../lib/fitValueFormat";
import { fmtNum } from "../../../lib/format";
import { valueErrCells } from "../../../lib/valueErrCells";
import { DataTable } from "../../primitives/DataTable";
import { StatusDot } from "../../primitives";
import { derivedErrorReason, metricRows, paramErrorReason, type DerivedKey } from "./modelFitReasons";
import { paramLabel, tieText } from "./peakModelParams";

const faint = { color: "var(--text-faint)" } as const;
const SHAPE_LABEL: Record<string, string> = {
  gaussian: "Gauss", lorentzian: "Lorentz", pseudo_voigt: "pV", voigt: "Voigt",
  split_gaussian: "asym. G", split_lorentzian: "asym. L", split_pseudo_voigt: "asym. pV",
  pearson_vii: "PVII", fano: "Fano", doniach_sunjic: "DS",
};

/** Value over its error (lib/valueErrCells: Curve Fit's rounding, shared by
 *  every peak table). `stacked` (the per-peak table) puts the error on a
 *  second line, so six columns fit the docked 420 px window without a
 *  sideways scroll (fitting live check: height and area were cut off); inline
 *  (the parameter table) it is Curve Fit's one-line "2.33 ± 0.12" /
 *  "(5.94 ± 0.30)×10⁻⁴". A missing error is a dash that explains itself on
 *  hover; the unrounded error is in the tooltip. */
function Pm({ value, err, reason, stacked = false }: {
  value: number | null; err: number | null; reason: string | null; stacked?: boolean;
}) {
  const c = valueErrCells(value, err);
  const tip = c.error !== null ? `± ${fmtNum(err)}` : (reason ?? "no error reported");
  if (!stacked && c.inline !== null) return <span style={{ whiteSpace: "nowrap" }} title={tip}>{c.inline}</span>;
  return (
    <span style={{ whiteSpace: "nowrap", display: stacked ? "inline-flex" : undefined, flexDirection: "column", alignItems: "flex-end" }}>
      <span>{c.value}</span>{" "}
      <span style={faint} title={tip} {...(c.error === null ? { "data-no-error": "" } : {})}>± {c.error ?? "—"}</span>
    </span>
  );
}

const KEYS: DerivedKey[] = ["center", "fwhm", "height", "area"];

export default function ModelFitResults({ r }: { r: PeakModelFitResponse }) {
  const metrics = metricRows(r.metrics);
  return (
    <div style={{ marginTop: 8 }}>
      <StatusDot
        tone={r.success && r.warnings.length === 0 ? "ok" : "warn"}
        label={<span>{r.success ? "converged" : "did not converge"} · {r.message}</span>}
      />
      {r.warnings.length > 0 && (
        <ul
          role="list"
          aria-label="fit warnings"
          style={{ margin: "6px 0 0", paddingLeft: 16, color: "var(--warn)", fontSize: "var(--font-size-sm)" }}
        >
          {r.warnings.map((w, i) => (
            <li key={i}>⚠ {w}</li>
          ))}
        </ul>
      )}
      <div className="qzk-dense-table" data-testid="peak-results" style={{ marginTop: 6, maxHeight: 180, overflow: "auto" }}>
        <DataTable
          columns={["#", "shape", "center", "FWHM", "height", "area"]}
          rows={r.peaks.map((p, k) => [
            k + 1,
            SHAPE_LABEL[p.shape] ?? p.shape,
            ...KEYS.map((key) => (
              <Pm
                key={key}
                value={p[key]}
                err={p[`${key}_stderr`]}
                reason={derivedErrorReason(r, k, key)}
                stacked
              />
            )),
          ])}
        />
      </div>
      <details style={{ marginTop: 6 }}>
        <summary className="qzk-field-lbl" style={{ margin: 0 }}>
          Parameters ({r.free.length} free of {r.parameters.length})
        </summary>
        <div style={{ maxHeight: 180, overflow: "auto" }}>
          <DataTable
            columns={["parameter", "value", "status"]}
            rows={r.parameters.map((p) => [
              <span key="n" title={p.name}>{paramLabel(p.name)}</span>,
              <Pm key="v" value={p.value} err={p.stderr} reason={paramErrorReason(r, p)} />,
              p.tie
                ? `tied → ${tieText(p)}` + (p.tie_coef_vary ? ` (${p.tie_op === "offset" ? "offset" : "ratio"} fitted ± ${p.tie_coef_stderr == null ? "—" : sigFigs(p.tie_coef_stderr, 2)})` : "")
                : !p.vary ? "fixed" : p.at_bound ? "at bound" : "free",
            ])}
          />
        </div>
      </details>
      <div aria-label="fit metrics" style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px", marginTop: 6 }}>
        {metrics.map(([label, v]) => (
          <span key={label} className="qzk-ds-meta" style={{ margin: 0 }}>
            <span style={faint}>{label}</span>{" "}
            <span style={{ fontFamily: "var(--font-mono)" }}>{fmtNum(v)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
