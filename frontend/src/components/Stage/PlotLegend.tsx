// The floating plot legend. Each entry is click-to-hide (interactive legend) and
// double-click-to-rename (the rename overrides the channel's display label
// everywhere — legend, cursor readout, solo-axis label). Overlays (fit/peak/
// baseline — index ≥ plotted.length) are display-only: not toggleable, not
// renameable. Extracted from PlotStage to keep that component lean.

import { useId, useState } from "react";

import ContextMenu, { type ContextMenuItem } from "../overlays/ContextMenu";
import { CHANNEL_DND, encodeChannelDrag } from "../../lib/dragaxis";
import { colorScaleLegendEntries, type ColorScatterSpec } from "../../lib/colorscatter";
import { resolveDrawColor } from "../../lib/contrastColor";
import { lazyRegion } from "../../lib/lazyRegion";
import type { PlotSeriesSpec } from "../../lib/plotdata";
import type { DefaultTrace, SeriesStyle } from "../../lib/types";
import { RichText } from "../primitives";
import { useActiveDataset, useApp } from "../../store/useApp";
import ColorScaleChip from "./ColorScaleChip";
import LegendSample from "./LegendSample";
import { resolveSeriesStyle, SERIES_VARS, type SeriesCycle } from "../../lib/seriesStyleCycle";
import { useLegendBox } from "./useLegendBox";

/** The canvas' excluded companion: line-free 5px hollow circles. */
const EXCLUDED_SAMPLE: SeriesStyle = { width: 0, marker: true, markerShape: "circle", markerSize: 5 };
/** The canvas' selected-row companion: line-free 7px accent-filled circles. */
const SELECTED_SAMPLE: SeriesStyle = { width: 0, marker: true, markerShape: "circle", markerSize: 7 };

const LegendResizeHandles = lazyRegion(() => import("./LegendResizeHandles"), "Legend resize handles");

interface PlotLegendProps {
  series: PlotSeriesSpec[];
  /** Per-display-series style overrides (for the swatch color), 1:1 with series. */
  styleList?: (SeriesStyle | undefined)[];
  /** P1.4 (`Stage/usePlotEncoding`): an encoded render's FINISHED legend text
   *  per series, winning over the channel's rename — which the encoded name
   *  already carries — exactly as the canvas labels it. Absent elsewhere. */
  labels?: (string | undefined)[];
  /** P3.3 (`lib/seriesStyleCycle.ts`): the SAME display positions the canvas
   *  beside this legend was built with. Absent = no cycle, which is what every
   *  legend rendered next to an uncycled plot passes. Without it the swatch
   *  would show the raw stored style and contradict the line it labels. */
  seriesCycle?: SeriesCycle;
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
  defaultTrace?: DefaultTrace;
}

export default function PlotLegend({
  series,
  styleList,
  labels,
  seriesCycle,
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
  // Static mode (decode #52): an applied Origin figure renders a clean,
  // read-only legend — no reorder arrows, no row click/dblclick/drag/context
  // handlers, hidden channels omitted (not greyed). The BOX itself stays
  // draggable (still Origin-like). Default false keeps the full interactive
  // legend for every ordinary plot.
  const legendStatic = useApp((s) => s.legendStatic);
  // R2: the title heads the legend in BOTH modes, as the export draws it; a
  // blank title draws no heading.
  const legendTitle = useApp((s) => s.legendTitle)?.trim() || null;
  const titleId = useId();
  const tool = useApp((s) => s.plotTool);
  const legendBox = useLegendBox(tool);
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

  // Colorbar chip (MAIN #14): one row per colour-mapped series, a minimal
  // inline affordance (gradient strip + min/max) — there's no map-stage
  // canvas colorbar to reuse here (that renderer's rect math is tied to its
  // OWN canvas layout, not this DOM legend), so this is deliberately simple.
  const colorScales =
    active && colorByColumns && colorByColumns.size > 0
      ? colorScaleLegendEntries(active.data, colorByColumns)
      : [];

  const defaultLabel = (s: PlotSeriesSpec) => (s.unit ? `${s.label} (${s.unit})` : s.label);
  // A row's finished text. An EMPTY one has no legend row (the series stays
  // plotted), exactly as the export's matplotlib legend drops a zero-length label.
  const rowText = (s: PlotSeriesSpec, i: number) =>
    i < plotted.length ? (labels?.[i] ?? seriesLabels[plotted[i]] ?? defaultLabel(s)) : defaultLabel(s);
  // Static mode omits hidden rows too (below), so they do not count.
  const anyRow = series.some((s, i) => rowText(s, i) !== "" && !(legendStatic && (hidden?.[i] ?? false)));
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

  // No rows, no title, no colour scale: no box, as the export draws no legend.
  if (!anyRow && !legendTitle && colorScales.length === 0) return null;
  const visibleCount = plotted.filter((c) => !hiddenChannels.includes(c)).length;
  // "auto" past the palette's eight shown series: a column outside the frame
  // (shell.css; the export's "outside right"). Else lib/legendAutoPlace's corner.
  const pos = legendBox.legendPos === "auto" && visibleCount > SERIES_VARS.length ? "out" : legendBox.legendPos;

  return (
    <div
      ref={legendBox.boxRef}
      // Precedence (decode #52): frame anchor > free container fraction > corner
      // preset. A frame-anchored or free position drops the corner class.
      className={`qzk-glass qzk-legend ${legendBox.isFree ? "" : pos}`}
      style={legendBox.style}
      onMouseDown={legendBox.onBoxMouseDown}
      onDoubleClick={legendBox.onBoxDoubleClick}
      title={tool === "pointer" ? "Drag to move · drag an edge or corner to resize · double-click to reset position" : undefined}
      role="group"
      aria-label={legendTitle ? undefined : "Plot legend"}
      aria-labelledby={legendTitle ? titleId : undefined}
    >
      {tool === "pointer" && <LegendResizeHandles boxRef={legendBox.boxRef} />}
      <div className="qzk-legend-content">
      {/* Decode #52 / R2: the bold legend title heading, drawn above the
          entries INSIDE the content wrapper so fit-to-contents sizing includes
          it (rich-text so `\g(q)`→θ etc. render). */}
      {legendTitle ? (
        <div className="it qzk-legend-title" id={titleId}>
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
        // A greyed "(excluded)" companion (`maskExcludedPayload`) is drawn in
        // the plot's dim ink as hollow markers, and exported as a grey marker
        // entry (`EXCLUDED_GHOST_STYLE`) — so its row is a dim marker, never
        // the next palette colour. A "(selected)" companion
        // (`highlightSelectedPayload`) is drawn in the accent, filled.
        const swatch = s.selected
          ? "var(--accent)"
          : s.muted
            ? `var(${isDarkBg ? "--ink-dim-on-dark" : "--ink-dim-on-light"})`
            : override && !override.startsWith("--")
              ? resolveDrawColor(override, isDarkBg, inkColor)
              : override
                ? `var(${override})`
                : `var(--series-${(i % 8) + 1})`;
        const sampleStyle = s.selected
          ? SELECTED_SAMPLE
          : s.muted
            ? EXCLUDED_SAMPLE
            : resolveSeriesStyle(styleList?.[i], i, seriesCycle ?? null);
        // Plotted channels are click-to-toggle + double-click-to-rename; overlays
        // (i ≥ plotted.length) are not. Refuse to hide the last visible series.
        const isChannel = i < plotted.length;
        const channel = isChannel ? plotted[i] : -1;
        const isHidden = hidden?.[i] ?? false;
        // Static (Origin) legend: omit hidden channels entirely rather than
        // showing them greyed + struck through — Origin's legend never lists
        // the error/secondary-X columns it doesn't draw (decode #52).
        if (legendStatic && isHidden) return null;
        const text = rowText(s, i);
        if (text === "") return null;

        if (editing && editing.channel === channel) {
          return (
            <div className="it" key={s.label}>
              <LegendSample color={swatch} style={sampleStyle} defaultTrace={defaultTrace} filled={s.selected} />
              <input
                className="qz-input"
                autoFocus
                style={{ width: 90, height: 18, padding: "0 4px" }}
                aria-label={`Legend label for ${defaultLabel(s)}`}
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
            {/* The show/hide toggle as a keyboard control: a checkbox named by
                its series. Space/Enter run the row's click (same last-visible
                guard); Shift+F10 opens the row's menu, where Rename lives. */}
            <span
              className="qzk-legend-toggle"
              role={interactive ? "checkbox" : undefined}
              aria-checked={interactive ? !isHidden : undefined}
              tabIndex={interactive ? 0 : undefined}
              onKeyDown={(e) => {
                if (e.key !== " " && e.key !== "Enter") return;
                e.preventDefault();
                onClick?.();
              }}
            >
              <LegendSample color={swatch} style={sampleStyle} defaultTrace={defaultTrace} filled={s.selected} />
              {/* Rich-text rename support (GOTO #5): `$...$` renders as math. */}
              <RichText text={text} />
            </span>
            {interactive && plotted.length > 1 && (
              <span style={{ marginLeft: 6, display: "inline-flex", gap: 2 }}>
                <button
                  aria-label="Move earlier"
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
                  aria-label="Move later"
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
        <ColorScaleChip key={`cbar-${i}`} scale={cs} />
      ))}
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          help={{ label: "plot series", query: "plot" }}
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
