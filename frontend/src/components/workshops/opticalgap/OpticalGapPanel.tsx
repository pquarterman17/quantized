// Optical gap (Tauc plot) — view. Pick the energy/wavelength and absorption
// (or transmittance) columns and a transition type; the linear region of the
// Tauc edge is detected automatically, or typed in as an energy window, and
// the extrapolated band gap is reported with its standard error and
// confidence interval. Logic lives in useOpticalGap.

import { useMemo } from "react";

import ToolWindow from "../../overlays/ToolWindow";
import { Button, Select } from "../../primitives";
import { DataTable } from "../../primitives/DataTable";
import { NumberField } from "../../primitives/NumberField";
import { fmtNum as fmt } from "../../../lib/format";
import { useAnalysisExtras } from "../../../store/analysisExtras";
import SmallUPlot from "../SmallUPlot";
import { pickOptions } from "../analysisextras/columnPicks";
import { taucPayload } from "./taucPlot";
import { TRANSITIONS, useOpticalGap } from "./useOpticalGap";

const X_UNITS = [
  { value: "eV", label: "Photon energy (eV)" },
  { value: "meV", label: "Photon energy (meV)" },
  { value: "cm-1", label: "Wavenumber (cm⁻¹)" },
  { value: "nm", label: "Wavelength (nm)" },
  { value: "A", label: "Wavelength (Å)" },
  { value: "um", label: "Wavelength (µm)" },
];
const SIGNALS = [
  { value: "alpha", label: "Absorption coefficient α (1/cm)" },
  { value: "absorbance", label: "Absorbance A (∝ α)" },
  { value: "transmittance", label: "Transmittance T" },
];
const SCALES = [
  { value: "fraction", label: "fraction (0 to 1)" },
  { value: "percent", label: "percent (0 to 100)" },
];

export default function OpticalGapPanel() {
  const hide = useAnalysisExtras((s) => s.hide);
  const g = useOpticalGap();
  const opts = pickOptions(g.columns);
  const r = g.result;
  const payload = useMemo(() => (r ? taucPayload(r, g.yLabel) : null), [r, g.yLabel]);
  const pct = r ? `${Math.round(r.level * 100)}%` : "95%";

  return (
    <ToolWindow id="optical-gap" title="Optical gap (Tauc plot)" width={460} onClose={() => hide("optical-gap")}>
      {!g.hasData ? (
        <div className="qzk-helptext">Select a dataset with an energy or wavelength column and an absorption or transmittance column.</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label className="qzk-field-lbl">Spectrum X</label>
              <Select aria-label="X column" options={opts} value={String(g.xCol)} onChange={(e) => g.setXCol(Number(e.target.value))} />
            </div>
            <div>
              <label className="qzk-field-lbl">X is</label>
              <Select aria-label="X quantity" options={X_UNITS} value={g.xUnit} onChange={(e) => g.setXUnit(e.target.value as typeof g.xUnit)} />
            </div>
            <div>
              <label className="qzk-field-lbl">Spectrum Y</label>
              <Select aria-label="Y column" options={opts} value={String(g.yCol)} onChange={(e) => g.setYCol(Number(e.target.value))} />
            </div>
            <div>
              <label className="qzk-field-lbl">Y is</label>
              <Select aria-label="Y quantity" options={SIGNALS} value={g.signal} onChange={(e) => g.setSignal(e.target.value as typeof g.signal)} />
            </div>
          </div>

          {g.signal === "absorbance" && (
            <div className="qzk-helptext" style={{ marginTop: 8 }}>
              The gap does not depend on the scale of α, so absorbance works as is. Give a thickness to put α in 1/cm.
              <div style={{ marginTop: 6 }}>
                <label className="qzk-field-lbl">Thickness (nm), optional</label>
                <NumberField aria-label="Film thickness (nm)" value={g.thickness} width={84} onChange={g.setThickness} />
              </div>
            </div>
          )}
          {g.signal === "transmittance" && (
            <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div>
                <label className="qzk-field-lbl">Thickness (nm)</label>
                <NumberField aria-label="Film thickness (nm)" value={g.thickness} width={84} onChange={g.setThickness} />
              </div>
              <div>
                <label className="qzk-field-lbl">T scale</label>
                <Select aria-label="Transmittance scale" options={SCALES} value={g.percent ? "percent" : "fraction"} onChange={(e) => g.setPercent(e.target.value === "percent")} />
              </div>
              <div className="qzk-helptext" style={{ flex: 1, minWidth: 160 }}>
                α = −ln(T) / d. Use a reflection-corrected T when reflection is not negligible.
              </div>
            </div>
          )}

          <div style={{ marginTop: 8 }}>
            <label className="qzk-field-lbl">Transition</label>
            <Select aria-label="Transition type" options={TRANSITIONS} value={g.kind} onChange={(e) => g.setKind(e.target.value as typeof g.kind)} />
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div>
              <label className="qzk-field-lbl">Fit from (eV)</label>
              <NumberField aria-label="Fit range minimum (eV)" value={g.eMin} width={76} placeholder="auto" onChange={g.setEMin} />
            </div>
            <div>
              <label className="qzk-field-lbl">to (eV)</label>
              <NumberField aria-label="Fit range maximum (eV)" value={g.eMax} width={76} placeholder="auto" onChange={g.setEMax} />
            </div>
            <Button variant="primary" size="sm" disabled={g.busy} onClick={() => void g.fit()}>
              {g.busy ? "Fitting…" : "Fit gap"}
            </Button>
          </div>
          <div className="qzk-helptext" style={{ marginTop: 6 }}>
            Leave the range empty to detect the straight section of the edge. For the best gap, choose the window by eye on the plot.
          </div>

          {g.error && (
            <div className="qzk-ds-meta" role="alert" style={{ marginTop: 10, color: "var(--warn)" }}>
              {g.error}
            </div>
          )}

          {r && payload && (
            <>
              <div style={{ marginTop: 12, fontFamily: "var(--font-mono)", fontSize: "var(--font-size-lg, 15px)" }}>
                Eg = {fmt(r.eg)} ± {fmt(r.eg_se)} eV
              </div>
              <div style={{ marginTop: 8 }}>
                <DataTable
                  columns={["stat", "value"]}
                  rows={[
                    ...(r.auto_window && r.eg_window_sd !== null
                      ? [
                          ["SE from the line fit (eV)", fmt(r.eg_se_fit)],
                          ["spread over neighbouring windows (eV)", fmt(r.eg_window_sd)],
                        ]
                      : []),
                    [`${pct} interval (eV)`, `${fmt(r.eg_lcl)} to ${fmt(r.eg_ucl)}`],
                    ["fit window (eV)", `${fmt(r.e_min)} to ${fmt(r.e_max)}${r.auto_window ? " (auto)" : ""}`],
                    ["points in fit", String(r.n_fit)],
                    ["slope", fmt(r.slope)],
                    ["R² of the line", fmt(r.r2)],
                  ]}
                />
              </div>
              {r.auto_window && (
                <div className="qzk-ds-meta" style={{ marginTop: 6 }}>
                  The window was detected from the data, so ± and the interval include how far Eg moves between neighbouring windows.
                </div>
              )}
              {r.r2 !== null && r.r2 < 0.98 && (
                <div className="qzk-ds-meta" role="status" style={{ marginTop: 6, color: "var(--warn)" }}>
                  The line fits the window poorly (R² {fmt(r.r2)}). Narrow the range to the straight part of the edge.
                </div>
              )}
              <div style={{ marginTop: 10 }}>
                <SmallUPlot payload={payload} label={`Tauc plot, band gap ${fmt(r.eg)} eV`} height={200} />
              </div>
              <div style={{ marginTop: 10 }}>
                <Button size="sm" title="Add the photon energy, α and the Tauc quantity as a new dataset" onClick={g.addTaucData}>
                  Add Tauc data as dataset
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </ToolWindow>
  );
}
