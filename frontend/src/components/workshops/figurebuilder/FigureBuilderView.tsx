// Figure builder workshop — view. The ONE export view (UX audit 7, lane
// UX-H: "Export figure…" and "Publication preview…" both open it): the output
// and publication parameters on the left (format / named preset / DPI for
// raster / title / axis labels / property groups) and a large, true-aspect,
// server-rendered WYSIWYG preview with a Fit / 100 % toggle and cm rulers on
// the right (PreviewStage). Thin: all state + the preview/export wiring live
// in the hook.

import { useEffect, useState } from "react";

import { xColumnLabel } from "./canonicalChannels";
import ExportFooter from "./ExportFooter";
import FigureOutputControls from "./FigureOutputControls";
import PreviewStage from "./PreviewStage";
import { renderedSizeCm } from "./previewSizing";
import PropertyPanels from "./PropertyPanels";
import { useLiveRebase } from "./useLiveRebase";
import { cancelPublicationPreview } from "../../windows/figureLifecycleUi";
import ToolWindow from "../../overlays/ToolWindow";
import { Checkbox } from "../../primitives/Checkbox";
import { NumberField } from "../../primitives/NumberField";
import { Button, Select } from "../../primitives";
import RichLabelInput from "../../primitives/RichLabelInput";
import { clampToolWindowPos, TITLE_BAR_HEIGHT } from "../../../lib/toolwindow";
import { getFigureViewLabel, resetFigureViewLabel } from "../../../lib/exportFigureView";
import { useApp } from "../../../store/useApp";
import { useFigureBuilder } from "./useFigureBuilder";

const WINDOW_ID = "figurebuilder";
/** Below this a stored width predates the large preview (the window used to
 *  open at 560 px, which left a ~300 px thumbnail): widen it on open. A
 *  width the user chose above it is kept. */
const LEGACY_WIDTH = 600;
/** A remembered explicit height below this would squeeze the preview pane. */
const MIN_HEIGHT = 560;
const SETTINGS_WIDTH = 260;
/** Why Export is off for a draft whose plot moved on under its own edits. */
const STALE_EXPORT =
  "the plot changed after this preview opened, and the preview has edits of its own — Cancel and reopen to export the plot as it is now";

/** Wide enough for a >= 600 px preview at 1440 px, never wider than the
 *  viewport allows beside the Library. */
function defaultWidth(): number {
  const vw = typeof window === "undefined" ? 1440 : window.innerWidth;
  return Math.round(Math.max(LEGACY_WIDTH, Math.min(1120, vw - 300)));
}

export default function FigureBuilderView() {
  const setOpen = useApp((s) => s.setFigureBuilderOpen);
  const storedLayout = useApp((s) => s.toolWindowLayout?.[WINDOW_ID]);
  const setLayout = useApp((s) => s.setToolWindowLayout);
  const f = useFigureBuilder();
  const [figName, setFigName] = useState("");
  const [figLive, setFigLive] = useState(true);
  const [tplName, setTplName] = useState("");
  const [label] = useState(getFigureViewLabel); // titled by how it was opened
  useEffect(() => resetFigureViewLabel, []);
  const title = f.canonical
    ? `${label} — ${f.documentName}${f.dirty ? " (modified)" : ""}`
    : (f.frozen ? `${label} (frozen data)` : label);
  const canonicalFailure = f.canonical && f.canonicalReadiness !== "ready";
  const detachedCanonical = f.publicationTarget === "new-editable";
  const exportDisabledReason = !f.canonical || f.canExport ? null
    : f.exportStale ? STALE_EXPORT : f.error ?? "figure is not ready to export";
  const onClose = () => (f.canonical ? void cancelPublicationPreview() : setOpen(false));
  const sizeCm = f.hitmap && f.previewDpi ? renderedSizeCm(f.hitmap.width, f.hitmap.height, f.previewDpi) : null;
  useLiveRebase(Boolean(f.exportStale));

  // Once per open: a window remembered at the old thumbnail width reopens
  // wide enough for the preview (ToolWindow's default only applies when no
  // layout was ever stored).
  useEffect(() => {
    const short = storedLayout?.height != null && storedLayout.height < MIN_HEIGHT;
    if (storedLayout && (storedLayout.width < LEGACY_WIDTH || short) && setLayout) {
      const width = storedLayout.width < LEGACY_WIDTH ? defaultWidth() : storedLayout.width;
      // Re-clamp: ToolWindow's own mount clamp ran at the OLD width, and the
      // whole title bar must stay on screen (lib/toolwindow.ts).
      const pos = clampToolWindowPos(storedLayout.x, storedLayout.y, width, TITLE_BAR_HEIGHT, { width: window.innerWidth, height: window.innerHeight });
      setLayout(WINDOW_ID, { ...storedLayout, ...pos, width, height: short ? null : storedLayout.height });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ToolWindow id={WINDOW_ID} title={title} width={defaultWidth()} onClose={onClose}>
      {!f.data && !canonicalFailure ? (
        <div className="qzk-helptext" style={{ color: "var(--text-faint)" }}>
          Select a dataset to preview a figure.
        </div>
      ) : (
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
          <div style={{ width: SETTINGS_WIDTH, flexShrink: 0, display: "flex", flexDirection: "column", gap: 6 }}>
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
            <FigureOutputControls fmt={f.fmt} setFmt={f.setFmt} style={f.style} setStyle={f.setStyle} dpi={f.dpi} setDpi={f.setDpi} sizeCm={f.busy ? null : sizeCm} />
            {/* Rich-text labels (GOTO #5): `$...$` math renders in the export
                via matplotlib mathtext; Ω opens the symbol palette. */}
            <label className="qzk-field-lbl">Title</label>
            <RichLabelInput live value={f.title} name="Figure title" placeholder="(none)" onCommit={f.setTitle} />
            <label className="qzk-field-lbl">X label</label>
            <RichLabelInput live value={f.xLabel} name="Figure X label" placeholder="auto" onCommit={f.setXLabel} />
            <label className="qzk-field-lbl">Y label</label>
            <RichLabelInput live value={f.yLabel} name="Figure Y label" placeholder="auto" onCommit={f.setYLabel} />
            {/* #11: every export property, panel-grouped, one config object */}
            <PropertyPanels
              overrides={f.overrides}
              setOverrides={f.setOverrides}
              hasY2={f.hasY2}
              facetActive={f.facetActive}
              clearFacet={f.clearFacet}
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
                xDefaultLabel: xColumnLabel(f.data),
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
                facetKey: f.facetKey,
                labels: f.data?.labels ?? [],
                onGroupKey: f.setGroupKey,
                onFacetKey: f.setFacetKey,
              } : undefined}
              openGroup={f.focusGroup}
              openNonce={f.focusNonce}
              pageSetup={f.pageSetup}
              setPageSetup={f.setPageSetup}
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
            </>}

            {/* #15: user graph templates — the style half, appliable anywhere
                (both modes since figures-audit B2). */}
            <label className="qzk-field-lbl" style={{ marginTop: 6 }}>Style template</label>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <NumberField
                numeric={false}
                width={100}
                value={tplName}
                placeholder="save style as…"
                aria-label="Style template name"
                onChange={setTplName}
              />
              <Button
                size="sm"
                aria-label="Save style template"
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
                aria-label="Apply style template"
              />
            )}

          </div>
          {/* Sticky: the settings column can run ~2,400 px with every group
              open; the preview stays in view while it scrolls. */}
          <div style={{ flex: 1, minWidth: 0, position: "sticky", top: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            <PreviewStage
              preview={f.preview}
              hitmap={f.hitmap}
              previewDpi={f.previewDpi ?? null}
              error={f.error}
              busy={f.busy}
              overlay={{
                /* #13/#14: hit-testable preview — click to focus a panel,
                   double-click text to edit, drag legend/annotations */
                textOf: f.textOf,
                onSelect: f.selectElement,
                onEditText: f.editElementText,
                onDragEnd: f.dragElement,
                canonicalSeries: f.canonical && f.seriesChannels.length > 0,
              }}
            />
            <ExportFooter
              fmt={f.fmt}
              onExport={() => void f.exportNow()}
              exportDisabledReason={exportDisabledReason}
              canonical={f.canonical}
              detached={detachedCanonical}
              dirty={f.dirty}
              canApply={f.canApply}
              applyBlockedReason={f.applyBlockedReason ?? null}
              onApply={f.apply}
              onClose={onClose}
            />
          </div>
        </div>
      )}
    </ToolWindow>
  );
}
