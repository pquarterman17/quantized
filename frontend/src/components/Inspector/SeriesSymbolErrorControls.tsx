// Open/solid symbol interior and error-bar styling (gap audit 2 #6), symbol
// details and the error band (gap audit 4 G10, G8) for one series — shared by the Inspector's Series style card and the Plot Details
// dialog, so both edit the same two `SeriesStyle` fields the same way. The
// canvas reads them in `markers.seriesPoints` / `uplotErrorRange.
// styleErrorDraw`; the export in `calc/figure.py` / `calc/figure_errorbars.py`.

import { resolveToHex } from "../../lib/color";
import { seriesColor } from "../../lib/seriesStyleCycle";
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
  /** The colour the curve is drawn in when it has none of its own (a gradient's), for the wells. */
  drawnColor?: string;
}

const row = { display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" } as const;
/** A label with its control(s): never breaks inside, so a narrow card wraps whole groups, not "cap" away from its box. */
const grp = { display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" } as const;
const swatch = { width: 24, height: 22, padding: 0, border: "1px solid var(--border)" } as const;
type ErrMode = "bars" | "band" | "box";
const ERR_OPTS: { value: ErrMode; label: string; ariaLabel: string }[] = [
  { value: "bars", label: "Bars", ariaLabel: "Draw the error as bars" },
  { value: "band", label: "Band", ariaLabel: "Draw the Y error as a shaded band" },
  { value: "box", label: "Box", ariaLabel: "Box: draw the X and Y errors together as a rectangle (needs X and Y errors bound)" }, // starts with the visible label; must not contain the word of another radio ("Both" in the series-style section)
];
/** An unset well shows the colour the series is DRAWN in (review L9), not a fixed purple. */
const hexOf = (c: string | undefined, series: string) => (c && !c.startsWith("--") ? c : series);

/** A colour well plus its "series colour" reset (G10 edge / fill). */
function ColorWell({ label, value, series, onChange }: { label: string; value?: string; series: string; onChange: (c: string | undefined) => void }) {
  return (
    <>
      <span className="qzk-ds-meta">{label}</span>
      <input type="color" aria-label={`Symbol ${label} color`} title={`Symbol ${label} color (default: the series color)`} value={hexOf(value, series)} onChange={(e) => onChange(e.target.value)} style={swatch} />
      {value && <button type="button" className="qz-btn qz-ghost qz-sm" onClick={() => onChange(undefined)} aria-label={`Symbol ${label}: series color`}>×</button>}
    </>
  );
}

export default function SeriesSymbolErrorControls({ channel, style, setSeriesStyle, markers, errors, drawnColor }: Props) {
  const series = resolveToHex(style.color ? seriesColor(channel, style) : drawnColor ?? seriesColor(channel)) ?? "#8b5cf6";
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
  const ebHex = hexOf(eb.color, series);
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
      {markers && (
        <div style={row}>
          <span className="qzk-field-lbl" style={{ margin: 0 }}>Symbol</span>
          <ColorWell label="edge" series={series} value={style.markerEdge} onChange={(c) => setSeriesStyle(channel, { markerEdge: c }, c && `marker-edge:${channel}`)} />
          <ColorWell label="fill" series={series} value={style.markerFillColor} onChange={(c) => setSeriesStyle(channel, { markerFillColor: c }, c && `marker-face:${channel}`)} />
          <NumberField
            value={style.markerAlpha != null ? String(Math.round(style.markerAlpha * 100)) : ""} width={44} placeholder="100" unit="%"
            aria-label="Symbol fill opacity" title="Symbol fill opacity (the edge stays opaque)"
            onChange={(v) => {
              const n = Number(v);
              if (v.trim() === "") setSeriesStyle(channel, { markerAlpha: undefined });
              else if (Number.isFinite(n) && n >= 0 && n <= 100) setSeriesStyle(channel, { markerAlpha: n / 100 });
            }}
          />
          <span className="qzk-ds-meta">every</span>
          <NumberField
            value={style.markerEvery != null ? String(style.markerEvery) : ""} width={44} placeholder="1" unit="pts"
            aria-label="Symbol every N points" title="Draw a symbol on every Nth point (1 = every point)"
            onChange={(v) => {
              const n = Number(v);
              if (v.trim() === "" || n === 1) setSeriesStyle(channel, { markerEvery: undefined });
              else if (Number.isInteger(n) && n > 1 && n <= 100000) setSeriesStyle(channel, { markerEvery: n });
            }}
          />
        </div>
      )}
      {(markers || style.markerText) && (
        <div style={row}>
          <span className="qzk-field-lbl" style={{ margin: 0 }}>Text symbol</span>
          <input
            className="qz-input" type="text" value={style.markerText ?? ""} placeholder="none" style={{ width: 52 }}
            aria-label="Text symbol" title="Draw this 1-3 character text at every point instead of a glyph"
            onChange={(e) => {
              const v = e.target.value;
              if (v === "") setSeriesStyle(channel, { markerText: undefined, markerTextSize: undefined }, `marker-text:${channel}`);
              else if ([...v].length <= 3) setSeriesStyle(channel, { markerText: v }, `marker-text:${channel}`);
            }}
          />
          {style.markerText && (
            <NumberField
              value={style.markerTextSize != null ? String(style.markerTextSize) : ""} width={44} placeholder="10" unit="pt"
              aria-label="Text symbol size" title="Text symbol size in points (4-72)"
              onChange={(v) => {
                const n = Number(v);
                if (v.trim() === "") setSeriesStyle(channel, { markerTextSize: undefined });
                else if (Number.isFinite(n) && n >= 4 && n <= 72) setSeriesStyle(channel, { markerTextSize: n });
              }}
            />
          )}
        </div>
      )}
      {errors && (
        <>
        <div style={row}>
          <span className="qzk-field-lbl" style={{ margin: 0 }}>Error bars</span>
          <SegmentedControl<ErrMode>
            options={ERR_OPTS}
            aria-label="Error drawing"
            value={eb.box ? "box" : eb.band ? "band" : "bars"}
            onChange={(v) => setEb({ band: v === "band" ? true : undefined, box: v === "box" ? true : undefined })}
          />
        </div>
        <div style={row}>
          <span style={grp}>
          <span className="qzk-ds-meta">cap</span>
          <NumberField
            value={eb.cap != null ? String(eb.cap) : ""} width={44} placeholder="2" unit="pt"
            aria-label="Error bar cap size" title="Cap size in points in the export (0 = no caps)" onChange={num("cap", 0)}
          />
          </span>
          <span style={grp}>
          <span className="qzk-ds-meta">width</span>
          <NumberField
            value={eb.width != null ? String(eb.width) : ""} width={44} placeholder="1" unit="pt"
            aria-label="Error bar line width" title="Error bar line width in points in the export" onChange={num("width", 0.1)}
          />
          </span>
        </div>
        <div style={row}>
          <span style={grp}>
          {!eb.color && <span className="qzk-ds-meta">color: series</span>}
          <input
            type="color"
            aria-label="Error bar color"
            title="Error bar color (default: the series color)"
            value={ebHex}
            onChange={(e) => setEb({ color: e.target.value }, `error-color:${channel}`)}
            style={swatch}
          />
          </span>
          {eb.color && (
            <button type="button" className="qz-btn qz-ghost qz-sm" onClick={() => setEb({ color: undefined })}>
              Series color
            </button>
          )}
        </div>
        </>
      )}
    </>
  );
}
