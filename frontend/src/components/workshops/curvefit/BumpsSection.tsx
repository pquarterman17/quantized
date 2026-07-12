// Curve Fit workshop — optional bumps engine section (GOTO #10). Isolated
// sub-component: CurveFitPanel only mounts <BumpsSection modelName={...}/>,
// keeping the collision surface with parallel workshop edits to two lines.
// "Parity (MATLAB)" is the default engine and renders nothing extra — the
// workshop's main Fit button stays the parity path. Uncertainties are
// labeled by kind (Hessian vs posterior) per the GOTO #10 decision.

import { Button, DataTable, NumberField, Select } from "../../primitives";
import { fmtNum as fmt } from "../../../lib/format";
import DreamConvergence from "./DreamConvergence";
import { useBumpsFit, type EngineChoice } from "./useBumpsFit";

/** Parse a sampling-control field to a positive int (blank/garbage -> keep the
 *  prior value by returning NaN, which the setter ignores). */
function posInt(v: string): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : Number.NaN;
}

const ENGINE_OPTIONS: { value: EngineChoice; label: string }[] = [
  { value: "parity", label: "Parity (default)" },
  { value: "amoeba", label: "bumps — amoeba (Nelder-Mead)" },
  { value: "lm", label: "bumps — Levenberg-Marquardt" },
  { value: "de", label: "bumps — differential evolution" },
  { value: "dream", label: "bumps — DREAM (posterior)" },
];

export default function BumpsSection({ modelName }: { modelName: string }) {
  const { hasDataset, engine, setEngine, dream, setDream, result, busy, progress, error, run, cancel } =
    useBumpsFit();

  const setDreamField = (k: "samples" | "burn" | "pop") => (v: string) => {
    const n = posInt(v);
    if (Number.isFinite(n)) setDream({ [k]: n });
  };

  const kindLabel =
    result?.uncertainty_kind === "posterior"
      ? "posterior (DREAM 68% interval)"
      : "Hessian estimate";

  const paramRows = (result?.popt ?? []).map((p, i) => [
    result?.paramNames[i] ?? `p${i + 1}`,
    fmt(p),
    fmt(result?.uncertainties[i]),
  ]);

  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border-soft)" }}>
      <label className="qzk-field-lbl">Engine</label>
      <Select
        options={ENGINE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        value={engine}
        onChange={(e) => setEngine(e.target.value as EngineChoice)}
      />

      {engine !== "parity" && (
        <>
          <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
            <Button
              variant="primary"
              size="sm"
              disabled={!hasDataset || busy}
              onClick={() => void run(modelName)}
            >
              {busy ? "Fitting…" : engine === "dream" ? "Sample posterior" : "Fit (bumps)"}
            </Button>
            {busy && engine === "dream" && (
              <Button size="sm" onClick={() => void cancel()}>
                Cancel
              </Button>
            )}
          </div>

          {engine === "dream" && (
            <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "center" }}>
              <label className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
                samples{" "}
                <NumberField
                  value={dream.samples}
                  onChange={setDreamField("samples")}
                  disabled={busy}
                  width={72}
                />
              </label>
              <label className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
                burn{" "}
                <NumberField
                  value={dream.burn}
                  onChange={setDreamField("burn")}
                  disabled={busy}
                  width={56}
                />
              </label>
              <label className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
                pop{" "}
                <NumberField
                  value={dream.pop}
                  onChange={setDreamField("pop")}
                  disabled={busy}
                  width={48}
                />
              </label>
            </div>
          )}

          {busy && engine === "dream" && (
            <div style={{ marginTop: 8 }}>
              <div
                aria-label="DREAM progress"
                style={{
                  height: 4,
                  borderRadius: 2,
                  background: "var(--surface-2)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${Math.round((progress ?? 0) * 100)}%`,
                    height: "100%",
                    background: "var(--accent)",
                  }}
                />
              </div>
              <div
                className="qzk-ds-meta"
                style={{ marginTop: 4, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}
              >
                {Math.round((progress ?? 0) * 100)}% — sampling posterior
              </div>
            </div>
          )}

          {error && (
            <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--danger)" }}>
              {error}
            </div>
          )}

          {result && !busy && (
            <div style={{ marginTop: 12 }}>
              <DataTable
                columns={["param", "value", `± ${result.uncertainty_kind}`]}
                rows={paramRows}
              />
              <DataTable
                columns={["stat", "value"]}
                rows={[
                  ["χ²red", fmt(result.chisq)],
                  ["engine", result.engine],
                ]}
              />
              <div className="qzk-ds-meta" style={{ marginTop: 6, color: "var(--text-faint)" }}>
                Uncertainties: {kindLabel}
              </div>
              <DreamConvergence posterior={result.posterior} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
