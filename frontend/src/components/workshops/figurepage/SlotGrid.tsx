// Figure page composer (GOTO #4) — the grid of panel slots. Each slot shows
// its assigned source (name + previewed panel label) or an empty drop hint;
// sources drag in from the source list (HTML5 DnD, custom MIME) or click-
// assign via the hook. Click selects a slot (its label/title overrides edit
// in the side panel); the x chip clears it. Pure presentational — all state
// lives in useFigurePage.
//
// FIGURE_AUTHORING_WORKFLOW_PLAN F3.2: a slot's `PanelSourceStatus` (computed
// live every render by `resolvePanelSource`) drives two cues this component
// used to have no idea about: (1) "missing" — the assigned window/figdoc no
// longer exists or can no longer render — replaces the stale cached name with
// a labeled warning instead of silently looking like a normal, live panel;
// (2) "frozen" — the assigned figure won't update if its source data changes
// — gets a subtle glyph next to its name. Neither invents new behavior: both
// are read straight off the same liveness/lifecycle state the preview/export
// path already depends on.

import type { DragEvent } from "react";

import type { PageSlot, PanelSource, PanelSourceStatus } from "../../../lib/figurepage";

export const PANEL_SOURCE_MIME = "application/x-qz-panel-source";

interface SlotGridProps {
  rows: number;
  cols: number;
  slots: PageSlot[];
  labels: string[]; // per-slot previewed labels (auto sequence + overrides)
  statuses: PanelSourceStatus[]; // per-slot live status (F3.2)
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
  statuses,
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
        // F3.2: "missing" is checked independently of slot.source's mere
        // presence -- a stale-but-still-cached source must not render as if
        // it were a normal, working panel.
        const status = statuses[i] ?? { status: slot.source ? "ok" : "empty", lifecycle: "live" };
        const isMissing = status.status === "missing";
        const isFrozen = status.status === "ok" && status.lifecycle === "frozen";
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
                isMissing ? "var(--danger)" : isSel ? "var(--accent)" : "var(--border)"
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
              isMissing ? (
                <span
                  role="status"
                  style={{
                    fontSize: 12,
                    color: "var(--danger)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title={`"${slot.source.name}" is no longer available - clear or reassign this panel`}
                >
                  {"⚠ missing: "}
                  {slot.source.name}
                </span>
              ) : (
                <span
                  style={{
                    fontSize: 12,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title={
                    isFrozen
                      ? `${slot.source.name} (frozen snapshot - won't update with new data)`
                      : slot.source.name
                  }
                >
                  {slot.source.kind === "figdoc" ? "▣ " : "□ "}
                  {isFrozen && "❄ "}
                  {slot.source.name}
                </span>
              )
            ) : (
              <span style={{ fontSize: 12, color: "var(--text-faint)" }}>drop a plot here</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
