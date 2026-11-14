// Origin's Plot Details for ONE curve (gap audit 2 #8): double-click a curve
// on the Stage (or its right-click ▸ Plot Details… / Color ▸ Custom…) to edit
// its colour, line, symbol and error bars in one place. Edits a draft of the
// curve's `SeriesStyle` and Apply commits it as ONE undo step; every field is
// an existing style field the canvas, legend and export already read (the
// symbol fill and error-bar look through `SeriesSymbolErrorControls`, shared
// with the Inspector's Series style card). Mounted inside the lazy
// `FigureDialogs` host, which owns the modal frame and focus.

import { useState } from "react";

import { MARKER_SHAPES } from "../../../lib/markerShapes";
import type { LineStyle, MarkerShape, SeriesStyle } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import SeriesSymbolErrorControls from "../../Inspector/SeriesSymbolErrorControls";
import { Checkbox } from "../../primitives/Checkbox";
import { NumberField } from "../../primitives/NumberField";
import { Select } from "../../primitives";

const PALETTE: { value: string; title: string }[] = [
  ...Array.from({ length: 8 }, (_, i) => ({ value: `--series-${i + 1}`, title: `Series ${i + 1}` })),
  { value: "#000000", title: "Black" },
  { value: "#808080", title: "Grey" },
  { value: "#ffffff", title: "White" },
];
const LINES: { value: LineStyle; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
];

const row = { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } as const;

/** A positive number, blank = unset (the default), anything else unchanged. */
function parsed(v: string, min: number): number | undefined | null {
  if (v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? n : null;
}

export default function PlotDetailsDialog({ channel, onClose }: { channel: number; onClose: () => void }) {
  const stored = useApp((s) => s.seriesStyles[channel]);
  const setSeriesStyle = useApp((s) => s.setSeriesStyle);
  const name = useApp((s) => {
    const ds = s.datasets.find((d) => d.id === s.activeId);
    return s.seriesLabels[channel] ?? ds?.data.labels[channel] ?? `Series ${channel + 1}`;
  });
  const [draft, setDraft] = useState<SeriesStyle>(() => ({ ...stored }));
  const patch = (p: Partial<SeriesStyle>) => setDraft((d) => ({ ...d, ...p }));
  const num = (key: "width" | "markerSize", min: number) => (v: string) => {
    const n = parsed(v, min);
    if (n !== null) patch({ [key]: n });
  };
  const custom = draft.color && !draft.color.startsWith("--") ? draft.color : "#8b5cf6";
  const apply = () => {
    setSeriesStyle(channel, draft);
    onClose();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 360 }}>
      <div className="qzk-ds-meta">{name}</div>

      <h3 style={{ margin: "4px 0" }}>Color</h3>
      <div style={row}>
        {PALETTE.map((c) => (
          <button
            key={c.value}
            type="button"
            title={c.title}
            aria-label={c.title}
            aria-pressed={draft.color === c.value}
            onClick={() => patch({ color: c.value })}
            style={{
              width: 18, height: 18, borderRadius: 3,
              background: c.value.startsWith("--") ? `var(${c.value})` : c.value,
              border: draft.color === c.value ? "2px solid var(--text)" : "1px solid var(--border)",
            }}
          />
        ))}
        <input
          type="color"
          aria-label="Custom color"
          title="Custom color"
          value={custom}
          onChange={(e) => patch({ color: e.target.value })}
          style={{ width: 24, height: 22, padding: 0, border: "1px solid var(--border)" }}
        />
      </div>

      <h3 style={{ margin: "4px 0" }}>Line</h3>
      <div style={row}>
        <Select
          options={LINES}
          aria-label="Line style"
          value={draft.line ?? "solid"}
          onChange={(e) => patch({ line: e.target.value as LineStyle })}
        />
        <NumberField
          value={draft.width != null ? String(draft.width) : ""} width={52} placeholder="1.5" unit="px"
          aria-label="Line width" title="Line width (0 = no line)" onChange={num("width", 0)}
        />
      </div>

      <h3 style={{ margin: "4px 0" }}>Symbol</h3>
      <div style={row}>
        <Checkbox checked={draft.marker ?? false} onChange={(c) => patch({ marker: c })}>
          Show symbols
        </Checkbox>
        <Select
          options={MARKER_SHAPES}
          aria-label="Symbol shape"
          value={draft.markerShape ?? "circle"}
          disabled={!draft.marker}
          title={draft.marker ? "Symbol shape" : "Turn on Show symbols to pick a shape"}
          onChange={(e) => patch({ markerShape: e.target.value as MarkerShape })}
        />
        <NumberField
          value={draft.markerSize != null ? String(draft.markerSize) : ""} width={44} placeholder="5" unit="px"
          aria-label="Symbol size" title="Symbol size" onChange={num("markerSize", 0.1)}
        />
      </div>
      <SeriesSymbolErrorControls
        channel={channel} style={draft} setSeriesStyle={(_ch, p) => patch(p)} markers={draft.marker ?? false} errors
      />

      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 4 }}>
        <button type="button" className="qz-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="qz-btn qz-primary" onClick={apply}>Apply</button>
      </div>
    </div>
  );
}
