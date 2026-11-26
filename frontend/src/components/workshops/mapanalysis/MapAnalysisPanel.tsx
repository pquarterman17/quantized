// Map analysis — view. A draggable ToolWindow for the active 2-D map: find and
// fit its peaks (Gaussian / Lorentzian, optional rotation) or integrate it over
// a rectangle with an optional constant / plane background. Every result is a
// NEW table dataset (never an edit of the map). Thin — the logic is in useMapAnalysis.

import ToolWindow from "../../overlays/ToolWindow";
import { Button, Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import { NumberField } from "../../primitives/NumberField";
import { useAnalysisExtras } from "../../../store/analysisExtras";
import type { MapAnalysisMode } from "./mapAnalysisForm";
import { useMapAnalysis, type MapAnalysisState } from "./useMapAnalysis";

const gap = { marginTop: 8 } as const;
const faint = { color: "var(--text-faint)" } as const;
const grid2 = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, ...gap } as const;

function PeakFields({ m }: { m: MapAnalysisState }) {
  const f = m.form;
  const set = m.setForm;
  return (
    <>
      <div className="qzk-helptext">Finds the brightest local maxima, then fits each with a 2-D peak model. Volume is the model&apos;s integral above its background.</div>
      <div style={grid2}>
        <div>
          <label className="qzk-field-lbl">Peak model</label>
          <Select aria-label="Peak model" options={[{ value: "gaussian", label: "Gaussian" }, { value: "lorentzian", label: "Lorentzian" }]} value={f.model} onChange={(e) => set({ model: e.target.value as typeof f.model })} />
        </div>
        <div>
          <label className="qzk-field-lbl">Number of peaks</label>
          <NumberField aria-label="Number of peaks" placeholder="all" value={f.nPeaks} onChange={(v) => set({ nPeaks: v })} />
        </div>
        <div>
          <label className="qzk-field-lbl">Threshold (0–1)</label>
          <NumberField aria-label="Threshold" value={f.threshold} onChange={(v) => set({ threshold: v })} />
        </div>
        <div>
          <label className="qzk-field-lbl">Min separation (cells)</label>
          <NumberField aria-label="Minimum separation" value={f.minSep} onChange={(v) => set({ minSep: v })} />
        </div>
        <div>
          <label className="qzk-field-lbl">Smoothing (cells)</label>
          <NumberField aria-label="Smoothing" value={f.smooth} onChange={(v) => set({ smooth: v })} />
        </div>
        <div>
          <label className="qzk-field-lbl" title="The smallest half-window around each peak; each fit uses the larger of this and 1.5 FWHM, so wide peaks are never cut.">Min. fit window (cells)</label>
          <NumberField aria-label="Minimum fit window" value={f.window} onChange={(v) => set({ window: v })} />
        </div>
      </div>
      <div style={gap}>
        <Checkbox checked={f.rotate} onChange={(v) => set({ rotate: v })}>Allow the peak to rotate (fit an angle)</Checkbox>
      </div>
      <div className="qzk-helptext" style={{ ...gap, ...faint }}>Threshold is a fraction of the smoothed map&apos;s range. An unreadable peak stays in the table, marked failed.</div>
    </>
  );
}

function VolumeFields({ m }: { m: MapAnalysisState }) {
  const f = m.form;
  const set = m.setForm;
  return (
    <>
      <div className="qzk-helptext">{f.rule === "trapezoid" ? "Trapezoid rule over the cells between pixel centres (Origin's integ2)." : "Sums (value − background) × cell area over the cells whose centre lies in the rectangle."}</div>
      <Button size="sm" disabled={!m.hasDrawnBox} onClick={m.applyDrawnBox} title={m.hasDrawnBox ? "Fill the bounds from the box drawn on the map" : "Draw a box on the map first (Box tool in the map toolbar)"} style={{ marginTop: 8, width: "100%" }}>
        Use box drawn on the map
      </Button>
      <div style={grid2}>
        <NumberField aria-label="X min" placeholder="X min" value={f.x0} onChange={(v) => set({ x0: v })} />
        <NumberField aria-label="X max" placeholder="X max" value={f.x1} onChange={(v) => set({ x1: v })} />
        <NumberField aria-label="Y min" placeholder="Y min" value={f.y0} onChange={(v) => set({ y0: v })} />
        <NumberField aria-label="Y max" placeholder="Y max" value={f.y1} onChange={(v) => set({ y1: v })} />
      </div>
      <label className="qzk-field-lbl" style={gap}>Integration rule</label>
      <Select aria-label="Integration rule" options={[{ value: "pixel", label: "Pixel cells (each pixel a full cell)" }, { value: "trapezoid", label: "Trapezoid (Origin integ2)" }]} value={f.rule} onChange={(e) => set({ rule: e.target.value as typeof f.rule })} />
      <label className="qzk-field-lbl" style={gap}>Background</label>
      <Select aria-label="Background" options={[{ value: "none", label: "None" }, { value: "constant", label: "Constant" }, { value: "plane", label: "Plane (fitted to the border)" }]} value={f.bg} onChange={(e) => set({ bg: e.target.value as typeof f.bg })} />
      {f.bg === "constant" && (
        <div style={gap}>
          <NumberField aria-label="Background level" placeholder="border mean" width={120} value={f.bgValue} onChange={(v) => set({ bgValue: v })} />
        </div>
      )}
      {f.bg !== "none" && (
        <div style={gap}>
          <label className="qzk-field-lbl">Border width (cells)</label>
          <NumberField aria-label="Border width" value={f.border} onChange={(v) => set({ border: v })} />
        </div>
      )}
      <div style={gap}>
        <Checkbox checked={f.skipEmpty} onChange={(v) => set({ skipEmpty: v })}>Skip empty cells (otherwise they stop the run)</Checkbox>
      </div>
    </>
  );
}

function MapAnalysisBody() {
  const hide = useAnalysisExtras((s) => s.hide);
  const m = useMapAnalysis();
  const opts = m.columns.map((c) => ({ value: String(c.index), label: c.label }));
  return (
    <ToolWindow id="map-analysis" title="Map analysis" width={340} onClose={() => hide("map-analysis")}>
      {!m.isMap ? (
        <div className="qzk-helptext">Select a 2-D map (an RSM, contour or image map) to find and fit its peaks or integrate a region.</div>
      ) : (
        <>
          <label className="qzk-field-lbl">Analysis of the active map</label>
          <Select aria-label="Analysis kind" options={[{ value: "peaks", label: "Find and fit peaks" }, { value: "volume", label: "Volume over a rectangle" }]} value={m.form.mode} onChange={(e) => m.setForm({ mode: e.target.value as MapAnalysisMode })} />
          {m.showPicks && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, ...gap }}>
              {(["X", "Y", "Value"] as const).map((lbl, i) => (
                <div key={lbl}>
                  <label className="qzk-field-lbl">{lbl}</label>
                  <Select aria-label={`${lbl} column`} options={opts} value={String(m.picks[i])} onChange={(e) => m.setPick(i as 0 | 1 | 2, Number(e.target.value))} />
                </div>
              ))}
            </div>
          )}
          <div style={gap}>{m.form.mode === "peaks" ? <PeakFields m={m} /> : <VolumeFields m={m} />}</div>
          <Button variant="primary" size="sm" disabled={m.busy} onClick={() => void m.run()} style={{ marginTop: 12, width: "100%" }}>
            {m.busy ? "Computing…" : "Apply → new table"}
          </Button>
          {m.busy && (
            <Button size="sm" onClick={m.cancel} style={{ marginTop: 6, width: "100%" }}>
              Cancel
            </Button>
          )}
          {m.error && (
            <div className="qzk-ds-meta" role="alert" style={{ marginTop: 8, color: "var(--danger)" }}>
              {m.error}
            </div>
          )}
          {m.summary.length > 0 && !m.error && (
            <div className="qzk-ds-meta" aria-label="Result" style={{ marginTop: 8 }}>
              {m.summary.map((l) => <div key={l}>{l}</div>)}
            </div>
          )}
        </>
      )}
    </ToolWindow>
  );
}

export default function MapAnalysisPanel() {
  return <MapAnalysisBody />;
}
