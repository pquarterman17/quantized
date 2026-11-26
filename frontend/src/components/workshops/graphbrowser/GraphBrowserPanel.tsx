// Graph browser (Origin gap plan item 22): the graph tools Origin keeps on a
// graph window, in one small window. Browse steps a curve through columns or
// same-shaped sheets; Pick collects clicked data points into a worksheet; the
// scrollers pan a zoomed axis; the filter keeps only the plotted range.
// State: ./useGraphBrowser. The picker's list: store/pickedPoints.

import { useState } from "react";

import { useAnalysisExtras } from "../../../store/analysisExtras";
import { usePickedPoints } from "../../../store/pickedPoints";
import { useApp } from "../../../store/useApp";
import ToolWindow from "../../overlays/ToolWindow";
import { Button, Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import { GraphBrowserPick } from "./GraphBrowserPick";
import { useGraphBrowser, type ScrollAxis } from "./useGraphBrowser";

const note = { marginTop: 4, color: "var(--text-faint)" } as const;

function Scroller({ axis, b }: { axis: ScrollAxis; b: ReturnType<typeof useGraphBrowser> }) {
  const s = b.scroll(axis);
  const name = axis.toUpperCase();
  return (
    <div style={{ marginTop: 6 }}>
      <label className="qzk-field-lbl" htmlFor={`gb-scroll-${axis}`}>{name} axis</label>
      <input
        id={`gb-scroll-${axis}`}
        type="range"
        min={0}
        max={1000}
        step={1}
        aria-label={`Scroll the ${name} axis`}
        style={{ width: "100%" }}
        disabled={s.fraction === null}
        value={Math.round((s.fraction ?? 0) * 1000)}
        onChange={(e) => b.scrollTo(axis, Number(e.target.value) / 1000)}
        onPointerUp={b.scrollDone}
        onKeyUp={b.scrollDone}
        onBlur={b.scrollDone}
      />
      {s.fraction === null && <div className="qzk-ds-meta" style={note}>{s.why}</div>}
    </div>
  );
}

type Section = "browse" | "pick" | "scroll" | "filter";

export default function GraphBrowserPanel() {
  const hide = useAnalysisExtras((s) => s.hide);
  const b = useGraphBrowser();
  const tool = useApp((s) => s.plotTool);
  const setTool = useApp((s) => s.setPlotTool);
  const picked = usePickedPoints((s) => s.points);
  const [open, setOpen] = useState<Section>("browse");
  const section = (id: Section, title: string) => (
    <button type="button" className="qz-btn qz-ghost" aria-expanded={open === id} onClick={() => setOpen(id)} style={{ width: "100%", textAlign: "left", marginTop: 8 }}>
      {title}
    </button>
  );
  return (
    <ToolWindow id="graph-browser" title="Graph browser" width={360} onClose={() => hide("graph-browser")}>
      {!b.ds ? (
        <div className="qzk-helptext" style={{ color: "var(--text-faint)" }}>Focus a graph to browse it.</div>
      ) : (
        <>
          {section("browse", "Browse: step one curve")}
          {open === "browse" && (
            <div style={{ marginTop: 6 }}>
              {b.curveNames.length > 1 && (
                <Select aria-label="Curve to browse" options={b.curveNames.map((c) => ({ value: String(c.slot), label: c.label }))} value={String(b.slot)} onChange={(e) => b.setSlot(Number(e.target.value))} />
              )}
              <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
                <span className="qzk-field-lbl" style={{ minWidth: 56 }}>Column</span>
                <Button size="sm" disabled={!b.column.ok} title={b.column.ok ? "Alt+Up" : b.column.why} aria-label="Previous column" onClick={() => b.step("column", -1)}>Previous</Button>
                <Button size="sm" disabled={!b.column.ok} title={b.column.ok ? "Alt+Down" : b.column.why} aria-label="Next column" onClick={() => b.step("column", 1)}>Next</Button>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
                <span className="qzk-field-lbl" style={{ minWidth: 56 }}>Sheet</span>
                <Button size="sm" disabled={!b.sheet.ok} title={b.sheet.ok ? "Alt+Shift+Up" : b.sheet.why} aria-label="Previous sheet" onClick={() => b.step("sheet", -1)}>Previous</Button>
                <Button size="sm" disabled={!b.sheet.ok} title={b.sheet.ok ? "Alt+Shift+Down" : b.sheet.why} aria-label="Next sheet" onClick={() => b.step("sheet", 1)}>Next</Button>
              </div>
              <div className="qzk-ds-meta" style={note}>
                {b.column.ok ? `Column ${b.column.position} of ${b.column.count} is next. ` : `${b.column.why} `}
                Alt+Up / Alt+Down step the column; Alt+Shift steps the sheet. The first step makes the graph a live graph.
              </div>
            </div>
          )}
          {section("pick", `Pick points${picked.length ? ` (${picked.length})` : ""}`)}
          {open === "pick" && <GraphBrowserPick armed={tool === "pick"} arm={(on) => setTool(on ? "pick" : "pointer")} />}
          {section("scroll", "Scroll an axis")}
          {open === "scroll" && (
            <div>
              <Scroller axis="x" b={b} />
              <Scroller axis="y" b={b} />
              <div className="qzk-ds-meta" style={note}>Moves the zoomed window across the data; one drag is one Back-view step.</div>
            </div>
          )}
          {section("filter", "Filter to the plotted range")}
          {open === "filter" && (
            <div style={{ marginTop: 6 }}>
              <Checkbox checked={b.withY} onChange={b.setWithY} disabled={!b.singleCurve} title="Needs exactly one visible curve">Also the Y range</Checkbox>
              <div style={{ marginTop: 6 }}>
                <Button size="sm" disabled={!b.filter.ok} title={b.filter.ok ? undefined : b.filter.why} onClick={b.applyFilter}>Keep only these rows</Button>
              </div>
              <div className="qzk-ds-meta" style={note}>
                {b.filter.ok ? b.filter.summary : b.filter.why} An ordinary Data Filter: edit or clear it there; Undo restores the rows.
              </div>
            </div>
          )}
        </>
      )}
    </ToolWindow>
  );
}
