// Open/solid symbol interior and error-bar styling (gap audit 2 #6) for one
// series — shared by the Inspector's Series style card and the Plot Details
// dialog, so both edit the same two `SeriesStyle` fields the same way. The
// canvas reads them in `markers.seriesPoints` / `uplotErrorRange.
// styleErrorDraw`; the export in `calc/figure.py` / `calc/figure_errorbars.py`.

import type { ErrorBarStyle, SeriesStyle } from "../../lib/types";
import { NumberField } from "../primitives/NumberField";
import { SegmentedControl } from "../primitives/SegmentedControl";

type Fill = "auto" | "solid" | "hollow";
const FILL_OPTS: { value: Fill; label: string; ariaLabel: string }[] = [
  { value: "auto", label: "Auto", ariaLabel: "Default fill" },
  { value: "solid", label: "●", ariaLabel: "Solid symbol" },
  { value: "hollow", label: "○", ariaLabel: "Open symbol" },
];

interface Props {
  channel: number;
  style: SeriesStyle;
  setSeriesStyle: (channel: number, patch: Partial<SeriesStyle>, coalesce?: string) => void;
  /** Show the symbol-fill row (the series draws markers). */
  markers: boolean;
  /** Show the error-bar rows (the series has error bars bound). */
  errors: boolean;
}

const row = { display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" } as const;

export default function SeriesSymbolErrorControls({ channel, style, setSeriesStyle, markers, errors }: Props) {
  const eb: ErrorBarStyle = style.errorBar ?? {};
  const setEb = (patch: Partial<ErrorBarStyle>, coalesce?: string) => {
    const next: ErrorBarStyle = { ...eb, ...patch };
    for (const k of Object.keys(next) as (keyof ErrorBarStyle)[]) if (next[k] === undefined) delete next[k];
    setSeriesStyle(channel, { errorBar: Object.keys(next).length ? next : undefined }, coalesce);
  };
  const num = (key: "cap" | "width", min: number) => (v: string) => {
    if (v.trim() === "") return setEb({ [key]: undefined });
    const n = Number(v);
    if (Number.isFinite(n) && n >= min && n <= 100) setEb({ [key]: n });
  };
  const ebHex = eb.color && !eb.color.startsWith("--") ? eb.color : "#8b5cf6";
  return (
    <>
      {markers && (
        <div style={row}>
          <span className="qzk-field-lbl" style={{ margin: 0 }}>Symbol fill</span>
          <SegmentedControl<Fill>
            options={FILL_OPTS}
            aria-label="Symbol fill"
            value={style.markerFill ?? "auto"}
            onChange={(v) => setSeriesStyle(channel, { markerFill: v === "auto" ? undefined : v })}
          />
        </div>
      )}
      {errors && (
        <div style={row}>
          <span className="qzk-field-lbl" style={{ margin: 0 }}>Error bars</span>
          <NumberField
            value={eb.cap != null ? String(eb.cap) : ""} width={44} placeholder="2" unit="pt"
            aria-label="Error bar cap size" title="Cap size (0 = no caps)" onChange={num("cap", 0)}
          />
          <NumberField
            value={eb.width != null ? String(eb.width) : ""} width={44} placeholder="1" unit="pt"
            aria-label="Error bar line width" title="Error bar line width" onChange={num("width", 0.1)}
          />
          <input
            type="color"
            aria-label="Error bar color"
            title="Error bar color (default: the series color)"
            value={ebHex}
            onChange={(e) => setEb({ color: e.target.value }, `error-color:${channel}`)}
            style={{ width: 24, height: 22, padding: 0, border: "1px solid var(--border)" }}
          />
          {eb.color && (
            <button type="button" className="qz-btn qz-ghost qz-sm" onClick={() => setEb({ color: undefined })}>
              Series color
            </button>
          )}
        </div>
      )}
    </>
  );
}
