// The Pick section of the Graph browser: arm the Pick tool, list what was
// clicked (with where each point came from) and turn the list into a worksheet.

import { useState } from "react";

import { fmtNum } from "../../../lib/format";
import { makePickedWorksheet, usePickedPoints } from "../../../store/pickedPoints";
import { Button } from "../../primitives";

export function GraphBrowserPick({ armed, arm }: { armed: boolean; arm: (on: boolean) => void }) {
  const points = usePickedPoints((s) => s.points);
  const [name, setName] = useState("picked points");
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <Button size="sm" variant={armed ? "primary" : "default"} aria-pressed={armed} onClick={() => arm(!armed)} title="Click data points on the graph; Escape ends the tool">
          {armed ? "Picking: click the graph" : "Pick points"}
        </Button>
        <Button size="sm" disabled={points.length === 0} onClick={() => usePickedPoints.getState().clear()}>Clear</Button>
      </div>
      {points.length > 0 && (
        <ol aria-label="Picked points" style={{ margin: "8px 0 0", paddingLeft: 20, maxHeight: 160, overflow: "auto" }}>
          {points.map((p, i) => (
            <li key={`${p.datasetId}:${p.row}:${p.xKey}:${p.yKey}`} style={{ fontFamily: "var(--font-mono)", fontSize: 12 }} title={`${p.yLabel} of ${p.datasetName}, row ${p.row + 1}`}>
              {fmtNum(p.x)}, {fmtNum(p.y)} <span style={{ color: "var(--text-faint)" }}>{p.yLabel} · {p.datasetName} r{p.row + 1}</span>{" "}
              <button type="button" className="qz-btn qz-ghost" aria-label={`Remove point ${i + 1}`} onClick={() => usePickedPoints.getState().removeAt(i)}>x</button>
            </li>
          ))}
        </ol>
      )}
      <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
        <input className="qz-input" aria-label="Worksheet name" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} />
        <Button size="sm" variant="primary" disabled={points.length === 0} onClick={() => void makePickedWorksheet(name)}>Make worksheet</Button>
      </div>
      <div className="qzk-ds-meta" style={{ marginTop: 4, color: "var(--text-faint)" }}>
        A click picks the nearest point of any plotted curve; the list names the curve each point came from. Values come from the source rows, with the source row recorded; masked points cannot be picked.
      </div>
    </div>
  );
}
