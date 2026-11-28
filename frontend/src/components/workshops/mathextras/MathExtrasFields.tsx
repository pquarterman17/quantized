// Math extras workshop — the option fields of each mode (split out of
// MathExtrasPanel to keep it small).

import { Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import { NumberField } from "../../primitives/NumberField";
import { pickOptions } from "../analysisextras/columnPicks";
import { SolverFields } from "./MathSolverFields";
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
  const dims = f.dims === "3" ? 3 : 2;
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
      <label className="qzk-field-lbl" style={gap}>Points to interpolate onto</label>
      <Select
        aria-label="Query points from"
        options={[{ value: "typed", label: "Typed here (one per line)" }, { value: "sheet", label: "Columns of a worksheet" }]}
        value={f.queriesFrom}
        onChange={(e) => m.setForm({ queriesFrom: e.target.value === "sheet" ? "sheet" : "typed" })}
      />
      {f.queriesFrom === "typed" ? (
        <textarea
          className="qzk-input"
          aria-label="Query points"
          rows={4}
          placeholder={f.dims === "3" ? "0.5 0.5 0.5" : "0.5 0.5"}
          style={{ ...mono, marginTop: 4 }}
          value={f.queries}
          onChange={(e) => m.setForm({ queries: e.target.value })}
        />
      ) : (
        <div style={{ marginTop: 4 }}>
          <Select aria-label="Query worksheet" options={m.queryWorksheets.map((d) => ({ value: d.id, label: d.name }))} value={m.queryId} onChange={(e) => m.setQueryId(e.target.value)} />
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${dims}, 1fr)`, gap: 8, ...gap }}>
            {(dims === 3 ? ["X", "Y", "Z"] : ["X", "Y"]).map((lbl, i) => (
              <div key={lbl}>
                <label className="qzk-field-lbl">{lbl} of points</label>
                <Select aria-label={`Query ${lbl} column`} options={pickOptions(m.queryColumns)} value={String(m.queryPicks[i])} onChange={(e) => m.setQueryPick(i, Number(e.target.value))} />
              </div>
            ))}
          </div>
          <div className="qzk-helptext" style={faint}>Every row with numbers in all of these columns is one point. The worksheet is recorded as a source of the result.</div>
        </div>
      )}
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

function CorrelationOptions({ m }: { m: MathExtrasState }) {
  const f = m.form;
  return (
    <>
      <div style={gap}>
        <Checkbox checked={f.subtractMeans} onChange={(v) => m.setForm({ subtractMeans: v })}>Subtract each map's mean</Checkbox>
      </div>
      <div className="qzk-helptext" style={faint}>On is the default. Off matches Origin's corr2 (plain correlation over the whole-map norms).</div>
      <label className="qzk-field-lbl" style={gap}>Normalise over</label>
      <Select
        aria-label="Normalise over"
        options={[{ value: "global", label: "The whole maps (default)" }, { value: "local", label: "Each offset's overlap (valid cells only)" }]}
        value={f.normalize}
        onChange={(e) => m.setForm({ normalize: e.target.value as "global" | "local" })}
      />
      {f.normalize === "local" && (
        <div style={gap}>
          <label className="qzk-field-lbl">Smallest overlap (fraction of the smaller map)</label>
          <NumberField aria-label="Smallest overlap" width={120} value={f.minOverlap} onChange={(v) => m.setForm({ minOverlap: v })} />
          <div className="qzk-helptext" style={faint}>
            Blank cells are left out, never an error. Offsets overlapping fewer cells than this are blank in the result.
          </div>
        </div>
      )}
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
      {correlate && <CorrelationOptions m={m} />}
      {!(correlate && f.normalize === "local") && (
        <div style={gap}>
          <Checkbox checked={f.blanksOk} onChange={(v) => m.setForm({ blanksOk: v })}>
            {correlate ? "Let blank cells contribute nothing" : "Skip cells that touch a blank value"}
          </Checkbox>
        </div>
      )}
      <div className="qzk-helptext" style={faint}>
        {correlate
          ? "Both maps need the same cell size. The result is a new map of the correlation against the offset, with the peak and its offset in the card."
          : "Blank values are refused unless you choose to skip the cells around them."}
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
