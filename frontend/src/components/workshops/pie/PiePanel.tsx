// Pie / doughnut workshop — view. Pick the label column and one value column
// per ring, and the hole (0 = a pie); the preview is the route's own PNG
// render of the exact request Export sends (calc/figure_pie.py). Opened by an
// applied Origin pie / doughnut figure (io/origin_project/opju_pie.py). Thin:
// the picks, request and preview live in usePie; the title/format/export row
// and the preview image are the ternary panel's AuxFigureFrame.

import ToolWindow from "../../overlays/ToolWindow";
import { Button, Select } from "../../primitives";
import ToolInputSummary from "../analysisselection/ToolInputSummary";
import AuxFigureFrame from "../ternary/AuxFigureFrame";
import { useAuxFigureStore } from "../ternary/auxFigureStore";
import { usePie } from "./usePie";

const close = () => useAuxFigureStore.setState({ pieOpen: false });

export default function PiePanel() {
  const p = usePie();
  // a text X has no column name: it is the category column
  const colOptions = p.columns.map((c) => ({ value: String(c.index), label: c.label || "X (categories)" }));
  const ringOptions = colOptions.filter((o) => o.value !== "-1");
  const many = p.picks.values.length > 1;

  return (
    <ToolWindow id="pie" title="Pie chart" width={560} onClose={close}>
      {!p.hasData ? (
        <div className="qzk-helptext" style={{ color: "var(--text-faint)" }}>
          Select a dataset with a value column.
        </div>
      ) : (
        <>
          <ToolInputSummary noX load={false} ignoreRowRange columns={[p.picks.labels, ...p.picks.values]} />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
            <div style={{ flex: 1, minWidth: 120 }}>
              <label className="qzk-field-lbl">Labels</label>
              <Select
                aria-label="Labels"
                options={colOptions}
                value={String(p.picks.labels)}
                onChange={(e) => p.setLabels(Number(e.target.value))}
              />
            </div>
            {p.picks.values.map((v, k) => (
              <div key={k} style={{ flex: 1, minWidth: 120 }}>
                <label className="qzk-field-lbl">{many ? `Ring ${k + 1}` : "Values"}</label>
                <Select
                  aria-label={many ? `Ring ${k + 1}` : "Values"}
                  options={many ? [...ringOptions, { value: "", label: "remove" }] : ringOptions}
                  value={String(v)}
                  onChange={(e) => p.setRing(k, e.target.value === "" ? null : Number(e.target.value))}
                />
              </div>
            ))}
            <div style={{ flex: 1, minWidth: 180, whiteSpace: "nowrap" }}>
              <label className="qzk-field-lbl">Hole</label>
              <input
                type="range"
                aria-label="Hole"
                min={0}
                max={0.8}
                step={0.05}
                value={p.picks.hole}
                onChange={(e) => p.setHole(Number(e.target.value))}
              />
              <span style={{ fontFamily: "var(--font-mono)" }}> {Math.round(p.picks.hole * 100)} %</span>
            </div>
            <Button size="sm" onClick={p.addRing}>
              + Ring
            </Button>
          </div>
          <AuxFigureFrame
            title={p.title}
            setTitle={p.setTitle}
            fmt={p.fmt}
            setFmt={p.setFmt}
            onExport={() => void p.exportNow()}
            notice={p.notice}
            problem={p.problem}
            preview={p.preview}
            alt="Pie chart preview"
          />
        </>
      )}
    </ToolWindow>
  );
}
