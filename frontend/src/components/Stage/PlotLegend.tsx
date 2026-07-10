// The floating plot legend. Each entry is click-to-hide (interactive legend) and
// double-click-to-rename (the rename overrides the channel's display label
// everywhere — legend, cursor readout, solo-axis label). Overlays (fit/peak/
// baseline — index ≥ plotted.length) are display-only: not toggleable, not
// renameable. Extracted from PlotStage to keep that component lean.

import { useState } from "react";

import ContextMenu, { type ContextMenuItem } from "../overlays/ContextMenu";
import { CHANNEL_DND, encodeChannelDrag } from "../../lib/dragaxis";
import { resolveDrawColor } from "../../lib/contrastColor";
import type { PlotSeriesSpec } from "../../lib/plotdata";
import type { SeriesStyle } from "../../lib/types";
import { useActiveDataset, useApp } from "../../store/useApp";

interface PlotLegendProps {
  series: PlotSeriesSpec[];
  /** Per-display-series style overrides (for the swatch color), 1:1 with series. */
  styleList?: (SeriesStyle | undefined)[];
  /** Dataset channel index for each plotted display-series (overlays excluded). */
  plotted: number[];
  /** Per-display-series visibility (true = hidden), 1:1 with series. */
  hidden?: boolean[];
  /** Whether the plot's EFFECTIVE background (item 18) reads as dark — feeds
   *  the same `resolveDrawColor` contrast check the canvas stroke uses, so a
   *  legend swatch never shows an invisible literal colour the canvas line
   *  itself already substituted. */
  isDarkBg?: boolean;
  /** The achromatic ink token to substitute a low-contrast literal swatch
   *  colour with (see `resolveDrawColor`) — the live `resolvePlotBg` token,
   *  not a hardcoded default, so it re-themes/re-resolves on a background
   *  switch exactly like the canvas does. */
  inkColor?: string;
}

export default function PlotLegend({
  series,
  styleList,
  plotted,
  hidden,
  isDarkBg = true,
  inkColor,
}: PlotLegendProps) {
  const active = useActiveDataset();
  const hiddenChannels = useApp((s) => s.hiddenChannels);
  const toggleHidden = useApp((s) => s.toggleHidden);
  const seriesLabels = useApp((s) => s.seriesLabels);
  const setSeriesLabel = useApp((s) => s.setSeriesLabel);
  const setSeriesOrder = useApp((s) => s.setSeriesOrder);
  const y2Keys = useApp((s) => s.y2Keys);
  const setY2Keys = useApp((s) => s.setY2Keys);
  const legendPos = useApp((s) => s.legendPos);
  const [editing, setEditing] = useState<{ channel: number; value: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; channel: number; i: number } | null>(null);

  // Toggle a plotted channel between the primary (left) and secondary (right) Y
  // axis — the right-click equivalent of the dual-Y picker in the Channels card.
  const toggleY2 = (channel: number) => {
    const set = new Set(y2Keys ?? []);
    if (set.has(channel)) set.delete(channel);
    else set.add(channel);
    setY2Keys(set.size ? [...set] : null);
  };

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
    <div className={`qzk-glass qzk-legend ${legendPos}`}>
      {series.map((s, i) => {
        // Keep the CSS token for default series (re-themes); use the resolved
        // override color when one is set, so the legend matches the line. A
        // literal (non-token) override runs through the SAME contrast check
        // the canvas stroke uses (`buildOpts`'s `resolveDrawColor` call), so
        // a literal black swatch on our dark canvas doesn't go invisible in
        // the legend even though the plotted line itself was substituted.
        const override = styleList?.[i]?.color;
        const swatch =
          override && !override.startsWith("--")
            ? resolveDrawColor(override, isDarkBg, inkColor)
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
        const draggable = isChannel && !!active;
        return (
          <div
            className="it"
            key={s.label}
            draggable={draggable}
            onDragStart={
              draggable
                ? (e) => {
                    e.dataTransfer.setData(
                      CHANNEL_DND,
                      encodeChannelDrag({ datasetId: active!.id, channel }),
                    );
                    e.dataTransfer.effectAllowed = "copy";
                  }
                : undefined
            }
            onClick={onClick}
            onDoubleClick={
              isChannel ? () => setEditing({ channel, value: seriesLabels[channel] ?? "" }) : undefined
            }
            onContextMenu={
              isChannel
                ? (e) => {
                    e.preventDefault();
                    e.stopPropagation(); // don't fall through to the stage axes menu
                    setMenu({ x: e.clientX, y: e.clientY, channel, i });
                  }
                : undefined
            }
            title={
              isChannel
                ? "Click to hide/show · double-click to rename · drag onto an axis band · right-click for more"
                : undefined
            }
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
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={((): ContextMenuItem[] => {
            const isHidden = hiddenChannels.includes(menu.channel);
            const visibleCount = plotted.filter((c) => !hiddenChannels.includes(c)).length;
            const onY2 = (y2Keys ?? []).includes(menu.channel);
            return [
              {
                label: "Rename…",
                run: () => setEditing({ channel: menu.channel, value: seriesLabels[menu.channel] ?? "" }),
              },
              {
                label: isHidden ? "Show" : "Hide",
                run: () => toggleHidden(menu.channel),
                disabled: !isHidden && visibleCount <= 1,
              },
              { separator: true },
              {
                label: onY2 ? "Move to left Y axis" : "Move to right Y axis",
                run: () => toggleY2(menu.channel),
              },
              { separator: true },
              { label: "Move earlier (draw under)", run: () => move(menu.i, -1), disabled: menu.i === 0 },
              {
                label: "Move later (draw over)",
                run: () => move(menu.i, 1),
                disabled: menu.i === plotted.length - 1,
              },
            ];
          })()}
        />
      )}
    </div>
  );
}
