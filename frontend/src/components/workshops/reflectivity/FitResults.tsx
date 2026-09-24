// Reflectivity fit — results view: the objective (labelled for what it is —
// only dR weighting yields a χ²), convergence, evaluation count, warnings and
// the fitted parameters (value ± standard error, "—" where the backend reports
// none, and a flag for a parameter that ended on a bound).

import type { ReflFitResult } from "../../../lib/api/reflectivity";
import { formatNum, objectiveSummary } from "./reflFitModel";

const MONO = { fontFamily: "var(--font-mono)" } as const;
const COLS = "96px 1fr 1fr 64px";

/** What the table reads — a live result or a saved one (which has no curves). */
type FitSummary = Omit<ReflFitResult, "curves" | "sld_profiles">;

export default function FitResults({ result }: { result: FitSummary }) {
  const obj = objectiveSummary(result);
  const shown = result.parameters.filter((p) => p.vary || p.tie);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }} aria-label="fit results">
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 12px" }} className="qzk-ds-meta">
        <span>{obj.label}</span>
        <span style={MONO} data-testid="refl-fit-objective">{formatNum(obj.value)}</span>
        <span>status</span>
        <span style={{ color: result.success ? "var(--ok)" : "var(--warn)" }}>
          {result.success ? "converged" : "not converged"} — {result.message}
        </span>
        <span>evaluations</span>
        <span style={MONO}>{result.n_evaluations}</span>
        <span>points / free</span>
        <span style={MONO}>
          {result.n_points} / {result.n_free}
        </span>
      </div>

      {result.warnings.length > 0 && (
        <ul className="qzk-ds-meta qzk-msg" role="note" style={{ margin: 0, paddingLeft: 16, color: "var(--warn)" }}>
          {result.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      {shown.length > 0 && (
        <div role="table" aria-label="fitted parameters">
          <div role="row" className="qzk-ds-meta" style={{ display: "grid", gridTemplateColumns: COLS, gap: 4 }}>
            <span role="columnheader">parameter</span>
            <span role="columnheader">value</span>
            <span role="columnheader">± stderr</span>
            <span role="columnheader">bound</span>
          </div>
          {shown.map((p) => (
            <div key={p.name} role="row" style={{ display: "grid", gridTemplateColumns: COLS, gap: 4, fontSize: "var(--font-size-sm)" }}>
              <span role="rowheader" style={{ ...MONO, color: "var(--text-dim)" }}>
                {p.name}
                {p.tie ? ` = ${p.tie}` : ""}
              </span>
              <span role="cell" style={MONO}>{formatNum(p.value)}</span>
              <span role="cell" style={MONO}>{p.stderr == null ? "—" : `± ${formatNum(p.stderr)}`}</span>
              <span role="cell" title={p.at_bound ? "ended on a bound — widen it or fix the parameter" : undefined} style={{ color: "var(--warn)" }}>
                {p.at_bound ? "at bound" : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
