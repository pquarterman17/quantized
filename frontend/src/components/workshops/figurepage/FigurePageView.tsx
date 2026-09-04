// Figure page composer workshop (GOTO #4) — view. A draggable ToolWindow:
// page options on the left (name / format / style preset / DPI / panel-label
// format + position / grid size), the panel sources next to them (open plot
// windows, saved Publication figures, and — F3.3 — saved Editable figures
// picked directly, drag onto a slot or click to assign), and the slot grid +
// server-rendered low-DPI preview on the right. Thin: all state + the
// preview/export/save wiring live in useFigurePage.
//
// F3.3: Save/Save As write the page into the Library's saved-pages
// collection (see Library/PagesSection.tsx for reopen/rename/duplicate/
// delete); the title shows the saved name + a "•" dirty cue once anything is
// worth saving, and closing a page that was SAVED then edited confirms
// before discarding (a fresh, never-saved page still discards plainly, per
// the note below).
//
// F3.4: panels are now directly editable — SlotGrid owns the double-click/
// context-menu/keyboard wiring (see its own header + panelMenu.ts); this
// view only forwards the per-index callbacks useFigurePage exposes.
//
// F3.5 "complete layout controls": a new Layout block (row/col gap, link X/Y
// axes, align labels, resize mode — see lib/pageDocument.ts's
// PageLayoutSettings doc for what each does) sits beside the grid-size
// field; SlotGrid gets the same manual-rearrangement wiring (drag a filled
// tile, or Shift+Arrow) it uses for its own double-click/context-menu paths.
//
// F3.6 "export from PageDocument": a Copy button sits beside Export — 300-DPI
// PNG straight to the Office clipboard (A7 convention, matching the Stage
// plot toolbar's single-figure "Copy figure"), rendered through the SAME
// buildSpec the preview and file export already share (see
// usePagePreviewExport.ts). File export stays vector-by-default (PDF) per
// the repo's export convention; Copy is always a raster (Office pastes
// vector figures poorly), same tradeoff the single-figure copy makes.

import ToolWindow from "../../overlays/ToolWindow";
import { Checkbox } from "../../primitives/Checkbox";
import { NumberField } from "../../primitives/NumberField";
import { Button, Select } from "../../primitives";
import RichLabelInput from "../../primitives/RichLabelInput";
import { PAGE_LABEL_FORMATS, PAGE_LABEL_POSITIONS } from "../../../lib/figurepage";
import type { PanelSource } from "../../../lib/figurepageActions";
import { PAGE_RESIZE_MODES } from "../../../lib/pageDocument";
import { useApp } from "../../../store/useApp";
import { FIGURE_FORMATS, FIGURE_STYLES } from "../figurebuilder/useFigureBuilder";
import SlotGrid, { PANEL_SOURCE_MIME } from "./SlotGrid";
import { useFigurePage } from "./useFigurePage";

/** null (auto) <-> the NumberField's blank-string convention. */
function gapFieldValue(v: number | null): string {
  return v === null ? "" : String(v);
}
function parseGapField(v: string): number | null {
  const trimmed = v.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

const SOURCE_GLYPH: Record<PanelSource["kind"], string> = { figure: "◇ ", figdoc: "▣ ", window: "□ " };

function SourceList({
  heading,
  sources,
  onPick,
}: {
  heading: string;
  sources: PanelSource[];
  onPick: (s: PanelSource) => void;
}) {
  return (
    <>
      <label className="qzk-field-lbl">{heading}</label>
      {sources.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--text-faint)" }}>(none)</div>
      ) : (
        sources.map((src) => (
          <div
            key={`${src.kind}:${src.id}`}
            draggable
            onDragStart={(e) =>
              e.dataTransfer.setData(PANEL_SOURCE_MIME, JSON.stringify(src))
            }
            onClick={() => onPick(src)}
            title="Drag onto a slot, or click to assign"
            style={{
              padding: "3px 6px",
              borderRadius: 4,
              border: "1px solid var(--border)",
              background: "var(--surface-1)",
              fontSize: 12,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {SOURCE_GLYPH[src.kind]}
            {src.name}
          </div>
        ))
      )}
    </>
  );
}

export default function FigurePageView() {
  const setOpen = useApp((s) => s.setFigurePageOpen);
  const p = useFigurePage();
  const selIdx = p.selected;
  const sel = selIdx !== null ? p.slots[selIdx] : null;

  const requestClose = () => {
    void p.requestClose().then((ok) => {
      if (ok) setOpen(false);
    });
  };

  return (
    <ToolWindow
      id="figurepage"
      title={`Multi-panel export — ${p.name}${p.dirty ? " •" : ""}`}
      width={840}
      onClose={requestClose}
    >
      <div style={{ display: "flex", gap: 12 }}>
        {/* Page options */}
        <div style={{ width: 170, display: "flex", flexDirection: "column", gap: 6 }}>
          <label className="qzk-field-lbl">Page name</label>
          <NumberField numeric={false} value={p.name} onChange={p.setName} />
          <div style={{ display: "flex", gap: 6 }}>
            <Button onClick={p.save} title="Save (updates this page if already saved)">
              Save
            </Button>
            <Button onClick={() => void p.saveAs()} title="Save as a new named page">
              Save As…
            </Button>
          </div>
          {p.unresolvedSlots.length > 0 ? (
            <div role="note" className="qzk-ds-meta qzk-msg" style={{ color: "var(--danger)" }}>
              Cannot save yet:
              <ul style={{ margin: "2px 0 0", paddingLeft: 16 }}>
                {p.unresolvedSlots.map((msg) => (
                  <li key={msg}>{msg}</li>
                ))}
              </ul>
            </div>
          ) : (
            !p.everSaved && (
              <div role="note" className="qzk-ds-meta qzk-msg" style={{ color: "var(--text-dim)" }}>
                Not yet saved — closing without saving discards this page.
              </div>
            )
          )}
          <label className="qzk-field-lbl">Grid (rows × cols)</label>
          <div style={{ display: "flex", gap: 6 }}>
            <NumberField value={p.rows} onChange={(v) => p.setGrid(Number(v) || 1, p.cols)} width={60} />
            <NumberField value={p.cols} onChange={(v) => p.setGrid(p.rows, Number(v) || 1)} width={60} />
          </div>
          <label className="qzk-field-lbl">Row / col gap</label>
          <div style={{ display: "flex", gap: 6 }}>
            <NumberField
              value={gapFieldValue(p.layout.rowGap)}
              placeholder="auto"
              onChange={(v) => p.setLayout({ rowGap: parseGapField(v) })}
              width={60}
            />
            <NumberField
              value={gapFieldValue(p.layout.colGap)}
              placeholder="auto"
              onChange={(v) => p.setLayout({ colGap: parseGapField(v) })}
              width={60}
            />
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Checkbox checked={p.layout.linkX} onChange={(v) => p.setLayout({ linkX: v })}>
              Link X
            </Checkbox>
            <Checkbox checked={p.layout.linkY} onChange={(v) => p.setLayout({ linkY: v })}>
              Link Y
            </Checkbox>
          </div>
          <Checkbox checked={p.layout.alignLabels} onChange={(v) => p.setLayout({ alignLabels: v })}>
            Align labels
          </Checkbox>
          <label className="qzk-field-lbl">Resize mode</label>
          <Select
            options={PAGE_RESIZE_MODES.map((v) => ({ value: v, label: v }))}
            value={p.layout.resizeMode}
            onChange={(e) => p.setLayout({ resizeMode: e.target.value as typeof p.layout.resizeMode })}
          />
          <label className="qzk-field-lbl">Panel labels</label>
          <div style={{ display: "flex", gap: 6 }}>
            <Select
              options={PAGE_LABEL_FORMATS.map((v) => ({ value: v, label: v }))}
              value={p.labelFormat}
              onChange={(e) => p.setLabelFormat(e.target.value as typeof p.labelFormat)}
            />
            <Select
              options={PAGE_LABEL_POSITIONS.map((v) => ({ value: v, label: v }))}
              value={p.labelPos}
              onChange={(e) => p.setLabelPos(e.target.value as typeof p.labelPos)}
            />
          </div>
          <label className="qzk-field-lbl">Style</label>
          <Select
            options={FIGURE_STYLES.map((v) => ({ value: v, label: v }))}
            value={p.style}
            onChange={(e) => p.setStyle(e.target.value)}
          />
          <label className="qzk-field-lbl">Format</label>
          <Select
            options={FIGURE_FORMATS.map((v) => ({ value: v, label: v.toUpperCase() }))}
            value={p.fmt}
            onChange={(e) => p.setFmt(e.target.value)}
          />
          <label className="qzk-field-lbl">DPI (raster)</label>
          <NumberField value={p.dpi} onChange={(v) => p.setDpi(Number(v) || 300)} width={90} />

          {/* Per-panel overrides for the selected slot */}
          {sel?.source && selIdx !== null && (
            <>
              <label className="qzk-field-lbl" style={{ marginTop: 6 }}>
                Panel {p.labels[selIdx] || "(selected)"}
              </label>
              <NumberField
                numeric={false}
                width={120}
                value={sel.label ?? ""}
                placeholder="label (auto)"
                onChange={(v) => p.setSlotLabel(selIdx, v.trim() === "" ? null : v)}
              />
              {/* Rich-text (GOTO #5): $...$ math renders in the export. */}
              <RichLabelInput
                live
                value={sel.title ?? ""}
                placeholder="title (from source)"
                onCommit={(v) => p.setSlotTitle(selIdx, v.trim() === "" ? null : v)}
              />
            </>
          )}

          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <Button variant="primary" onClick={() => void p.exportNow()}>
              Export {p.fmt.toUpperCase()}
            </Button>
            <Button onClick={() => void p.copyNow()} title="Copy a 300 DPI image of this page to the clipboard">
              Copy
            </Button>
          </div>
        </div>

        {/* Panel sources */}
        <div style={{ width: 190, display: "flex", flexDirection: "column", gap: 4 }}>
          <SourceList heading="Plot windows" sources={p.windowSources} onPick={p.assignToNext} />
          <div style={{ height: 4 }} />
          <SourceList heading="Editable figures" sources={p.figureSources} onPick={p.assignToNext} />
          <div style={{ height: 4 }} />
          <SourceList heading="Publication figures" sources={p.docSources} onPick={p.assignToNext} />
        </div>

        {/* Slot grid + preview */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          <SlotGrid
            rows={p.rows}
            cols={p.cols}
            slots={p.slots}
            labels={p.labels}
            statuses={p.sourceStatuses}
            selected={p.selected}
            onSelect={p.setSelected}
            onClear={p.clear}
            onDropSource={p.assign}
            onMoveSlot={p.moveSlot}
            onEdit={p.editSlot}
            onSaveAsFigure={p.saveSlotAsFigure}
            onPromote={p.promoteSlot}
            onDuplicateForPage={p.duplicateForPage}
          />
          <div
            style={{
              flex: 1,
              minHeight: 220,
              display: "grid",
              placeItems: "center",
              background: "var(--surface-1)",
              borderRadius: 6,
              padding: 8,
            }}
          >
            {p.error ? (
              <div className="qzk-ds-meta" style={{ color: "var(--danger)" }}>
                {p.error}
              </div>
            ) : p.preview ? (
              <img
                src={p.preview}
                alt="figure page preview"
                style={{ maxWidth: "100%", maxHeight: 320, borderRadius: 3 }}
              />
            ) : (
              <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
                {p.busy ? "rendering…" : "assign plots to grid slots to preview the page"}
              </div>
            )}
          </div>
        </div>
      </div>
    </ToolWindow>
  );
}
