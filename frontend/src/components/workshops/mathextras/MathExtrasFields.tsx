// Math extras workshop — the option fields of each mode (split out of
// MathExtrasPanel to keep it small).

import { Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import { NumberField } from "../../primitives/NumberField";
import { pickOptions } from "../analysisextras/columnPicks";
import type { MathExtrasState } from "./useMathExtras";

const gap = { marginTop: 8 } as const;
const faint = { ...gap, color: "var(--text-faint)" } as const;
const mono = { width: "100%", fontFamily: "var(--font-mono)" } as const;

function ColumnPicks({ m, labels }: { m: MathExtrasState; labels: string[] }) {
  const opts = pickOptions(m.columns);
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${labels.length}, 1fr)`, gap: 8 }}>
      {labels.map((lbl, i) => (
        <div key={lbl}>
          <label className="qzk-field-lbl">{lbl}</label>
          <Select aria-label={`${lbl} column`} options={opts} value={String(m.picks[i])} onChange={(e) => m.setPick(i, Number(e.target.value))} />
        </div>
      ))}
    </div>
  );
}

function Sizing({ m }: { m: MathExtrasState }) {
  const f = m.form;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, ...gap }}>
      <Select
        aria-label="Output sizing"
        options={[{ value: "n", label: "Number of points" }, { value: "spacing", label: "Spacing" }]}
        value={f.sizing}
        onChange={(e) => m.setForm({ sizing: e.target.value as "n" | "spacing" })}
      />
      {f.sizing === "n"
        ? <NumberField aria-label="Number of points" width={120} value={f.n} onChange={(v) => m.setForm({ n: v })} />
        : <NumberField aria-label="Spacing" width={120} value={f.spacing} onChange={(v) => m.setForm({ spacing: v })} />}
    </div>
  );
}

function CurveFields({ m }: { m: MathExtrasState }) {
  const f = m.form;
  return (
    <>
      <ColumnPicks m={m} labels={["X", "Y"]} />
      {m.mode === "polygon-area" && (
        <div className="qzk-helptext" style={faint}>
          The curve is joined from its last point back to its first by a straight edge. The area is the polygon through the points in order.
        </div>
      )}
      {m.mode === "trace" && (
        <>
          <Sizing m={m} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, ...gap }}>
            <Select
              aria-label="Interpolation"
              options={[{ value: "linear", label: "Linear" }, { value: "pchip", label: "PCHIP" }, { value: "cubic", label: "Cubic spline" }]}
              value={f.kind}
              onChange={(e) => m.setForm({ kind: e.target.value as MathExtrasState["form"]["kind"] })}
            />
            <Checkbox checked={f.periodic} onChange={(v) => m.setForm({ periodic: v })}>Closed path</Checkbox>
          </div>
          <div className="qzk-helptext" style={faint}>
            The curve is a path in the (X, Y) plane, so X may double back. Points are equal steps of arc length from the first point to the last.
          </div>
        </>
      )}
      {m.mode === "bspline" && (
        <>
          <Sizing m={m} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, ...gap }}>
            <NumberField aria-label="Spline degree" placeholder="Degree" value={f.degree} onChange={(v) => m.setForm({ degree: v })} />
            <NumberField aria-label="Smoothing" placeholder="Smoothing" width={120} value={f.smoothing} onChange={(v) => m.setForm({ smoothing: v })} />
          </div>
          <div className="qzk-helptext" style={faint}>
            Smoothing 0 passes through every point; above 0 it is the largest allowed sum of squared residuals. Repeated X values are averaged.
          </div>
        </>
      )}
    </>
  );
}

function ScatterFields({ m }: { m: MathExtrasState }) {
  const f = m.form;
  const labels = f.dims === "3" ? ["X", "Y", "Z", "Value"] : ["X", "Y", "Value"];
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
        <Select aria-label="Dimensions" options={[{ value: "2", label: "2-D: w(x, y)" }, { value: "3", label: "3-D: w(x, y, z)" }]} value={f.dims} onChange={(e) => m.setForm({ dims: e.target.value as "2" | "3" })} />
        <Select
          aria-label="Method"
          options={[{ value: "linear", label: "Linear (triangulation)" }, { value: "nearest", label: "Nearest" }, { value: "rbf", label: "Thin-plate spline" }]}
          value={f.method}
          onChange={(e) => m.setForm({ method: e.target.value as MathExtrasState["form"]["method"] })}
        />
      </div>
      <ColumnPicks m={m} labels={labels} />
      <label className="qzk-field-lbl" style={gap}>Points to interpolate onto (one per line)</label>
      <textarea
        className="qzk-input"
        aria-label="Query points"
        rows={4}
        placeholder={f.dims === "3" ? "0.5 0.5 0.5" : "0.5 0.5"}
        style={mono}
        value={f.queries}
        onChange={(e) => m.setForm({ queries: e.target.value })}
      />
      {f.method === "linear" && (
        <div style={gap}>
          <Checkbox checked={f.nearestFill} onChange={(v) => m.setForm({ nearestFill: v })}>Fill outside the data with the nearest value</Checkbox>
        </div>
      )}
      <div className="qzk-helptext" style={faint}>
        Duplicate points are averaged. Linear leaves points outside the data blank; thin-plate spline extrapolates smoothly (up to 5,000 points).
      </div>
    </>
  );
}

function MapFields({ m }: { m: MathExtrasState }) {
  const f = m.form;
  const correlate = m.mode === "correlate";
  return (
    <>
      {!m.activeIsMap && <div className="qzk-helptext">Select a 2-D map{correlate ? " as the first map" : ""}.</div>}
      {correlate && (
        <>
          <label className="qzk-field-lbl">Second map</label>
          {m.otherMaps.length === 0 ? (
            <div className="qzk-helptext">Load a second 2-D map to correlate with.</div>
          ) : (
            <Select aria-label="Second map" options={m.otherMaps.map((d) => ({ value: d.id, label: d.name }))} value={m.otherId} onChange={(e) => m.setOtherId(e.target.value)} />
          )}
        </>
      )}
      <div style={gap}>
        <Checkbox checked={f.blanksOk} onChange={(v) => m.setForm({ blanksOk: v })}>
          {correlate ? "Treat blank cells as the map's mean" : "Skip cells that touch a blank value"}
        </Checkbox>
      </div>
      <div className="qzk-helptext" style={faint}>
        {correlate
          ? "Both maps need the same cell size. The result is a new map of the normalised correlation against the offset, with the peak and its offset in the card."
          : "Blank values are refused unless you choose to skip the cells around them."}
      </div>
    </>
  );
}

function SolverFields({ m }: { m: MathExtrasState }) {
  const f = m.form;
  const root = m.mode === "root";
  return (
    <>
      <label className="qzk-field-lbl">{root ? "f(x) =" : "Expression"}</label>
      <input className="qzk-input" aria-label="Expression" style={mono} placeholder={root ? "x^2 - a" : "(x - 1)^2 + (a + 2)^2"} value={f.expr} onChange={(e) => m.setForm({ expr: e.target.value })} />
      {root ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, ...gap }}>
            <NumberField aria-label="Bracket low" placeholder="From x" value={f.lo} onChange={(v) => m.setForm({ lo: v })} />
            <NumberField aria-label="Bracket high" placeholder="To x" value={f.hi} onChange={(v) => m.setForm({ hi: v })} />
            <NumberField aria-label="Target" placeholder="= value" value={f.target} onChange={(v) => m.setForm({ target: v })} />
          </div>
          <label className="qzk-field-lbl" style={gap}>Other names (a = 2, b = 3)</label>
          <input className="qzk-input" aria-label="Constants" style={mono} value={f.constants} onChange={(e) => m.setForm({ constants: e.target.value })} />
        </>
      ) : (
        <>
          <Select aria-label="Sense" options={[{ value: "min", label: "Minimise" }, { value: "max", label: "Maximise" }]} value={f.sense} onChange={(e) => m.setForm({ sense: e.target.value as "min" | "max" })} />
          <label className="qzk-field-lbl" style={gap}>Bounds, one variable per line</label>
          <textarea className="qzk-input" aria-label="Bounds" rows={3} placeholder={"x = -5 .. 5\na = -5 .. 5"} style={mono} value={f.bounds} onChange={(e) => m.setForm({ bounds: e.target.value })} />
        </>
      )}
      <div className="qzk-helptext" style={faint}>
        {root
          ? "Same expression language as the custom fit: x is the unknown, any other name needs a value above. Every root in the bracket is listed; a jump across a pole is not a root."
          : "Every name in the expression, x included, is a variable and needs bounds. Several starting points are tried from a fixed seed, so a rerun gives the same answer."}
      </div>
    </>
  );
}

export function ModeFields({ m }: { m: MathExtrasState }) {
  if (m.input === "curve") return <CurveFields m={m} />;
  if (m.input === "scatter") return <ScatterFields m={m} />;
  if (m.input === "map") return <MapFields m={m} />;
  return <SolverFields m={m} />;
}
