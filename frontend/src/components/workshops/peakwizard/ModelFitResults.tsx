// Peak Analyzer step ④ — the mixed-shape model fit's result (audit P2.4
// slice 2): convergence, the warnings (first, and loud), per-peak derived
// centre / FWHM / height / area with standard errors, the parameter table,
// and the metrics under the objective's honest label. Every missing error is
// a "—" whose tooltip says WHY (./modelFitReasons).

import type { ReactNode } from "react";

import type { PeakModelFitResponse } from "../../../lib/api/peaks";
import { fmtNum } from "../../../lib/format";
import { DataTable } from "../../primitives/DataTable";
import { StatusDot } from "../../primitives";
import { derivedErrorReason, metricRows, paramErrorReason, type DerivedKey } from "./modelFitReasons";
import { paramLabel } from "./peakModelParams";

const faint = { color: "var(--text-faint)" } as const;
const SHAPE_LABEL: Record<string, string> = {
  gaussian: "Gauss", lorentzian: "Lorentz", pseudo_voigt: "pV", voigt: "Voigt",
};

/** "± err", or a dash that explains itself on hover. */
function Err({ err, reason }: { err: number | null; reason: string | null }): ReactNode {
  if (err !== null) return <span style={faint}>± {fmtNum(err)}</span>;
  return (
    <span style={faint} title={reason ?? "no error reported"} data-no-error="">
      ± —
    </span>
  );
}

function Pm({ value, err, reason }: { value: number | null; err: number | null; reason: string | null }) {
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      {fmtNum(value)} <Err err={err} reason={reason} />
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
      <div style={{ marginTop: 6, maxHeight: 180, overflow: "auto" }}>
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
              p.tie ? `tied → ${paramLabel(p.tie)}` : !p.vary ? "fixed" : p.at_bound ? "at bound" : "free",
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
