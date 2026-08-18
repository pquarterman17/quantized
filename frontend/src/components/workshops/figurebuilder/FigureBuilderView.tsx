// Figure builder workshop — view. A draggable ToolWindow with the publication
// parameters on the left (format / style preset / DPI / title / axis labels) and
// a live, server-rendered WYSIWYG preview on the right. Thin: all state + the
// preview/export wiring live in the hook.

import { useEffect, useState } from "react";

import PreviewOverlay from "./PreviewOverlay";
import PropertyPanels from "./PropertyPanels";
import { cancelPublicationPreview } from "../../windows/figureLifecycleUi";
import ToolWindow from "../../overlays/ToolWindow";
import { Button, Checkbox, NumberField, Select } from "../../primitives";
import RichLabelInput from "../../primitives/RichLabelInput";
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
              className="qzk-ds-meta qzk-msg"
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
              // F2.3g: gated on `canonical` only, like reference lines/error
              // columns -- the X-axis select and per-channel toggles need no
              // live canvas.
              channels={f.canonical ? {
                labels: f.data?.labels ?? [],
                channelRoles: f.channelRoles,
                xKey: f.channelXKey,
                yKeys: f.channelYKeys,
                y2Keys: f.channelY2Keys,
                fallbackYKeys: f.channelFallbackYKeys,
                onXKey: f.setChannelXKey,
                onToggleY: f.toggleChannelY,
                onToggleY2: f.toggleChannelY2,
              } : undefined}
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
              // F2.3d: gated on `canonical` ONLY, not on a non-empty list --
              // this panel can create the first reference line, and the
              // alternative (reach for the Stage card) is the one action that
              // invalidates the open session.
              refLines={f.canonical ? {
                refLines: f.refLines,
                onValue: f.setRefLineValue,
                onAdd: f.addRefLine,
                onRemove: f.removeRefLine,
              } : undefined}
              // F2.3j: gated on `canonical` ONLY, like reference lines above --
              // this panel can create the first shade, and the alternative
              // (reach for the Stage card) is the one action that invalidates
              // the open session.
              regionShades={f.canonical ? {
                regionShades: f.regionShades,
                onPatch: f.patchRegionShade,
                onAdd: f.addRegionShade,
                onRemove: f.removeRegionShade,
              } : undefined}
              // F2.3e: canonical-only. Legacy Publication Preview renders from
              // the LIVE store's xFmt/yFmt, which the Stage's own Inspector
              // card already owns — a second editor for the same singleton
              // would be a confusing duplicate, not a feature.
              tickFormats={f.canonical ? {
                xFmt: f.canonicalXFmt,
                yFmt: f.canonicalYFmt,
                y2Fmt: f.canonicalY2Fmt,
                xIsDate: f.xIsDate,
                onXFmt: f.setXFmtCanonical,
                onYFmt: f.setYFmtCanonical,
                onY2Fmt: f.setY2FmtCanonical,
              } : undefined}
              // F2.3f: gated on `canonical` only, like reference lines --
              // Add needs no live canvas, just the dataset's column labels.
              errorColumns={f.canonical ? {
                bindings: f.errorBindings,
                labels: f.data?.labels ?? [],
                onPatch: f.patchErrorBinding,
                onAdd: f.addErrorBinding,
                onRemove: f.removeErrorBinding,
                onDetect: f.detectErrorBindings,
              } : undefined}
              // F2.3h: gated on `canonical` only, like reference lines/error
              // columns -- choosing a group column needs no live canvas.
              grouping={f.canonical ? {
                groupKey: f.groupKey,
                labels: f.data?.labels ?? [],
                onGroupKey: f.setGroupKey,
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
            {/* Sticky action row. Export/Apply/Cancel used to scroll away with
                the rest of the column: with the property groups expanded the
                settings column is ~2,400 px tall inside a ~900 px viewport, so
                the buttons that COMMIT the work sat ~200 px below the fold and
                had to be hunted for. Sticking them to the bottom of the
                scroller keeps the commit affordance permanently in reach
                without changing the DOM structure ToolWindow lays out. */}
            <div
              style={{
                position: "sticky",
                // The scroller (.qzk-win-body) has `--pad-lg` bottom padding;
                // sticking at plain `bottom: 0` parks the row one padding-width
                // ABOVE the scrollport edge, so scrolling content shows through
                // the gap under it. Stick past the padding and add it back
                // inside, so the row sits flush and stays opaque.
                bottom: "calc(var(--pad-lg) * -1)",
                display: "flex",
                flexDirection: "column",
                gap: 6,
                paddingTop: 8,
                paddingBottom: "var(--pad-lg)",
                marginTop: "auto",
                background: "var(--surface-2)",
                borderTop: "1px solid var(--border-soft)",
              }}
            >
              <span title={exportDisabled ? (f.error ?? "figure is not ready to export") : undefined}>
                <Button variant="primary" onClick={f.exportNow} disabled={exportDisabled}>
                  Export {f.fmt.toUpperCase()}
                </Button>
              </span>
              {f.canonical && f.applyBlockedReason && (
                <div role="alert" className="qzk-ds-meta qzk-msg" style={{ color: "var(--danger)" }}>
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
              <div role="alert" aria-live="polite" className="qzk-ds-meta qzk-msg" style={{ color: "var(--danger)" }}>
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
