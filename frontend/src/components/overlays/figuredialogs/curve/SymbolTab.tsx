// Plot details > Symbol: show symbols, shape, size, fill, edge, opacity and
// the text symbol, over the popup's draft.

import { drawnSeriesStyle } from "../../../../lib/drawnSeriesStyle";
import { PT_EXPORT_HINT } from "../../../../lib/exportPoints";
import { MARKER_SHAPES } from "../../../../lib/markerShapes";
import type { MarkerShape } from "../../../../lib/types";
import SeriesSymbolErrorControls from "../../../Inspector/SeriesSymbolErrorControls";
import { Select } from "../../../primitives";
import { Checkbox } from "../../../primitives/Checkbox";
import { NumberField } from "../../../primitives/NumberField";
import { tabRow, type CurveTabProps } from "./curveTabProps";

const shapeLabel = (s: MarkerShape) => MARKER_SHAPES.find((m) => m.value === s)?.label ?? s;

export default function SymbolTab({ channel, style, setSeriesStyle, ctx }: CurveTabProps) {
  const drawn = drawnSeriesStyle(style, ctx.cycle.channels.indexOf(channel), ctx.cycle.channels.length, ctx.cycle.on);
  const autoShape = drawn.autoMarkerShape ? drawn.style.markerShape : undefined;
  const on = style.marker ?? false;
  const setSize = (v: string) => {
    if (v.trim() === "") return setSeriesStyle(channel, { markerSize: undefined });
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0.1) setSeriesStyle(channel, { markerSize: n });
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={tabRow}>
        <Checkbox checked={on} onChange={(c) => setSeriesStyle(channel, { marker: c })}>Show symbols</Checkbox>
        {/* An auto glyph gets its own leading "(auto)" entry, so picking that
            same shape below still stores it explicitly. */}
        <Select
          options={autoShape ? [{ value: "", label: `${shapeLabel(autoShape)} (auto)` }, ...MARKER_SHAPES] : MARKER_SHAPES}
          aria-label="Symbol shape"
          value={autoShape ? "" : (style.markerShape ?? "circle")}
          disabled={!on}
          title={on ? "Symbol shape" : "Turn on Show symbols to pick a shape"}
          onChange={(e) => {
            if (e.target.value) setSeriesStyle(channel, { markerShape: e.target.value as MarkerShape });
          }}
        />
        <NumberField
          value={style.markerSize != null ? String(style.markerSize) : ""} width={44} placeholder="5" unit="pt"
          aria-label="Symbol size" title={PT_EXPORT_HINT} onChange={setSize}
        />
      </div>
      <SeriesSymbolErrorControls
        channel={channel} style={style} setSeriesStyle={setSeriesStyle} markers={on} errors={false}
        drawnColor={ctx.drawnColor} parts="symbol"
      />
    </div>
  );
}
