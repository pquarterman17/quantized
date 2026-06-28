// Inspector card: per-channel line styling (color / width / line style) — the
// W6 "per-dataset styling" feature. Overrides are keyed in the store by dataset
// channel index; PlotStage maps them onto the plotted (display-order) series.
// Colors are stored either as a palette-token name ("--series-3", re-themeable)
// or a literal hex from the custom picker. Renders for any dataset (≥1 channel).

import { MARKER_SHAPES } from "../../lib/markers";
import type { Dataset, LineStyle, MarkerShape, SeriesStyle } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { Card, Checkbox, IconButton, NumberField, SegmentedControl, Select } from "../primitives";

const PALETTE = [1, 2, 3, 4, 5, 6, 7, 8];
const LINE_OPTS: { value: LineStyle; label: string }[] = [
  { value: "solid", label: "──" },
  { value: "dashed", label: "╌╌" },
  { value: "dotted", label: "···" },
];

function StyleRow({ channel, label }: { channel: number; label: string }) {
  const style: SeriesStyle = useApp((s) => s.seriesStyles[channel]) ?? {};
  const setSeriesStyle = useApp((s) => s.setSeriesStyle);
  const resetSeriesStyle = useApp((s) => s.resetSeriesStyle);

  const overridden = Object.values(style).some((v) => v !== undefined);
  const customHex = style.color && !style.color.startsWith("--") ? style.color : "#8b5cf6";

  const commitWidth = (v: string) => {
    if (v.trim() === "") return setSeriesStyle(channel, { width: undefined });
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) setSeriesStyle(channel, { width: n });
  };

  return (
    <details className="qz-card" style={{ marginBottom: 4 }}>
      <summary>
        <span
          style={{
            display: "inline-block",
            width: 12,
            height: 12,
            borderRadius: 2,
            marginRight: 8,
            background: style.color
              ? style.color.startsWith("--")
                ? `var(${style.color})`
                : style.color
              : `var(--series-${(channel % 8) + 1})`,
          }}
        />
        {label}
        {overridden && (
          <IconButton
            title="Reset to default"
            style={{ marginLeft: "auto" }}
            onClick={(e) => {
              e.preventDefault();
              resetSeriesStyle(channel);
            }}
          >
            ↺
          </IconButton>
        )}
      </summary>
      <div className="qz-card-body">
        <span className="qzk-field-lbl">Color</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {PALETTE.map((n) => {
            const token = `--series-${n}`;
            return (
              <button
                key={n}
                title={`Series ${n}`}
                aria-pressed={style.color === token}
                onClick={() => setSeriesStyle(channel, { color: token })}
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 3,
                  background: `var(${token})`,
                  border:
                    style.color === token
                      ? "2px solid var(--text)"
                      : "1px solid var(--border)",
                }}
              />
            );
          })}
          <input
            type="color"
            title="Custom color"
            value={customHex}
            onChange={(e) => setSeriesStyle(channel, { color: e.target.value })}
            style={{ width: 24, height: 22, padding: 0, border: "1px solid var(--border)" }}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
          <span className="qzk-field-lbl" style={{ margin: 0 }}>
            Width
          </span>
          <NumberField
            value={style.width != null ? String(style.width) : ""}
            width={52}
            placeholder="1.5"
            unit="px"
            onChange={commitWidth}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
          <span className="qzk-field-lbl" style={{ margin: 0 }}>
            Line
          </span>
          <SegmentedControl<LineStyle>
            options={LINE_OPTS}
            value={style.line ?? "solid"}
            onChange={(v) => setSeriesStyle(channel, { line: v })}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
          <Checkbox
            checked={style.marker ?? false}
            onChange={(c) => setSeriesStyle(channel, { marker: c })}
          >
            Markers
          </Checkbox>
          {style.marker && (
            <>
              <Select
                options={MARKER_SHAPES}
                value={style.markerShape ?? "circle"}
                title="Marker shape"
                onChange={(e) => setSeriesStyle(channel, { markerShape: e.target.value as MarkerShape })}
              />
              <NumberField
                value={style.markerSize != null ? String(style.markerSize) : ""}
                width={44}
                placeholder="5"
                unit="px"
                title="Marker size"
                onChange={(v) => {
                  if (v.trim() === "") return setSeriesStyle(channel, { markerSize: undefined });
                  const n = Number(v);
                  if (Number.isFinite(n) && n > 0) setSeriesStyle(channel, { markerSize: n });
                }}
              />
            </>
          )}
        </div>
      </div>
    </details>
  );
}

export default function SeriesStyleCard({ active }: { active: Dataset | null }) {
  const styled = useApp((s) => Object.keys(s.seriesStyles).length);
  if (!active || active.data.labels.length === 0) return null;

  return (
    <Card title="Series style" count={styled || undefined} defaultOpen={false}>
      {active.data.labels.map((lab, i) => (
        <StyleRow key={i} channel={i} label={lab} />
      ))}
    </Card>
  );
}
