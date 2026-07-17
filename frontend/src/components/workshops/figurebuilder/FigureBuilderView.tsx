// Figure builder workshop — view. A draggable ToolWindow with the publication
// parameters on the left (format / style preset / DPI / title / axis labels) and
// a live, server-rendered WYSIWYG preview on the right. Thin: all state + the
// preview/export wiring live in the hook.

import { useState } from "react";

import PreviewOverlay from "./PreviewOverlay";
import PropertyPanels from "./PropertyPanels";
import ToolWindow from "../../overlays/ToolWindow";
import { Button, Checkbox, NumberField, RichLabelInput, Select } from "../../primitives";
import { useApp } from "../../../store/useApp";
import { FIGURE_FORMATS, FIGURE_STYLES, useFigureBuilder } from "./useFigureBuilder";

export default function FigureBuilderView() {
  const setOpen = useApp((s) => s.setFigureBuilderOpen);
  const f = useFigureBuilder();
  const [figName, setFigName] = useState("");
  const [figLive, setFigLive] = useState(true);
  const [tplName, setTplName] = useState("");

  return (
    <ToolWindow id="figurebuilder" title={f.frozen ? "Figure builder (frozen data)" : "Figure builder"} width={560} onClose={() => setOpen(false)}>
      {!f.data ? (
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
            {/* Rich-text labels (GOTO #5): `$...$` math renders in the export
                via matplotlib mathtext; Ω opens the symbol palette. */}
            <label className="qzk-field-lbl">Title</label>
            <RichLabelInput live value={f.title} placeholder="(none)" onCommit={f.setTitle} />
            <label className="qzk-field-lbl">X label</label>
            <RichLabelInput live value={f.xLabel} placeholder="auto" onCommit={f.setXLabel} />
            <label className="qzk-field-lbl">Y label</label>
            <RichLabelInput live value={f.yLabel} placeholder="auto" onCommit={f.setYLabel} />
            {/* #11: every export property, panel-grouped, one config object */}
            <PropertyPanels
              overrides={f.overrides}
              setOverrides={f.setOverrides}
              openGroup={f.focusGroup}
            />

            {/* #12: save the configuration as a named, re-openable figure */}
            <label className="qzk-field-lbl" style={{ marginTop: 6 }}>Save as figure</label>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <NumberField
                numeric={false}
                width={100}
                value={figName}
                placeholder="name"
                onChange={setFigName}
              />
              <Checkbox checked={figLive} onChange={setFigLive}>live</Checkbox>
              <Button
                size="sm"
                disabled={!figName.trim()}
                onClick={() => {
                  f.saveAsFigure(figName.trim(), figLive);
                  setFigName("");
                }}
              >
                Save
              </Button>
            </div>

            {/* #15: user graph templates — the style half, appliable anywhere */}
            <label className="qzk-field-lbl" style={{ marginTop: 6 }}>Style template</label>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <NumberField
                numeric={false}
                width={100}
                value={tplName}
                placeholder="save style as…"
                onChange={setTplName}
              />
              <Button
                size="sm"
                disabled={!tplName.trim()}
                onClick={() => {
                  f.saveStyleTemplate(tplName.trim());
                  setTplName("");
                }}
              >
                Save
              </Button>
            </div>
            {f.graphTemplates.length > 0 && (
              <Select
                options={[
                  { value: "", label: "apply template…" },
                  ...f.graphTemplates.map((t) => ({ value: t.name, label: t.name })),
                ]}
                value=""
                onChange={(e) => e.target.value && f.applyStyleTemplate(e.target.value)}
              />
            )}

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
            ) : f.preview && f.hitmap ? (
              /* #13/#14: hit-testable preview — click to focus a panel,
                 double-click text to edit, drag legend/annotations */
              <PreviewOverlay
                src={f.preview}
                map={f.hitmap}
                textOf={f.textOf}
                onSelect={f.selectElement}
                onEditText={f.editElementText}
                onDragEnd={f.dragElement}
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
