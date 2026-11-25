// Map operations — view. A draggable ToolWindow for the active 2-D map (RSM,
// contour or image map): crop, flip, rotate, transpose, plane level, map
// arithmetic, 2-D FFT / FFT filter and image filters with another map or a number. Every result is a NEW derived
// dataset (never an edit in place). Thin — the logic is in useMapOps.

import ToolWindow from "../../overlays/ToolWindow";
import { Button, Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import { NumberField } from "../../primitives/NumberField";
import { useAnalysisExtras } from "../../../store/analysisExtras";
import { FftFields, FftFilterFields, ImageFilterFields } from "./FilterFields";
import { ARITH_OPTIONS, OP_OPTIONS, type MapOpKind } from "./mapOpsForm";
import { useMapOps, type MapOpsState } from "./useMapOps";

const gap = { marginTop: 8 } as const;
const faint = { color: "var(--text-faint)" } as const;

function Fields({ m }: { m: MapOpsState }) {
  const f = m.form;
  const set = m.setForm;
  switch (f.op) {
    case "crop":
      return (
        <>
          <div className="qzk-helptext">Keep the cells inside the rectangle (inclusive). Leave a bound empty for no limit.</div>
          {m.ranges && (
            <div className="qzk-helptext" style={faint}>
              {m.ranges.x}
              <br />
              {m.ranges.y}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, ...gap }}>
            <NumberField aria-label="X min" placeholder="X min" value={f.xmin} onChange={(v) => set({ xmin: v })} />
            <NumberField aria-label="X max" placeholder="X max" value={f.xmax} onChange={(v) => set({ xmax: v })} />
            <NumberField aria-label="Y min" placeholder="Y min" value={f.ymin} onChange={(v) => set({ ymin: v })} />
            <NumberField aria-label="Y max" placeholder="Y max" value={f.ymax} onChange={(v) => set({ ymax: v })} />
          </div>
        </>
      );
    case "flip":
      return (
        <Select
          aria-label="Flip direction"
          options={[
            { value: "h", label: "Horizontal (left ↔ right)" },
            { value: "v", label: "Vertical (top ↔ bottom)" },
          ]}
          value={f.flipAxis}
          onChange={(e) => set({ flipAxis: e.target.value as "h" | "v" })}
        />
      );
    case "rotate":
      return (
        <>
          <Select
            aria-label="Rotation"
            options={["90", "180", "270"].map((v) => ({ value: v, label: `${v}° counter-clockwise` }))}
            value={f.degrees}
            onChange={(e) => set({ degrees: e.target.value as "90" | "180" | "270" })}
          />
          <div className="qzk-helptext" style={{ ...gap, ...faint }}>A quarter turn swaps the X and Y axes with their labels and units.</div>
        </>
      );
    case "transpose":
      return <div className="qzk-helptext">Mirror in the diagonal: X and Y swap, with their labels and units.</div>;
    case "level":
      return (
        <>
          <Select
            aria-label="Surface order"
            options={[
              { value: "1", label: "Plane (order 1)" },
              { value: "2", label: "Quadric surface (order 2)" },
            ]}
            value={f.order}
            onChange={(e) => set({ order: e.target.value as "1" | "2" })}
          />
          <div style={gap}>
            <Checkbox checked={f.restoreMean} onChange={(v) => set({ restoreMean: v })}>
              Keep the map&apos;s mean level
            </Checkbox>
          </div>
          <div className="qzk-helptext" style={{ ...gap, ...faint }}>
            Least-squares fit over the finite cells, subtracted. Fitted tilt is recorded on the result.
          </div>
        </>
      );
    case "fft":
      return <FftFields f={f} set={set} />;
    case "fftfilter":
      return <FftFilterFields f={f} set={set} />;
    case "imgfilter":
      return <ImageFilterFields f={f} set={set} />;
    case "arith":
    case "scalar":
      return (
        <>
          <Select aria-label="Operation" options={ARITH_OPTIONS.map((o) => ({ value: o.value, label: f.op === "scalar" ? o.label.replace("B", "number") : o.label }))} value={f.arith} onChange={(e) => set({ arith: e.target.value as typeof f.arith })} />
          {f.op === "arith" ? (
            <>
              <label className="qzk-field-lbl" style={gap}>Map B</label>
              <Select aria-label="Map B" options={[{ value: "", label: m.maps.length ? "Choose…" : "No other map loaded" }, ...m.maps.map((d) => ({ value: d.id, label: d.name }))]} value={f.otherId} onChange={(e) => set({ otherId: e.target.value })} />
              <div style={gap}>
                <Checkbox checked={f.interpolate} onChange={(v) => set({ interpolate: v })}>
                  Interpolate B onto A&apos;s grid if the grids differ
                </Checkbox>
              </div>
              <div style={gap}>
                <Checkbox checked={f.allowMismatch} onChange={(v) => set({ allowMismatch: v })}>
                  Allow mismatched axes / units
                </Checkbox>
              </div>
              <div className="qzk-helptext" style={{ ...gap, ...faint }}>
                Without interpolation the two maps must be on the same grid; otherwise nothing is created. Cells of A outside B come out blank.
              </div>
            </>
          ) : (
            <>
              <label className="qzk-field-lbl" style={gap}>Number</label>
              <NumberField aria-label="Number" value={f.scalar} onChange={(v) => set({ scalar: v })} />
              <div style={gap}>
                <Checkbox checked={f.reverse} onChange={(v) => set({ reverse: v })}>
                  Number on the left (c − A, c ÷ A)
                </Checkbox>
              </div>
            </>
          )}
        </>
      );
  }
}

function MapOpsBody() {
  const hide = useAnalysisExtras((s) => s.hide);
  const m = useMapOps();
  const opts = m.columns.map((c) => ({ value: String(c.index), label: c.label }));
  return (
    <ToolWindow id="map-ops" title="Map operations" width={340} onClose={() => hide("map-ops")}>
      {!m.isMap ? (
        <div className="qzk-helptext">Select a 2-D map (an RSM, contour or image map) to crop, flip, rotate, level or combine it.</div>
      ) : (
        <>
          <label className="qzk-field-lbl">Operation on the active map (A)</label>
          <Select aria-label="Map operation" options={OP_OPTIONS} value={m.form.op} onChange={(e) => m.setForm({ op: e.target.value as MapOpKind })} />
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
          <div style={gap}>
            <Fields m={m} />
          </div>
          <Button variant="primary" size="sm" disabled={m.busy} onClick={() => void m.run()} style={{ marginTop: 12, width: "100%" }}>
            {m.busy ? "Computing…" : "Apply → new dataset"}
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
        </>
      )}
    </ToolWindow>
  );
}

export default function MapOpsPanel() {
  return <MapOpsBody />;
}
