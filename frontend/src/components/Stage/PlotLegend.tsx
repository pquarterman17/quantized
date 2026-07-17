// The floating plot legend. Each entry is click-to-hide (interactive legend) and
// double-click-to-rename (the rename overrides the channel's display label
// everywhere — legend, cursor readout, solo-axis label). Overlays (fit/peak/
// baseline — index ≥ plotted.length) are display-only: not toggleable, not
// renameable. Extracted from PlotStage to keep that component lean.

import { useRef, useState } from "react";

import ContextMenu, { type ContextMenuItem } from "../overlays/ContextMenu";
import { CHANNEL_DND, encodeChannelDrag } from "../../lib/dragaxis";
import { colorScaleLegendEntries, type ColorScatterSpec } from "../../lib/colorscatter";
import { colormapCss } from "../../lib/colormap";
import { resolveDrawColor } from "../../lib/contrastColor";
import { fmtNum } from "../../lib/format";
import type { PlotSeriesSpec } from "../../lib/plotdata";
import { nearestLegendCorner } from "../../lib/plotview";
import type { SeriesStyle } from "../../lib/types";
import { RichText } from "../primitives";
import { useActiveDataset, useApp } from "../../store/useApp";
import LegendSample from "./LegendSample";

interface PlotLegendProps {
  series: PlotSeriesSpec[];
  /** Per-display-series style overrides (for the swatch color), 1:1 with series. */
  styleList?: (SeriesStyle | undefined)[];
  /** Dataset channel index for each plotted display-series (overlays excluded). */
  plotted: number[];
  /** Per-display-series visibility (true = hidden), 1:1 with series. */
  hidden?: boolean[];
  /** Colour-mapped-scatter specs (MAIN #14) — drives the colorbar chip below
   *  the series list (min/max labels + a colormap gradient strip) whenever at
   *  least one series is colour-mapped. */
  colorByColumns?: Map<number, ColorScatterSpec>;
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
  /** Global trace fallback when a series has no explicit style. */
  defaultTrace?: string;
}

export default function PlotLegend({
  series,
  styleList,
  plotted,
  hidden,
  colorByColumns,
  isDarkBg = true,
  inkColor,
  defaultTrace,
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
  const legendXY = useApp((s) => s.legendXY);
  const setLegendXY = useApp((s) => s.setLegendXY);
  const setLegendPos = useApp((s) => s.setLegendPos);
  // Static mode (decode #52): an applied Origin figure renders a clean,
  // read-only legend — no reorder arrows, no row click/dblclick/drag/context
  // handlers, hidden channels omitted (not greyed) — plus an optional bold
  // title header. The BOX itself stays draggable (still Origin-like). Default
  // false keeps the full interactive legend for every ordinary plot.
  const legendStatic = useApp((s) => s.legendStatic);
  const legendTitle = useApp((s) => s.legendTitle);
  const tool = useApp((s) => s.plotTool);
  const [editing, setEditing] = useState<{ channel: number; value: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; channel: number; i: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  // MAIN #18: drag the legend BOX (its own background/padding — NOT a series
  // row, which keeps its existing click/dblclick/rightclick/channel-DnD
  // behaviour untouched even in pointer mode) to a free position, expressed
  // as fractions of the `.qzk-stage` container so a window resize keeps it
  // sane. rAF-throttled store writes (PlotWindowFrame's own drag convention)
  // since this fires on every mousemove, unlike the canvas gestures above
  // which use a plugin-local live override instead — this is a plain DOM
  // element outside the uPlot canvas, so a live store write costs nothing
  // more than any other React re-render.
  const dragFraction = (e: { clientX: number; clientY: number }): [number, number] | null => {
    // `.parentElement`, not `.offsetParent`: PlotStage always renders
    // PlotLegend as a DIRECT child of the `.qzk-stage` div (the `.qzk-glass`
    // positioning context) — same element either way here, but jsdom's
    // `offsetParent` needs real layout (always null without it) while
    // `parentElement` is plain DOM-tree traversal, so this stays testable.
    const parent = boxRef.current?.parentElement;
    if (!parent) return null;
    const rect = parent.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const fx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const fy = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    return [fx, fy];
  };
  const onBoxMouseDown = (e: React.MouseEvent) => {
    if (tool !== "pointer" || e.button !== 0 || e.target !== e.currentTarget) return;
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      const fxy = dragFraction(ev);
      if (!fxy) return;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => setLegendXY(fxy));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };
  const onBoxDoubleClick = (e: React.MouseEvent) => {
    if (tool !== "pointer" || e.target !== e.currentTarget || !legendXY) return;
    setLegendPos(nearestLegendCorner(legendXY[0], legendXY[1]));
    setLegendXY(null);
  };

  // Toggle a plotted channel between the primary (left) and secondary (right) Y
  // axis — the right-click equivalent of the dual-Y picker in the Channels card.
  const toggleY2 = (channel: number) => {
    const set = new Set(y2Keys ?? []);
    if (set.has(channel)) set.delete(channel);
    else set.add(channel);
    setY2Keys(set.size ? [...set] : null);
  };

  // Colorbar chip (MAIN #14): one row per colour-mapped series, a minimal
  // inline affordance (gradient strip + min/max) — there's no map-stage
  // canvas colorbar to reuse here (that renderer's rect math is tied to its
  // OWN canvas layout, not this DOM legend), so this is deliberately simple.
  const colorScales =
    active && colorByColumns && colorByColumns.size > 0
      ? colorScaleLegendEntries(active.data, colorByColumns)
      : [];

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
    <div
      ref={boxRef}
      className={`qzk-glass qzk-legend ${legendXY ? "" : legendPos}`}
      style={legendXY ? { left: `${legendXY[0] * 100}%`, top: `${legendXY[1] * 100}%`, right: "auto", bottom: "auto" } : undefined}
      onMouseDown={onBoxMouseDown}
      onDoubleClick={onBoxDoubleClick}
      title={tool === "pointer" ? "Drag to move · double-click to reset to a corner" : undefined}
    >
      {/* Decode #52: Origin's bold legend title header, drawn above the
          entries in static mode (rich-text so `\g(q)`→θ etc. render). */}
      {legendStatic && legendTitle ? (
        <div className="it qzk-legend-title" style={{ fontWeight: 700 }}>
          <RichText text={legendTitle} />
        </div>
      ) : null}
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
        // Static (Origin) legend: omit hidden channels entirely rather than
        // showing them greyed + struck through — Origin's legend never lists
        // the error/secondary-X columns it doesn't draw (decode #52).
        if (legendStatic && isHidden) return null;
        const visibleCount = plotted.filter((c) => !hiddenChannels.includes(c)).length;
        const text = isChannel ? (seriesLabels[channel] ?? defaultLabel(s)) : defaultLabel(s);

        if (editing && editing.channel === channel) {
          return (
            <div className="it" key={s.label}>
              <LegendSample color={swatch} style={styleList?.[i]} defaultTrace={defaultTrace} />
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

        // Static mode strips ALL per-row interactivity (decode #52): the
        // legend is a faithful read-only Origin block. `interactive` gates
        // every handler + the reorder arrows below in one place.
        const interactive = isChannel && !legendStatic;
        const onClick = interactive
          ? () => {
              if (!isHidden && visibleCount <= 1) return;
              toggleHidden(channel);
            }
          : undefined;
        const draggable = interactive && !!active;
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
              interactive ? () => setEditing({ channel, value: seriesLabels[channel] ?? "" }) : undefined
            }
            onContextMenu={
              interactive
                ? (e) => {
                    e.preventDefault();
                    e.stopPropagation(); // don't fall through to the stage axes menu
                    setMenu({ x: e.clientX, y: e.clientY, channel, i });
                  }
                : undefined
            }
            title={
              interactive
                ? "Click to hide/show · double-click to rename · drag onto an axis band · right-click for more"
                : undefined
            }
            style={{
              opacity: isHidden ? 0.4 : 1,
              textDecoration: isHidden ? "line-through" : "none",
            }}
          >
            <LegendSample color={swatch} style={styleList?.[i]} defaultTrace={defaultTrace} />
            {/* Rich-text rename support (GOTO #5): `$...$` renders as math. */}
            <RichText text={text} />
            {interactive && plotted.length > 1 && (
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
      {colorScales.map((cs, i) => (
        <div className="it qzk-colorbar" key={`cbar-${i}`} title={`colour = ${cs.label}`}>
          <span
            className="qzk-colorbar-grad"
            style={{
              background: `linear-gradient(90deg, ${Array.from({ length: 9 }, (_, s) =>
                colormapCss(cs.colormap, s / 8),
              ).join(", ")})`,
            }}
          />
          <span className="qzk-colorbar-lbl">{fmtNum(cs.lo)}</span>
          <span className="qzk-colorbar-lbl">–</span>
          <span className="qzk-colorbar-lbl">{fmtNum(cs.hi)}</span>
        </div>
      ))}
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
