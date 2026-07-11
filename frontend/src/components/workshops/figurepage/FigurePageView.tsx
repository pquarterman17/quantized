// Figure page composer workshop (GOTO #4) — view. A draggable ToolWindow:
// page options on the left (format / style preset / DPI / panel-label
// format + position / grid size), the panel sources next to them (open plot
// windows + saved Library figures — drag onto a slot or click to assign),
// and the slot grid + server-rendered low-DPI preview on the right. Thin:
// all state + the preview/export wiring live in useFigurePage.

import ToolWindow from "../../overlays/ToolWindow";
import { Button, NumberField, RichLabelInput, Select } from "../../primitives";
import {
  PAGE_LABEL_FORMATS,
  PAGE_LABEL_POSITIONS,
  type PanelSource,
} from "../../../lib/figurepage";
import { useApp } from "../../../store/useApp";
import { FIGURE_FORMATS, FIGURE_STYLES } from "../figurebuilder/useFigureBuilder";
import SlotGrid, { PANEL_SOURCE_MIME } from "./SlotGrid";
import { useFigurePage } from "./useFigurePage";

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
            {src.kind === "figdoc" ? "▣ " : "□ "}
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
  const sel = p.selected !== null ? p.slots[p.selected] : null;

  return (
    <ToolWindow title="Figure page (multi-panel)" width={840} onClose={() => setOpen(false)}>
      <div style={{ display: "flex", gap: 12 }}>
        {/* Page options */}
        <div style={{ width: 170, display: "flex", flexDirection: "column", gap: 6 }}>
          <label className="qzk-field-lbl">Grid (rows × cols)</label>
          <div style={{ display: "flex", gap: 6 }}>
            <NumberField value={p.rows} onChange={(v) => p.setGrid(Number(v) || 1, p.cols)} width={60} />
            <NumberField value={p.cols} onChange={(v) => p.setGrid(p.rows, Number(v) || 1)} width={60} />
          </div>
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
          {sel?.source && p.selected !== null && (
            <>
              <label className="qzk-field-lbl" style={{ marginTop: 6 }}>
                Panel {p.labels[p.selected] || "(selected)"}
              </label>
              <NumberField
                numeric={false}
                width={120}
                value={sel.label ?? ""}
                placeholder="label (auto)"
                onChange={(v) => p.setSlotLabel(p.selected!, String(v).trim() === "" ? null : String(v))}
              />
              {/* Rich-text (GOTO #5): $...$ math renders in the export. */}
              <RichLabelInput
                live
                value={sel.title ?? ""}
                placeholder="title (from source)"
                onCommit={(v) => p.setSlotTitle(p.selected!, v.trim() === "" ? null : v)}
              />
            </>
          )}

          <Button variant="primary" onClick={p.exportNow} style={{ marginTop: 6 }}>
            Export {p.fmt.toUpperCase()}
          </Button>
        </div>

        {/* Panel sources */}
        <div style={{ width: 190, display: "flex", flexDirection: "column", gap: 4 }}>
          <SourceList heading="Plot windows" sources={p.windowSources} onPick={p.assignToNext} />
          <div style={{ height: 4 }} />
          <SourceList heading="Saved figures" sources={p.docSources} onPick={p.assignToNext} />
        </div>

        {/* Slot grid + preview */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          <SlotGrid
            rows={p.rows}
            cols={p.cols}
            slots={p.slots}
            labels={p.labels}
            selected={p.selected}
            onSelect={p.setSelected}
            onClear={p.clear}
            onDropSource={p.assign}
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
