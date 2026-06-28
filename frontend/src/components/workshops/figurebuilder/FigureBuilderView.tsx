// Figure builder workshop — view. A draggable ToolWindow with the publication
// parameters on the left (format / style preset / DPI / title / axis labels) and
// a live, server-rendered WYSIWYG preview on the right. Thin: all state + the
// preview/export wiring live in the hook.

import ToolWindow from "../../overlays/ToolWindow";
import { Button, NumberField, Select } from "../../primitives";
import { useApp } from "../../../store/useApp";
import { FIGURE_FORMATS, FIGURE_STYLES, useFigureBuilder } from "./useFigureBuilder";

export default function FigureBuilderView() {
  const setOpen = useApp((s) => s.setFigureBuilderOpen);
  const f = useFigureBuilder();

  return (
    <ToolWindow title="Figure builder" width={560} onClose={() => setOpen(false)}>
      {!f.active ? (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          Select a dataset to build a figure.
        </div>
      ) : (
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ width: 200, display: "flex", flexDirection: "column", gap: 6 }}>
            <label className="qzk-field-lbl">Format</label>
            <Select
              options={FIGURE_FORMATS.map((v) => ({ value: v, label: v.toUpperCase() }))}
              value={f.fmt}
              onChange={(e) => f.setFmt(e.target.value)}
            />
            <label className="qzk-field-lbl">Style</label>
            <Select
              options={FIGURE_STYLES.map((v) => ({ value: v, label: v }))}
              value={f.style}
              onChange={(e) => f.setStyle(e.target.value)}
            />
            <label className="qzk-field-lbl">DPI (raster)</label>
            <NumberField value={f.dpi} onChange={(v) => f.setDpi(Number(v) || 300)} width={90} />
            <label className="qzk-field-lbl">Title</label>
            <input
              className="qz-input"
              value={f.title}
              placeholder="(none)"
              onChange={(e) => f.setTitle(e.target.value)}
            />
            <label className="qzk-field-lbl">X label</label>
            <input
              className="qz-input"
              value={f.xLabel}
              placeholder="auto"
              onChange={(e) => f.setXLabel(e.target.value)}
            />
            <label className="qzk-field-lbl">Y label</label>
            <input
              className="qz-input"
              value={f.yLabel}
              placeholder="auto"
              onChange={(e) => f.setYLabel(e.target.value)}
            />
            <Button variant="primary" onClick={f.exportNow} style={{ marginTop: 6 }}>
              Export {f.fmt.toUpperCase()}
            </Button>
          </div>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: "grid",
              placeItems: "center",
              background: "var(--surface-1)",
              borderRadius: 6,
              minHeight: 280,
              padding: 8,
            }}
          >
            {f.error ? (
              <div className="qzk-ds-meta" style={{ color: "var(--danger)" }}>
                {f.error}
              </div>
            ) : f.preview ? (
              <img
                src={f.preview}
                alt="figure preview"
                style={{ maxWidth: "100%", maxHeight: 340 }}
              />
            ) : (
              <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
                {f.busy ? "rendering…" : "preview"}
              </div>
            )}
          </div>
        </div>
      )}
    </ToolWindow>
  );
}
