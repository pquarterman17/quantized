// Line polish for one series (plan item 17, Origin's Plot Details › Line): the
// gap between the line and each symbol, whether the line is drawn behind or in
// front of the symbols, and the double (compound) line. All off by default and
// display-only. The canvas reads the fields in `lib/uplotLineStyle`, the export
// in `calc/figure_line_style.py`; neither applies to bars, stacks, steps, a
// spline or a size / colour map, so the row says so and stays out of the way.

import { lineStyleApplies, validLength } from "../../lib/lineStyleSanitize";
import type { SeriesStyle } from "../../lib/types";
import { NumberField } from "../primitives/NumberField";
import { SegmentedControl } from "../primitives/SegmentedControl";

type Order = "behind" | "front";
const ORDER_OPTS: { value: Order; label: string; ariaLabel: string }[] = [
  { value: "behind", label: "Behind", ariaLabel: "Line behind the symbols" },
  { value: "front", label: "In front", ariaLabel: "Line in front of the symbols" },
];

interface Props {
  channel: number;
  style: SeriesStyle;
  setSeriesStyle: (channel: number, patch: Partial<SeriesStyle>, coalesce?: string) => void;
  /** The series draws symbols (the gap and the order are about them). */
  markers: boolean;
}

const grp = { display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" } as const;
const row = { display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" } as const;

export default function SeriesLineStyleControls({ channel, style, setSeriesStyle, markers }: Props) {
  if (!lineStyleApplies(style) || style.width === 0) return null;
  const length = (key: "symbolGap" | "doubleLine") => (v: string) => {
    const n = Number(v);
    if (v.trim() === "" || n === 0) setSeriesStyle(channel, { [key]: undefined });
    else if (validLength(n)) setSeriesStyle(channel, { [key]: n }, `${key}:${channel}`);
  };
  return (
    <>
    <div style={row}>
      <span className="qzk-field-lbl" style={{ margin: 0 }}>Line</span>
      {markers && (
        <span style={grp}>
          <span className="qzk-ds-meta">gap</span>
          <NumberField
            value={style.symbolGap != null ? String(style.symbolGap) : ""} width={44} placeholder="0" unit="pt"
            aria-label="Gap between line and symbol" title="The line stops this far short of each symbol (0 = none)"
            onChange={length("symbolGap")}
          />
        </span>
      )}
      <span style={grp}>
      <span className="qzk-ds-meta">double</span>
      <NumberField
        value={style.doubleLine != null ? String(style.doubleLine) : ""} width={44} placeholder="0" unit="pt"
        aria-label="Double line separation" title="Draw two parallel strokes this far apart (0 = a single line)"
        onChange={length("doubleLine")}
      />
      </span>
    </div>
      {markers && (
        <div style={row}>
        <span className="qzk-field-lbl" style={{ margin: 0 }}>Order</span>
        <SegmentedControl<Order>
          options={ORDER_OPTS}
          aria-label="Line order against symbols"
          value={style.lineFront ? "front" : "behind"}
          onChange={(v) => setSeriesStyle(channel, { lineFront: v === "front" ? true : undefined })}
        />
        </div>
      )}
    </>
  );
}
