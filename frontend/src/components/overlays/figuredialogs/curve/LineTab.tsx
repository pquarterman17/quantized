// Plot details > Line: trace preset, colour, width, dash and the line polish
// (gap, double line, order). The panel's Series style card holds the same
// fields; here they edit the popup's draft.

import { drawnSeriesStyle } from "../../../../lib/drawnSeriesStyle";
import { PT_EXPORT_HINT } from "../../../../lib/exportPoints";
import type { LineStyle } from "../../../../lib/types";
import SeriesLineStyleControls from "../../../Inspector/SeriesLineStyleControls";
import { NumberField } from "../../../primitives/NumberField";
import { SegmentedControl } from "../../../primitives/SegmentedControl";
import { tabRow, type CurveTabProps } from "./curveTabProps";

const PALETTE: { value: string; title: string }[] = [
  ...Array.from({ length: 8 }, (_, i) => ({ value: `--series-${i + 1}`, title: `Series ${i + 1}` })),
  { value: "#000000", title: "Black" },
  { value: "#808080", title: "Gray" },
  { value: "#ffffff", title: "White" },
];
const LINE_NAMES: Record<LineStyle, string> = { solid: "Solid", dashed: "Dashed", dotted: "Dotted" };
const LINE_OPTS: { value: LineStyle; label: string; ariaLabel: string }[] = [
  { value: "solid", label: "──", ariaLabel: LINE_NAMES.solid },
  { value: "dashed", label: "╌╌", ariaLabel: LINE_NAMES.dashed },
  { value: "dotted", label: "···", ariaLabel: LINE_NAMES.dotted },
];
type TraceMode = "line" | "scatter" | "both";
const TRACE_OPTS: { value: TraceMode; label: string }[] = [
  { value: "line", label: "Line" },
  { value: "scatter", label: "Scatter" },
  { value: "both", label: "Both" },
];

export default function LineTab({ channel, style, setSeriesStyle, ctx }: CurveTabProps) {
  const drawn = drawnSeriesStyle(style, ctx.cycle.channels.indexOf(channel), ctx.cycle.channels.length, ctx.cycle.on);
  const drawnLine = drawn.style.line ?? "solid";
  const custom = style.color && !style.color.startsWith("--") ? style.color : "#8b5cf6";
  // Trace preset: derived from width (0 = no line) + marker, set both at once.
  const lineOff = style.width === 0;
  const trace: TraceMode = lineOff ? "scatter" : style.marker ? "both" : "line";
  const setTrace = (t: TraceMode) => {
    if (t === "scatter") setSeriesStyle(channel, { width: 0, marker: true });
    else setSeriesStyle(channel, { marker: t === "both", ...(lineOff ? { width: undefined } : {}) });
  };
  const setWidth = (v: string) => {
    if (v.trim() === "") return setSeriesStyle(channel, { width: undefined });
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) setSeriesStyle(channel, { width: n });
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={tabRow}>
        <span className="qzk-field-lbl" style={{ margin: 0 }}>Trace</span>
        <SegmentedControl<TraceMode> options={TRACE_OPTS} aria-label="Trace" value={trace} onChange={setTrace} />
      </div>
      <h3 style={{ margin: "4px 0" }}>Color</h3>
      <div style={tabRow}>
        {PALETTE.map((c) => (
          <button
            key={c.value}
            type="button"
            title={c.title}
            aria-label={c.title}
            aria-pressed={style.color === c.value}
            onClick={() => setSeriesStyle(channel, { color: c.value })}
            style={{
              width: 18, height: 18, borderRadius: 3,
              background: c.value.startsWith("--") ? `var(${c.value})` : c.value,
              border: style.color === c.value ? "2px solid var(--text)" : "1px solid var(--border)",
            }}
          />
        ))}
        <input
          type="color"
          aria-label="Custom color"
          title="Custom color"
          value={custom}
          onChange={(e) => setSeriesStyle(channel, { color: e.target.value })}
          style={{ width: 24, height: 22, padding: 0, border: "1px solid var(--border)" }}
        />
      </div>
      <h3 style={{ margin: "4px 0" }}>Line</h3>
      <div style={tabRow}>
        <span className="qzk-field-lbl" style={{ margin: 0 }}>Width</span>
        <NumberField
          value={style.width != null ? String(style.width) : ""} width={52} placeholder="1.5" unit="pt"
          aria-label="Line width" title={PT_EXPORT_HINT} onChange={setWidth}
        />
        {/* The DRAWN dash (the auto cycle resolved), marked "(auto)" when the
            cycle chose it; picking any entry stores it explicitly. */}
        <SegmentedControl<LineStyle>
          options={LINE_OPTS}
          aria-label="Line style"
          value={drawnLine}
          onChange={(v) => setSeriesStyle(channel, { line: v })}
        />
        {drawn.autoLine && (
          <span className="qzk-field-lbl" style={{ margin: 0 }} title="Set by the automatic style cycle.">
            {LINE_NAMES[drawnLine]} (auto)
          </span>
        )}
      </div>
      <SeriesLineStyleControls channel={channel} style={style} setSeriesStyle={setSeriesStyle} markers={style.marker ?? false} />
    </div>
  );
}
