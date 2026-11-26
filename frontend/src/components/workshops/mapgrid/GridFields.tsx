// Map gridding workshop — the option fields of the "grid X, Y, Z" job (split out
// of MapGridPanel to keep it small).

import { Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import { NumberField } from "../../primitives/NumberField";
import { METHOD_OPTIONS, VARIOGRAM_OPTIONS, type GridForm } from "./mapGridForm";
import type { Variogram } from "../../../lib/api/mapGrid";
import type { PickColumn } from "../analysisextras/columnPicks";

const gap = { marginTop: 8 } as const;
const faint = { color: "var(--text-faint)" } as const;

interface Props {
  f: GridForm;
  set: (patch: Partial<GridForm>) => void;
  columns: PickColumn[];
  picks: [number, number, number];
  setPick: (slot: 0 | 1 | 2, index: number) => void;
}

export function GridFields({ f, set, columns, picks, setPick }: Props) {
  const opts = columns.map((c) => ({ value: String(c.index), label: c.label }));
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        {(["X", "Y", "Z"] as const).map((lbl, i) => (
          <div key={lbl}>
            <label className="qzk-field-lbl">{lbl}</label>
            <Select aria-label={`${lbl} column`} options={opts} value={String(picks[i])} onChange={(e) => setPick(i as 0 | 1 | 2, Number(e.target.value))} />
          </div>
        ))}
      </div>
      <label className="qzk-field-lbl" style={gap}>Method</label>
      <Select aria-label="Gridding method" options={METHOD_OPTIONS} value={f.method} onChange={(e) => set({ method: e.target.value as GridForm["method"], output: "value" })} />
      {f.method === "kriging" && (
        <>
          <label className="qzk-field-lbl" style={gap}>Variogram model</label>
          <Select aria-label="Variogram model" options={VARIOGRAM_OPTIONS} value={f.variogram} onChange={(e) => set({ variogram: e.target.value as Variogram })} />
          <label className="qzk-field-lbl" style={gap}>Output</label>
          <Select
            aria-label="Kriging output"
            options={[{ value: "value", label: "Interpolated values" }, { value: "variance", label: "Kriging variance map" }]}
            value={f.output}
            onChange={(e) => set({ output: e.target.value as GridForm["output"] })}
          />
          <div className="qzk-helptext" style={{ ...gap, ...faint }}>
            Ordinary kriging from the 32 nearest points; the model is fitted to the empirical variogram. The surface passes through every data point (variance 0 there).
          </div>
        </>
      )}
      {f.method === "shepard" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, ...gap }}>
            <NumberField aria-label="Shepard neighbours" placeholder="Neighbours" value={f.shepNeighbors} onChange={(v) => set({ shepNeighbors: v })} />
            <NumberField aria-label="Shepard radius" placeholder="Radius (adaptive)" value={f.shepRadius} onChange={(v) => set({ shepRadius: v })} />
          </div>
          <div style={gap}>
            <Checkbox checked={f.shepQuadratic} onChange={(v) => set({ shepQuadratic: v })}>
              Quadratic nodal functions (Renka)
            </Checkbox>
          </div>
          <div className="qzk-helptext" style={{ ...gap, ...faint }}>
            Radius is a fraction of the data extent; empty adapts to the local point spacing. Off = classic modified Shepard value blend.
          </div>
        </>
      )}
      {f.method === "renka" && (
        <div className="qzk-helptext" style={{ ...gap, ...faint }}>
          Renka-Cline C1 cubic over a Delaunay triangulation (the Clough-Tocher interpolant). Not the same as natural neighbour.
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, ...gap }}>
        <NumberField aria-label="Grid columns" placeholder="Columns (X)" value={f.nx} onChange={(v) => set({ nx: v })} />
        <NumberField aria-label="Grid rows" placeholder="Rows (Y)" value={f.ny} onChange={(v) => set({ ny: v })} />
      </div>
      <div style={gap}>
        <Checkbox checked={f.logX} onChange={(v) => set({ logX: v })}>Log10-spaced X (all X above 0)</Checkbox>
      </div>
      <div style={gap}>
        <Checkbox checked={f.logY} onChange={(v) => set({ logY: v })}>Log10-spaced Y (all Y above 0)</Checkbox>
      </div>
      <div style={gap}>
        <Checkbox checked={f.nearestFill} onChange={(v) => set({ nearestFill: v })}>
          Fill outside the data with the nearest value
        </Checkbox>
      </div>
      <div className="qzk-helptext" style={{ ...gap, ...faint }}>
        Cells outside the convex hull of the points stay blank unless you fill them. Fewer than three points, or points on one line, are refused. A log-spaced map is not uniform, so crop/FFT map operations will refuse it.
      </div>
    </>
  );
}
