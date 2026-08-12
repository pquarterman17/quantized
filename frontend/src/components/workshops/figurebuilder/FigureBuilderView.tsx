// Figure builder workshop — view. A draggable ToolWindow with the publication
// parameters on the left (format / style preset / DPI / title / axis labels) and
// a live, server-rendered WYSIWYG preview on the right. Thin: all state + the
// preview/export wiring live in the hook.

import { useEffect, useState } from "react";

import PreviewOverlay from "./PreviewOverlay";
import PropertyPanels from "./PropertyPanels";
import { cancelPublicationPreview } from "../../windows/figureLifecycleUi";
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
  const title = f.canonical
    ? `Publication preview — ${f.documentName}${f.dirty ? " (modified)" : ""}`
    : (f.frozen ? "Publication preview (frozen data)" : "Publication preview");
  const canonicalFailure = f.canonical && f.canonicalReadiness !== "ready";
  const detachedCanonical = f.publicationTarget === "new-editable";
  const exportDisabled = f.canonical && !f.canExport;

  // DPI keeps its own in-progress text (PropertyNumberField's pattern):
  // an invalid or out-of-range keystroke must not immediately snap back to
  // the last committed value while the user is still typing.
  const [dpiText, setDpiText] = useState(String(f.dpi));
  const committedDpiText = String(f.dpi);
  useEffect(() => {
    setDpiText(committedDpiText);
  }, [committedDpiText]);

  return (
    <ToolWindow id="figurebuilder" title={title} width={560} onClose={() => f.canonical ? void cancelPublicationPreview() : setOpen(false)}>
      {!f.data && !canonicalFailure ? (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          Select a dataset to preview a figure.
        </div>
      ) : (
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ width: 200, display: "flex", flexDirection: "column", gap: 6 }}>
            <div
              role="note"
              aria-label="Publication preview behavior"
              className="qzk-ds-meta"
              style={{ color: "var(--text-dim)", marginBottom: 2 }}
            >
              {f.canonical && detachedCanonical
                ? `Editing ${f.documentName}. Apply creates and saves an editable figure; Cancel discards it.`
                : f.canonical
                ? `Editing ${f.documentName}${f.dirty ? " — unpublished changes" : ""}. Apply updates this figure; Cancel discards them.`
                : "Settings here affect saved and exported output; they do not change the editable Stage plot."}
            </div>
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
            <NumberField
              value={dpiText}
              onChange={(v) => {
                setDpiText(v);
                const n = Number(v);
                // Only commit a finite, sane DPI; an invalid/out-of-range
                // keystroke leaves the field text as typed and self-corrects
                // once the entry becomes valid (no silent snap to 300, no
                // negative/absurd DPI reaching the export request).
                if (Number.isFinite(n) && n >= 10 && n <= 1200) f.setDpi(n);
              }}
              width={90}
            />
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
              hasY2={f.hasY2}
              xBreaks={f.xBreaks}
              setXBreaks={f.setXBreaks}
              // F2.3b: series editing has no legacy equivalent -- omit the
              // prop entirely (rather than pass an always-empty object) so a
              // canonical draft with nothing plotted degrades the same way
              // legacy mode does.
              series={f.canonical && f.seriesChannels.length > 0 ? {
                labels: f.data?.labels ?? [],
                channels: f.seriesChannels,
                styles: f.seriesStyles,
                hiddenChannels: f.hiddenChannels,
                nameOverrides: f.seriesLabels,
                errors: f.seriesErrors,
                onStyle: f.setSeriesStyle,
                onHiddenChange: f.setSeriesHidden,
                onMove: f.moveSeries,
              } : undefined}
              // F2.3c: shapes editing has no legacy equivalent either -- same
              // "omit entirely" degrade as series above.
              shapes={f.canonical && f.shapes.length > 0 ? {
                shapes: f.shapes,
                onStyle: f.setShapeStyle,
                onRemove: f.removeShape,
              } : undefined}
              openGroup={f.focusGroup}
              openNonce={f.focusNonce}
            />

            {!f.canonical && <>
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

            </>}
            <span title={exportDisabled ? (f.error ?? "figure is not ready to export") : undefined}>
              <Button variant="primary" onClick={f.exportNow} disabled={exportDisabled} style={{ marginTop: 6 }}>
                Export {f.fmt.toUpperCase()}
              </Button>
            </span>
            {f.canonical && f.applyBlockedReason && (
              <div role="alert" className="qzk-ds-meta" style={{ color: "var(--danger)" }}>
                {f.applyBlockedReason}
              </div>
            )}
            {f.canonical && (
              <div style={{ display: "flex", gap: 6 }}>
                <Button
                  variant="primary"
                  onClick={f.apply}
                  disabled={!f.canApply}
                  title={f.applyBlockedReason ?? undefined}
                >
                  {detachedCanonical ? "Create Editable Figure" : "Apply"}
                </Button>
                <Button onClick={() => void cancelPublicationPreview()}>Cancel</Button>
              </div>
            )}
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
              <div role="alert" aria-live="polite" className="qzk-ds-meta" style={{ color: "var(--danger)" }}>
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
                canonicalSeries={f.canonical && f.seriesChannels.length > 0}
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
