// The floating plot legend. Each entry is click-to-hide (interactive legend) and
// double-click-to-rename (the rename overrides the channel's display label
// everywhere — legend, cursor readout, solo-axis label). Overlays (fit/peak/
// baseline — index ≥ plotted.length) are display-only: not toggleable, not
// renameable. Extracted from PlotStage to keep that component lean.

import { useState } from "react";

import type { PlotSeriesSpec } from "../../lib/plotdata";
import type { SeriesStyle } from "../../lib/types";
import { useApp } from "../../store/useApp";

interface PlotLegendProps {
  series: PlotSeriesSpec[];
  /** Per-display-series style overrides (for the swatch color), 1:1 with series. */
  styleList?: (SeriesStyle | undefined)[];
  /** Dataset channel index for each plotted display-series (overlays excluded). */
  plotted: number[];
  /** Per-display-series visibility (true = hidden), 1:1 with series. */
  hidden?: boolean[];
}

export default function PlotLegend({ series, styleList, plotted, hidden }: PlotLegendProps) {
  const hiddenChannels = useApp((s) => s.hiddenChannels);
  const toggleHidden = useApp((s) => s.toggleHidden);
  const seriesLabels = useApp((s) => s.seriesLabels);
  const setSeriesLabel = useApp((s) => s.setSeriesLabel);
  const setSeriesOrder = useApp((s) => s.setSeriesOrder);
  const [editing, setEditing] = useState<{ channel: number; value: string } | null>(null);

  const defaultLabel = (s: PlotSeriesSpec) => (s.unit ? `${s.label} (${s.unit})` : s.label);
  const commit = () => {
    if (editing) setSeriesLabel(editing.channel, editing.value);
    setEditing(null);
  };
  // Reorder a plotted series by swapping it with its neighbor in the current draw
  // order, then persist the full new order (a permutation of `plotted`).
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= plotted.length) return;
    const order = [...plotted];
    [order[i], order[j]] = [order[j], order[i]];
    setSeriesOrder(order);
  };

  return (
    <div className="qzk-glass qzk-legend">
      {series.map((s, i) => {
        // Keep the CSS token for default series (re-themes); use the resolved
        // override color when one is set, so the legend matches the line.
        const override = styleList?.[i]?.color;
        const swatch =
          override && !override.startsWith("--")
            ? override
            : override
              ? `var(${override})`
              : `var(--series-${(i % 8) + 1})`;
        // Plotted channels are click-to-toggle + double-click-to-rename; overlays
        // (i ≥ plotted.length) are not. Refuse to hide the last visible series.
        const isChannel = i < plotted.length;
        const channel = isChannel ? plotted[i] : -1;
        const isHidden = hidden?.[i] ?? false;
        const visibleCount = plotted.filter((c) => !hiddenChannels.includes(c)).length;
        const text = isChannel ? (seriesLabels[channel] ?? defaultLabel(s)) : defaultLabel(s);

        if (editing && editing.channel === channel) {
          return (
            <div className="it" key={s.label}>
              <span
                className="ln"
                style={{ display: "inline-block", width: 14, height: 2, background: swatch }}
              />
              <input
                className="qz-input"
                autoFocus
                style={{ width: 90, height: 18, padding: "0 4px" }}
                value={editing.value}
                placeholder={defaultLabel(s)}
                onChange={(e) => setEditing({ channel, value: e.target.value })}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit();
                  if (e.key === "Escape") setEditing(null);
                }}
              />
            </div>
          );
        }

        const onClick = isChannel
          ? () => {
              if (!isHidden && visibleCount <= 1) return;
              toggleHidden(channel);
            }
          : undefined;
        return (
          <div
            className="it"
            key={s.label}
            onClick={onClick}
            onDoubleClick={
              isChannel ? () => setEditing({ channel, value: seriesLabels[channel] ?? "" }) : undefined
            }
            title={isChannel ? (isHidden ? "Click to show" : "Click to hide · double-click to rename") : undefined}
            style={{
              opacity: isHidden ? 0.4 : 1,
              textDecoration: isHidden ? "line-through" : "none",
            }}
          >
            <span
              className="ln"
              style={{ display: "inline-block", width: 14, height: 2, background: swatch }}
            />
            {text}
            {isChannel && plotted.length > 1 && (
              <span style={{ marginLeft: 6, display: "inline-flex", gap: 2 }}>
                <button
                  className="qz-icon-btn"
                  title="Move earlier (draw under)"
                  disabled={i === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    move(i, -1);
                  }}
                >
                  ▲
                </button>
                <button
                  className="qz-icon-btn"
                  title="Move later (draw over)"
                  disabled={i === plotted.length - 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    move(i, 1);
                  }}
                >
                  ▼
                </button>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
