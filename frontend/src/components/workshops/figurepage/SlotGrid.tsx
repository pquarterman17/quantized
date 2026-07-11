// Figure page composer (GOTO #4) — the grid of panel slots. Each slot shows
// its assigned source (name + previewed panel label) or an empty drop hint;
// sources drag in from the source list (HTML5 DnD, custom MIME) or click-
// assign via the hook. Click selects a slot (its label/title overrides edit
// in the side panel); the x chip clears it. Pure presentational — all state
// lives in useFigurePage.

import type { DragEvent } from "react";

import type { PageSlot, PanelSource } from "../../../lib/figurepage";

export const PANEL_SOURCE_MIME = "application/x-qz-panel-source";

interface SlotGridProps {
  rows: number;
  cols: number;
  slots: PageSlot[];
  labels: string[]; // per-slot previewed labels (auto sequence + overrides)
  selected: number | null;
  onSelect: (i: number) => void;
  onClear: (i: number) => void;
  onDropSource: (i: number, source: PanelSource) => void;
}

function parseSource(e: DragEvent): PanelSource | null {
  try {
    const raw = e.dataTransfer.getData(PANEL_SOURCE_MIME);
    if (!raw) return null;
    const v = JSON.parse(raw) as PanelSource;
    return typeof v.id === "string" && typeof v.name === "string" ? v : null;
  } catch {
    return null;
  }
}

export default function SlotGrid({
  rows,
  cols,
  slots,
  labels,
  selected,
  onSelect,
  onClear,
  onDropSource,
}: SlotGridProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateRows: `repeat(${rows}, 1fr)`,
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: 6,
        minHeight: 150,
      }}
    >
      {slots.map((slot, i) => {
        const isSel = selected === i;
        return (
          <div
            key={i}
            onClick={() => onSelect(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const src = parseSource(e);
              if (src) onDropSource(i, src);
            }}
            style={{
              border: `1px ${slot.source ? "solid" : "dashed"} ${
                isSel ? "var(--accent)" : "var(--border)"
              }`,
              borderRadius: 4,
              padding: "6px 8px",
              minHeight: 56,
              display: "flex",
              flexDirection: "column",
              gap: 2,
              background: slot.source ? "var(--surface-1)" : "transparent",
              overflow: "hidden",
            }}
          >
            <div style={{ display: "flex", gap: 6, alignItems: "baseline", minWidth: 0 }}>
              <span className="qz-num" style={{ color: "var(--accent)", flex: "none" }}>
                {labels[i] || " "}
              </span>
              {slot.source && (
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    onClear(i);
                  }}
                  title="Remove panel"
                  style={{ marginLeft: "auto", color: "var(--text-faint)", flex: "none" }}
                >
                  {"×"}
                </span>
              )}
            </div>
            {slot.source ? (
              <span
                style={{
                  fontSize: 12,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={slot.source.name}
              >
                {slot.source.kind === "figdoc" ? "▣ " : "□ "}
                {slot.source.name}
              </span>
            ) : (
              <span style={{ fontSize: 12, color: "var(--text-faint)" }}>drop a plot here</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
