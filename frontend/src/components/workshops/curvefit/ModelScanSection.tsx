// Curve Fit workshop — AICc model quick-scan section (GOTO #6). Isolated
// sub-component (BumpsSection conventions) so the collision surface with
// parallel workshop edits stays tiny: CurveFitPanel owns the useModelScan
// hook (results survive the registry<->custom mode flip) and mounts
// <ModelScanSection state={...} onApply={...}/>. "Scan models" fits every
// plausible registry model (backend default: param count < n/3) PLUS every
// saved custom equation model, ranks by AICc, and clicking a ranked row
// applies that model to the workshop's picker. Failed candidates stay
// visible with their error — a model that can't fit is itself a result.

import { Button } from "../../primitives";
import { fmtNum as fmt } from "../../../lib/format";
import type { ScanEntry } from "../../../lib/api";
import type { ModelScanState } from "./useModelScan";

interface Props {
  state: ModelScanState;
  /** Apply a scanned model to the workshop; `kind` routes registry names vs
   *  saved custom equation models (picker-value building stays in the panel). */
  onApply: (kind: "registry" | "equation", name: string) => void;
}

function label(e: ScanEntry): string {
  return e.kind === "equation" ? `ƒ ${e.name}` : e.name;
}

export default function ModelScanSection({ state, onApply }: Props) {
  const { hasDataset, results, busy, error, scan, clear } = state;

  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border-soft)" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Button
          size="sm"
          disabled={!hasDataset || busy}
          title="Fit all plausible models (registry + saved custom equations) and rank by AICc"
          onClick={() => void scan()}
        >
          {busy ? "Scanning…" : "Scan models"}
        </Button>
        {results && !busy && (
          <Button size="sm" onClick={clear}>
            Clear
          </Button>
        )}
      </div>

      {error && (
        <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {results && !busy && (
        <div style={{ marginTop: 8, maxHeight: 240, overflowY: "auto" }}>
          <table className="qz-table">
            <thead>
              <tr>
                <th>model</th>
                <th>k</th>
                <th>AICc</th>
                <th>Δ</th>
                <th>w</th>
                <th>R²</th>
              </tr>
            </thead>
            <tbody>
              {results.map((e) => (
                <tr
                  key={`${e.kind}:${e.name}`}
                  title={e.error ?? "Apply this model to the workshop"}
                  style={{ opacity: e.error ? 0.6 : 1 }}
                  onClick={() => {
                    if (!e.error) onApply(e.kind, e.name);
                  }}
                >
                  <td>{label(e)}</td>
                  {e.error ? (
                    <td colSpan={5} style={{ color: "var(--danger)" }}>
                      {e.error}
                    </td>
                  ) : (
                    <>
                      <td>{e.k}</td>
                      <td>{fmt(e.AICc)}</td>
                      <td>{fmt(e.deltaAICc)}</td>
                      <td>{fmt(e.weight)}</td>
                      <td>{fmt(e.R2)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="qzk-ds-meta" style={{ marginTop: 4, color: "var(--text-faint)" }}>
            Δ = AICc − best; w = Akaike weight. Click a row to apply that model.
          </div>
        </div>
      )}
    </div>
  );
}
