// Map gridding — view. A draggable ToolWindow with three jobs: grid X, Y, Z
// columns to a map (modified Shepard, kriging with a variance map, Renka-Cline
// and the existing methods, optionally on log-spaced axes), set a map's values
// from a formula of x, y and z, and read the value at one (x, y) from every map
// into a worksheet. Every result is a NEW derived dataset. Thin: the logic is
// in useMapGrid.

import ToolWindow from "../../overlays/ToolWindow";
import { Button, Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import { NumberField } from "../../primitives/NumberField";
import { useAnalysisExtras } from "../../../store/analysisExtras";
import { GridFields } from "./GridFields";
import { MODE_OPTIONS, type MapGridMode } from "./mapGridForm";
import { useMapGrid, type MapGridState } from "./useMapGrid";

const gap = { marginTop: 8 } as const;
const faint = { color: "var(--text-faint)" } as const;

function Target({ m }: { m: MapGridState }) {
  return (
    <div className="qzk-helptext" style={{ marginBottom: 8 }}>
      {m.targetName ? `Acts on map: ${m.targetName}` : "No map in use: focus a map window or select a 2-D map."}
    </div>
  );
}

function FormulaFields({ m }: { m: MapGridState }) {
  return (
    <>
      <Target m={m} />
      <label className="qzk-field-lbl">Value = </label>
      <input
        className="qzk-input"
        aria-label="Formula"
        style={{ width: "100%", fontFamily: "var(--font-mono)" }}
        value={m.formula.expr}
        onChange={(e) => m.setFormula({ expr: e.target.value })}
      />
      <label className="qzk-field-lbl" style={gap}>Unit of the result (optional)</label>
      <input className="qzk-input" aria-label="Result unit" style={{ width: "100%" }} value={m.formula.unit} onChange={(e) => m.setFormula({ unit: e.target.value })} />
      <div className="qzk-helptext" style={{ ...gap, ...faint }}>
        x and y are each cell&apos;s coordinates, z its value. Operators + - * / // % ^ **, pi, e, nan and sin, cos, exp, log, log10, sqrt, abs, atan2, hypot, min, max. Comparisons, conditionals and column names are refused. The result is a new map; the original is untouched.
      </div>
    </>
  );
}

function ExtractFields({ m }: { m: MapGridState }) {
  return (
    <>
      <Target m={m} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <NumberField aria-label="Location X" placeholder="X" value={m.extract.x} onChange={(v) => m.setExtract({ x: v })} />
        <NumberField aria-label="Location Y" placeholder="Y" value={m.extract.y} onChange={(v) => m.setExtract({ y: v })} />
      </div>
      <Button size="sm" disabled={!m.hasDrawnBox} onClick={m.boxCentre} style={{ marginTop: 8, width: "100%" }} title="Fill X and Y from the centre of the box drawn on the map (Box tool in the map toolbar)">
        Use centre of the box drawn on the map
      </Button>
      <div className="qzk-helptext" style={{ ...gap, ...faint }}>
        {m.pickedOn
          ? `Picked on ${m.pickedOn}. Click the map again (Pick point tool) to move it.`
          : "Or arm the Pick point tool in the map toolbar and click the map: the location fills here."}
      </div>
      <label className="qzk-field-lbl" style={gap}>Maps (one row each)</label>
      {m.maps.length === 0 && <div className="qzk-helptext">No 2-D map is loaded.</div>}
      {m.maps.map((d) => (
        <div key={d.id} style={{ marginTop: 4 }}>
          <Checkbox checked={d.selected} onChange={() => m.toggleMap(d.id)}>{d.name}</Checkbox>
        </div>
      ))}
      <div className="qzk-helptext" style={{ ...gap, ...faint }}>
        Bilinear interpolation between the four surrounding cells, in the order listed. A location outside a map, or next to a blank cell, gives a blank value for that map, never a guess.
      </div>
    </>
  );
}

function MapGridBody() {
  const hide = useAnalysisExtras((s) => s.hide);
  const m = useMapGrid();
  return (
    <ToolWindow id="map-grid" title="Map gridding" width={340} onClose={() => hide("map-grid")}>
      {!m.hasActive ? (
        <div className="qzk-helptext">Load a worksheet with X, Y and Z columns, or a 2-D map.</div>
      ) : (
        <>
          <label className="qzk-field-lbl">Job</label>
          <Select aria-label="Gridding job" options={MODE_OPTIONS} value={m.mode} onChange={(e) => m.setMode(e.target.value as MapGridMode)} />
          <div style={gap}>
            {m.mode === "grid" && <GridFields f={m.grid} set={m.setGrid} columns={m.columns} picks={m.picks} setPick={m.setPick} />}
            {m.mode === "formula" && <FormulaFields m={m} />}
            {m.mode === "extract" && <ExtractFields m={m} />}
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

export default function MapGridPanel() {
  return <MapGridBody />;
}
