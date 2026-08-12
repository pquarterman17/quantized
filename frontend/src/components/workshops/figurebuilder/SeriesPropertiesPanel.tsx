// Per-series properties for the canonical Publication Preview draft (F2.3b):
// color / width / mode, visibility, and display order -- the same PlotView
// fields (seriesStyles/hiddenChannels/seriesOrder) the Stage's
// `Inspector/SeriesStyleCard.tsx` and `Inspector/PlotObjectsCard.tsx` already
// edit, now reachable on the detached draft without touching the Stage (F2.4a
// deliberately left this Stage-owned; this slice reaches parity on the
// canonical document). Error-bar DESIGNATIONS stay a read-only summary here --
// editing them is the separate Error columns group (F2.3f's ErrorColumnsPanel).

import type { ErrorBinding } from "../../../lib/errorRoles";
import type { SeriesStyle, StepMode } from "../../../lib/types";
import { IconButton, Select } from "../../primitives";
import {
  describeSeriesErrors,
  describeXAxisErrors,
  SERIES_MODE_OPTIONS,
  STEP_ALIGN_OPTIONS,
  seriesModeOf,
  seriesModePatch,
  type SeriesMode,
} from "./canonicalSeries";
import PropertyNumberField from "./PropertyNumberField";

const PALETTE = [1, 2, 3, 4, 5, 6, 7, 8];

export default function SeriesPropertiesPanel({
  labels,
  channels,
  styles,
  hiddenChannels,
  seriesLabels,
  errors,
  onStyle,
  onHiddenChange,
  onMove,
}: {
  /** The dataset's raw channel labels, indexed by channel. */
  labels: readonly string[];
  /** Plotted channel indices in DISPLAY order (already reflects seriesOrder). */
  channels: readonly number[];
  styles: Record<number, SeriesStyle>;
  hiddenChannels: readonly number[];
  /** Channel-keyed display-name overrides (legend renames). */
  seriesLabels: Record<number, string>;
  errors: readonly ErrorBinding[];
  onStyle: (channel: number, patch: Partial<SeriesStyle>) => void;
  onHiddenChange: (channel: number, hidden: boolean) => void;
  onMove: (channel: number, direction: -1 | 1) => void;
}) {
  const xErrors = describeXAxisErrors(errors, labels);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
      {xErrors && <div className="qzk-ds-meta">{`X error: ${xErrors}`}</div>}
      {channels.map((channel, i) => {
        const style = styles[channel] ?? {};
        const hidden = hiddenChannels.includes(channel);
        const label = seriesLabels[channel] ?? labels[channel] ?? `Channel ${channel + 1}`;
        const mode = seriesModeOf(style);
        const customHex = style.color && !style.color.startsWith("--") ? style.color : "#8b5cf6";
        return (
          <div
            key={channel}
            style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%", paddingBottom: 6, borderBottom: "1px solid var(--border)" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                className="qzk-tool-btn"
                aria-label={`${hidden ? "Show" : "Hide"} series ${i + 1} (${label})`}
                aria-pressed={!hidden}
                onClick={() => onHiddenChange(channel, !hidden)}
              >
                {hidden ? "○" : "●"}
              </button>
              <span className="qz-v" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
              <IconButton title="Move up" aria-label={`Move series ${i + 1} up`} disabled={i === 0} onClick={() => onMove(channel, -1)}>
                {"↑"}
              </IconButton>
              <IconButton
                title="Move down"
                aria-label={`Move series ${i + 1} down`}
                disabled={i === channels.length - 1}
                onClick={() => onMove(channel, 1)}
              >
                {"↓"}
              </IconButton>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "end" }}>
              <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
                <label className="qzk-field-lbl">mode</label>
                <Select
                  aria-label={`series ${i + 1} mode`}
                  options={SERIES_MODE_OPTIONS}
                  value={mode}
                  onChange={(event) => onStyle(channel, seriesModePatch(event.target.value as SeriesMode, style))}
                />
              </span>
              {mode === "step" && (
                <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
                  <label className="qzk-field-lbl">step align</label>
                  <Select
                    aria-label={`series ${i + 1} step alignment`}
                    options={STEP_ALIGN_OPTIONS}
                    value={style.step ?? "post"}
                    onChange={(event) => onStyle(channel, { step: event.target.value as StepMode })}
                  />
                </span>
              )}
              <PropertyNumberField
                label="width"
                ariaLabel={`series ${i + 1} width`}
                value={style.width}
                min={0}
                onValue={(width) => onStyle(channel, { width })}
              />
              <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
                <label className="qzk-field-lbl">color</label>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  {PALETTE.map((n) => {
                    const token = `--series-${n}`;
                    return (
                      <button
                        key={n}
                        aria-label={`series ${i + 1} color preset ${n}`}
                        aria-pressed={style.color === token}
                        onClick={() => onStyle(channel, { color: token })}
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: 3,
                          background: `var(${token})`,
                          border: style.color === token ? "2px solid var(--text)" : "1px solid var(--border)",
                        }}
                      />
                    );
                  })}
                  <input
                    type="color"
                    aria-label={`series ${i + 1} color`}
                    value={customHex}
                    onChange={(event) => onStyle(channel, { color: event.target.value })}
                    style={{ width: 22, height: 20, padding: 0, border: "1px solid var(--border)" }}
                  />
                </div>
              </span>
            </div>
            <div className="qzk-ds-meta">{`Y error: ${describeSeriesErrors(errors, channel, labels)}`}</div>
          </div>
        );
      })}
    </div>
  );
}
