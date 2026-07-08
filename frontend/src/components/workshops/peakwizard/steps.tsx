// Peak Analyzer wizard (#31) — the five step bodies. Presentational: every
// piece of state lives in usePeakWizard (passed down as `w`), so Back/Next
// never loses edits and each component stays small. The panel keys these by
// the recipe revision, so applying a saved recipe re-seeds the local fields.

import { useState } from "react";

import { fmtNum } from "../../../lib/format";
import { Button, Checkbox, DataTable, NumberField, Select, StatusDot } from "../../primitives";
import type { PeakWizardState } from "./usePeakWizard";

const faint = { color: "var(--text-faint)" } as const;

/** A labelled numeric field: local text echo, commits parsed finite values
 *  (or null when cleared) upward on change. */
function Num({
  label,
  value,
  onValue,
  placeholder,
  width = 84,
}: {
  label?: string;
  value: number | null;
  onValue: (v: number | null) => void;
  placeholder?: string;
  width?: number;
}) {
  const [text, setText] = useState(
    value === null || Number.isNaN(value) ? "" : String(value),
  );
  const field = (
    <NumberField
      value={text}
      placeholder={placeholder}
      width={width}
      onChange={(t) => {
        setText(t);
        if (t.trim() === "") onValue(null);
        else {
          const v = Number(t);
          if (Number.isFinite(v)) onValue(v);
        }
      }}
    />
  );
  if (!label) return field;
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
      <label className="qzk-field-lbl">{label}</label>
      {field}
    </span>
  );
}

/** ① Range & baseline: cut the fit window, pick a baseline, live preview. */
export function StepRangeBaseline({ w }: { w: PeakWizardState }) {
  const b = w.recipe.baseline;
  return (
    <>
      <label className="qzk-field-lbl">X range (blank = full)</label>
      <div style={{ display: "flex", gap: 6 }}>
        <Num
          value={w.recipe.range.lo}
          placeholder="from"
          onValue={(v) => w.patchRecipe({ range: { lo: v } })}
        />
        <Num
          value={w.recipe.range.hi}
          placeholder="to"
          onValue={(v) => w.patchRecipe({ range: { hi: v } })}
        />
      </div>
      <label className="qzk-field-lbl" style={{ marginTop: 8 }}>
        Baseline
      </label>
      <Select
        options={[
          { value: "none", label: "None" },
          { value: "als", label: "ALS (asymmetric least squares)" },
          { value: "rollingball", label: "Rolling ball" },
          { value: "modpoly", label: "Modified polynomial" },
        ]}
        value={b.method}
        onChange={(e) =>
          w.patchRecipe({ baseline: { method: e.target.value as typeof b.method } })
        }
      />
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        {b.method === "als" && (
          <>
            <Num label="λ" value={b.lam} onValue={(v) => v !== null && w.patchRecipe({ baseline: { lam: v } })} />
            <Num label="p" value={b.p} onValue={(v) => v !== null && w.patchRecipe({ baseline: { p: v } })} />
          </>
        )}
        {b.method === "rollingball" && (
          <Num
            label="radius (pts)"
            value={b.radius}
            onValue={(v) => v !== null && w.patchRecipe({ baseline: { radius: v } })}
          />
        )}
        {b.method === "modpoly" && (
          <Num
            label="order"
            value={b.order}
            onValue={(v) => v !== null && w.patchRecipe({ baseline: { order: Math.round(v) } })}
          />
        )}
      </div>
      {w.baselineBusy && <div className="qzk-ds-meta">estimating baseline…</div>}
      {w.baselineError && (
        <div className="qzk-ds-meta" style={{ color: "var(--danger)" }}>
          {w.baselineError}
        </div>
      )}
      {b.method !== "none" && !w.baselineBusy && !w.baselineError && (
        <div className="qzk-ds-meta" style={{ ...faint, marginTop: 6 }}>
          Baseline previewed on the plot; later steps fit the subtracted signal.
        </div>
      )}
    </>
  );
}

/** ② Find peaks: auto-find knobs + editable candidate list + manual add, plus
 *  click-on-plot editing (interaction item 5) while this step is showing. */
export function StepFindPeaks({ w }: { w: PeakWizardState }) {
  const [manualX, setManualX] = useState<number | null>(null);
  return (
    <>
      {w.markerEditActive && (
        <div className="qzk-ds-meta" style={{ ...faint, marginBottom: 6 }}>
          Click the plot to add a peak · click a marker to remove it (Esc to pause)
        </div>
      )}
      <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
        <Num
          label="SNR ≥"
          value={w.recipe.find.snr_threshold}
          onValue={(v) => v !== null && w.patchRecipe({ find: { snr_threshold: v } })}
        />
        <Num
          label="max peaks"
          value={w.recipe.find.max_peaks}
          onValue={(v) => v !== null && w.patchRecipe({ find: { max_peaks: Math.max(1, Math.round(v)) } })}
        />
        <Button size="sm" variant="primary" disabled={w.findBusy} onClick={() => void w.runFind()}>
          {w.findBusy ? "Finding…" : "Find peaks"}
        </Button>
      </div>
      {w.findError && (
        <div className="qzk-ds-meta" style={{ color: "var(--danger)", marginTop: 6 }}>
          {w.findError}
        </div>
      )}
      {w.candidates.length > 0 && (
        <div style={{ marginTop: 8, maxHeight: 180, overflowY: "auto" }}>
          <table className="qz-table">
            <thead>
              <tr>
                <th></th>
                <th>center</th>
                <th>height</th>
                <th>FWHM</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {w.candidates.map((c, i) => (
                <tr key={i} style={c.included ? undefined : { opacity: 0.45 }}>
                  <td>
                    <Checkbox checked={c.included} onChange={() => w.togglePeak(i)} />
                  </td>
                  <td>{fmtNum(c.center)}</td>
                  <td>{fmtNum(c.height)}</td>
                  <td>{fmtNum(c.fwhm)}</td>
                  <td>
                    <button
                      className="qz-btn qz-ghost qz-sm"
                      title={c.manual ? "remove manual peak" : "remove"}
                      onClick={() => w.removePeak(i)}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ display: "flex", gap: 6, alignItems: "flex-end", marginTop: 8 }}>
        <Num label="add peak at x =" value={manualX} onValue={setManualX} />
        <Button
          size="sm"
          disabled={manualX === null}
          onClick={() => {
            if (manualX !== null) w.addPeakAt(manualX);
            setManualX(null);
          }}
        >
          + Add
        </Button>
      </div>
    </>
  );
}

/** ③ Model & constraints. */
export function StepModel({ w }: { w: PeakWizardState }) {
  const m = w.recipe.model;
  return (
    <>
      <label className="qzk-field-lbl">Peak shape</label>
      <Select
        options={["Lorentzian", "Gaussian", "Pseudo-Voigt", "Split Pearson VII", "TCH-pV"].map(
          (s) => ({ value: s, label: s }),
        )}
        value={m.shape}
        onChange={(e) => w.patchRecipe({ model: { shape: e.target.value } })}
      />
      <label className="qzk-field-lbl" style={{ marginTop: 6 }}>
        Width linking
      </label>
      <Select
        options={["None", "Shared FWHM", "Shared FWHM + eta"].map((s) => ({
          value: s,
          label: s,
        }))}
        value={m.linkMode}
        onChange={(e) => w.patchRecipe({ model: { linkMode: e.target.value } })}
      />
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginTop: 6 }}>
        <Num
          label="background degree"
          value={m.bgDegree}
          onValue={(v) => v !== null && w.patchRecipe({ model: { bgDegree: Math.max(0, Math.round(v)) } })}
        />
        <Checkbox checked={m.constrain} onChange={(v) => w.patchRecipe({ model: { constrain: v } })}>
          constrain to window
        </Checkbox>
      </div>
      <div className="qzk-ds-meta" style={{ ...faint, marginTop: 8 }}>
        {w.candidates.filter((c) => c.included).length} peak(s) will be fit simultaneously with
        a shared polynomial background.
      </div>
    </>
  );
}

/** ④ Fit & review: run the simultaneous fit, per-peak table + GOF. */
export function StepFitReview({ w }: { w: PeakWizardState }) {
  const r = w.fitResult;
  return (
    <>
      <Button size="sm" variant="primary" disabled={w.fitBusy} onClick={() => void w.runFit()}>
        {w.fitBusy ? "Fitting…" : r ? "Re-fit" : "Fit"}
      </Button>
      {w.fitError && (
        <div className="qzk-ds-meta" style={{ color: "var(--danger)", marginTop: 6 }}>
          {w.fitError}
        </div>
      )}
      {r && (
        <div style={{ marginTop: 8 }}>
          <StatusDot
            tone={r.R2 !== null && r.R2 > 0.9 ? "ok" : "warn"}
            label={
              <span>
                {r.model} · R² = {fmtNum(r.R2)} · RMSE = {fmtNum(r.rmse)}
              </span>
            }
          />
          <div style={{ marginTop: 6, maxHeight: 200, overflowY: "auto" }}>
            <DataTable
              columns={["#", "center", "FWHM", "height", "area"]}
              rows={r.peaks.map((p, i) => [
                i + 1,
                fmtNum(p.center),
                fmtNum(p.fwhm),
                fmtNum(p.height),
                fmtNum(p.area),
              ])}
            />
          </div>
        </div>
      )}
    </>
  );
}

/** ⑤ Report: fit report, or the #32 integrate-only path, + recipe save. */
export function StepReport({ w }: { w: PeakWizardState }) {
  const [name, setName] = useState("");
  const mode = w.recipe.report.mode;
  return (
    <>
      <label className="qzk-field-lbl">Output</label>
      <Select
        options={[
          { value: "fit", label: "Fit report (peak table + GOF)" },
          { value: "integrate", label: "Integrate-only (areas / centroids / %)" },
        ]}
        value={mode}
        onChange={(e) => w.patchRecipe({ report: { mode: e.target.value as "fit" | "integrate" } })}
      />
      {mode === "integrate" && (
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end", marginTop: 6 }}>
          <Num
            label="region width (×FWHM)"
            value={w.recipe.report.regionWidth}
            onValue={(v) => v !== null && w.patchRecipe({ report: { regionWidth: v } })}
          />
          <Button size="sm" disabled={w.fitBusy} onClick={() => void w.runIntegrate()}>
            Integrate
          </Button>
        </div>
      )}
      {w.fitError && (
        <div className="qzk-ds-meta" style={{ color: "var(--danger)", marginTop: 6 }}>
          {w.fitError}
        </div>
      )}
      {mode === "integrate" && w.integrateResult && (
        <div style={{ marginTop: 8, maxHeight: 180, overflowY: "auto" }}>
          <DataTable
            columns={["region", "area", "%", "centroid", "FWHM"]}
            rows={w.integrateResult.peaks.map((p) => [
              `${fmtNum(p.region[0])}–${fmtNum(p.region[1])}`,
              fmtNum(p.area),
              fmtNum(p.area_pct),
              fmtNum(p.centroid),
              fmtNum(p.fwhm),
            ])}
          />
        </div>
      )}
      <div style={{ marginTop: 10 }}>
        <Button
          size="sm"
          variant="primary"
          disabled={w.reportBusy || (mode === "fit" ? !w.fitResult : !w.integrateResult)}
          onClick={() => void w.toReport()}
        >
          {w.reportBusy ? "Reporting…" : "→ Report"}
        </Button>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "flex-end", marginTop: 12 }}>
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 2, flex: 1 }}>
          <label className="qzk-field-lbl">Save as recipe</label>
          <NumberField
            numeric={false}
            width={160}
            value={name}
            placeholder="recipe name"
            onChange={setName}
          />
        </span>
        <Button size="sm" disabled={!name.trim()} onClick={() => w.saveRecipe(name.trim())}>
          Save
        </Button>
      </div>
    </>
  );
}
