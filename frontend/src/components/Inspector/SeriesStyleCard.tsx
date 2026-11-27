// Inspector card: per-channel line styling (color / width / line style) — the
// W6 "per-dataset styling" feature. Overrides are keyed in the store by dataset
// channel index; PlotStage maps them onto the plotted (display-order) series.
// Colors are stored either as a palette-token name ("--series-3", re-themeable)
// or a literal hex from the custom picker. Renders for any dataset (≥1 channel).

import { useMemo, useState } from "react";

import { drawnSeriesStyle } from "../../lib/drawnSeriesStyle";
import { defaultErrKeys } from "../../lib/errorbars";
import { effectiveYError } from "../../lib/errorRoles";
import { MARKER_SHAPES } from "../../lib/markerShapes";
import { effectiveChannels } from "../../lib/plotdata";
import type { Dataset, LineStyle, MarkerShape, SeriesStyle } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { selectFocusedWindowCycles } from "../Stage/useStageSeriesCycle";
import { useFocusedRampedStyles } from "../Stage/useSeriesRamp";
import { Checkbox } from "../primitives/Checkbox";
import { IconButton } from "../primitives/IconButton";
import { NumberField } from "../primitives/NumberField";
import { SegmentedControl } from "../primitives/SegmentedControl";
import { Select } from "../primitives";
import Card from "../primitives/Card";
import { pickSeriesYError } from "../../store/pickSeriesYError";
import SeriesFillColorControls from "./SeriesFillColorControls";
import SeriesMarkMapControls from "./SeriesMarkMapControls";
import SeriesBarsControl from "./SeriesBarsControl";
import SeriesLineStyleControls from "./SeriesLineStyleControls";
import SeriesSymbolErrorControls from "./SeriesSymbolErrorControls";
import { PT_EXPORT_HINT } from "../../lib/exportPoints";

const PALETTE = [1, 2, 3, 4, 5, 6, 7, 8];
const LINE_NAMES: Record<LineStyle, string> = { solid: "Solid", dashed: "Dashed", dotted: "Dotted" };
const LINE_OPTS: { value: LineStyle; label: string; ariaLabel: string }[] = [
  { value: "solid", label: "──", ariaLabel: LINE_NAMES.solid },
  { value: "dashed", label: "╌╌", ariaLabel: LINE_NAMES.dashed },
  { value: "dotted", label: "···", ariaLabel: LINE_NAMES.dotted },
];
const shapeLabel = (s: MarkerShape) => MARKER_SHAPES.find((m) => m.value === s)?.label ?? s;

/** Where the focused canvas draws each channel: its position in the plotted
 *  list (`effectiveChannels`, the call `usePlotPayload` makes) when the window
 *  cycles, else nothing — so the pickers show the DRAWN dash/glyph (P3.3). */
interface CycleSlot {
  channels: readonly number[];
  on: boolean;
}

type TraceMode = "line" | "scatter" | "both";
const TRACE_OPTS: { value: TraceMode; label: string }[] = [
  { value: "line", label: "Line" },
  { value: "scatter", label: "Scatter" },
  { value: "both", label: "Both" },
];

function StyleRow({
  channel,
  label,
  labels,
  naturalErr,
  datasetId,
  errorRoles,
  cycle,
  drawnColor,
  selected = false,
}: {
  channel: number;
  /** UX-A: the curve selected on the plot — its row opens and is outlined
   *  (the Inspector scrolls it into view). */
  selected?: boolean;
  cycle: CycleSlot;
  /** The colour the graph's gradient gives this curve (gap audit 4 G1), if any. */
  drawnColor?: string;
  label: string;
  /** Every channel's label, dataset-channel-index order — the fill `vs`
   *  channel picker's source (SeriesFillColorControls). */
  labels: readonly string[];
  naturalErr?: number;
  /** The dataset these rows belong to and its error roles: the Error columns
   *  card's bindings, which `errKeys` alone does not carry. */
  datasetId: string;
  errorRoles?: Dataset["errorRoles"];
}) {
  const style: SeriesStyle = useApp((s) => s.seriesStyles[channel]) ?? {};
  const setSeriesStyle = useApp((s) => s.setSeriesStyle);
  const resetSeriesStyle = useApp((s) => s.resetSeriesStyle);
  // The error column DRAWN for this series: the legacy pick, else the role
  // binding the Error columns card writes -- one rule (effectiveYError).
  const errCol = useApp((s) => effectiveYError(s.errKeys, errorRoles, channel));
  const above = cycle.channels[cycle.channels.indexOf(channel) - 1]; // a floating bar's low end
  const aboveStyle = useApp((s) => (above === undefined ? undefined : s.seriesStyles[above]));
  const endHistoryRun = useApp((s) => s.endHistoryRun);

  const drawn = drawnSeriesStyle(style, cycle.channels.indexOf(channel), cycle.channels.length, cycle.on);
  const drawnLine = drawn.style.line ?? "solid";
  const autoShape = drawn.autoMarkerShape ? drawn.style.markerShape : undefined;
  const overridden = Object.values(style).some((v) => v !== undefined);
  const customHex = style.color && !style.color.startsWith("--") ? style.color : "#8b5cf6";

  const commitWidth = (v: string) => {
    if (v.trim() === "") return setSeriesStyle(channel, { width: undefined });
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) setSeriesStyle(channel, { width: n });
  };

  // Quick trace preset: derive from width (0 = no line) + marker, and set both
  // at once. "Line"/"Both" keep any custom width when the line is already on.
  const lineOff = style.width === 0;
  const trace: TraceMode = lineOff ? "scatter" : style.marker ? "both" : "line";
  const setTrace = (t: TraceMode) => {
    if (t === "scatter") setSeriesStyle(channel, { width: 0, marker: true });
    else setSeriesStyle(channel, { marker: t === "both", ...(lineOff ? { width: undefined } : {}) });
  };
  // Error bars can be toggled on only when there's a channel to point at: an
  // existing pick or the dataset's default pairing (Origin Y-error / refl dR).
  const canError = errCol != null || naturalErr != null;

  // Open = opened by the user OR by the current selection (UX-A). They are
  // tracked apart so a deselect closes only what the selection opened, never
  // a row the user opened by hand; collapsing a selected row closes it.
  const [userOpen, setUserOpen] = useState(false);
  const [selOpen, setSelOpen] = useState(selected);
  const [prevSelected, setPrevSelected] = useState(selected);
  if (prevSelected !== selected) {
    setPrevSelected(selected);
    setSelOpen(selected);
  }
  const open = userOpen || selOpen;

  return (
    <details
      id={`series-style-${channel}`}
      className="qz-card"
      open={open}
      onToggle={(e) => {
        const now = e.currentTarget.open;
        if (now === open) return;
        setUserOpen(now);
        if (!now) setSelOpen(false);
      }}
      aria-current={selected || undefined}
      style={{ marginBottom: 4, ...(selected ? { outline: "2px solid var(--accent)", outlineOffset: -1 } : {}) }}
    >
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
              : drawnColor ?? `var(--series-${(channel % 8) + 1})`,
          }}
        />
        {label}
        {overridden && (
          <IconButton
            aria-label="Reset style"
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
        <div
          style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}
        >
          <SegmentedControl<TraceMode> options={TRACE_OPTS} value={trace} onChange={setTrace} />
          <Checkbox
            checked={errCol != null}
            disabled={!canError}
            onChange={(c) => pickSeriesYError(datasetId, channel, c ? (naturalErr ?? errCol ?? null) : null)}
          >
            Error bars
          </Checkbox>
        </div>

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
            // Fires on every step of a picker drag: coalesce to one undo entry
            // per gesture, which begins at the pointer/key press that opens it.
            onPointerDown={endHistoryRun}
            onKeyDown={endHistoryRun}
            onChange={(e) => setSeriesStyle(channel, { color: e.target.value }, `series-color:${channel}`)}
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
            aria-label="Line width"
            unit="pt"
            title={PT_EXPORT_HINT}
            onChange={commitWidth}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
          <span className="qzk-field-lbl" style={{ margin: 0 }}>
            Line
          </span>
          {/* The DRAWN dash (P3.3 auto cycle resolved), marked "(auto)" when
              the cycle chose it; picking any entry stores it explicitly. */}
          <SegmentedControl<LineStyle>
            options={LINE_OPTS}
            aria-label="Line style"
            value={drawnLine}
            onChange={(v) => setSeriesStyle(channel, { line: v })}
          />
          {drawn.autoLine && (
            <span className="qzk-field-lbl" style={{ margin: 0 }} title="Set by the automatic style cycle.">
              {LINE_NAMES[drawnLine]} (auto)
            </span>
          )}
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
              {/* An auto glyph gets its own leading "(auto)" entry, so picking
                  that same shape below still stores it explicitly. */}
              <Select
                options={
                  autoShape
                    ? [{ value: "", label: `${shapeLabel(autoShape)} (auto)` }, ...MARKER_SHAPES]
                    : MARKER_SHAPES
                }
                value={autoShape ? "" : (style.markerShape ?? "circle")}
                title="Marker shape"
                onChange={(e) => {
                  if (e.target.value) setSeriesStyle(channel, { markerShape: e.target.value as MarkerShape });
                }}
              />
              <NumberField
                value={style.markerSize != null ? String(style.markerSize) : ""}
                width={44}
                placeholder="5"
                unit="pt"
                title={PT_EXPORT_HINT}
                onChange={(v) => {
                  if (v.trim() === "") return setSeriesStyle(channel, { markerSize: undefined });
                  const n = Number(v);
                  if (Number.isFinite(n) && n > 0) setSeriesStyle(channel, { markerSize: n });
                }}
              />
            </>
          )}
        </div>

        <SeriesSymbolErrorControls
          channel={channel} style={style} setSeriesStyle={setSeriesStyle}
          markers={style.marker ?? false} errors={errCol != null} drawnColor={drawnColor}
        />

        <SeriesLineStyleControls channel={channel} style={style} setSeriesStyle={setSeriesStyle} markers={style.marker ?? false} />

        <SeriesFillColorControls
          channel={channel}
          style={style}
          labels={labels}
          setSeriesStyle={setSeriesStyle}
        />

        <SeriesBarsControl channel={channel} style={style} setSeriesStyle={setSeriesStyle} above={above} aboveStyle={aboveStyle} />
        <SeriesMarkMapControls channel={channel} style={style} setSeriesStyle={setSeriesStyle} />
      </div>
    </details>
  );
}

export default function SeriesStyleCard({
  active,
  selectedChannel,
}: {
  active: Dataset | null;
  /** UX-A: the dataset channel of the curve selected on the plot, if any. */
  selectedChannel?: number;
}) {
  const styled = useApp((s) => Object.keys(s.seriesStyles).length);
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const data = active?.data;
  const roles = active?.channelRoles;
  const channels = useMemo(
    () => (data ? effectiveChannels(data, yKeys, xKey, roles, seriesOrder) : []),
    [data, roles, yKeys, xKey, seriesOrder],
  );
  const on = useApp((s) => selectFocusedWindowCycles(s, channels.length));
  const cycle = useMemo<CycleSlot>(() => ({ on, channels: on ? channels : [] }), [on, channels]);
  const ramped = useFocusedRampedStyles(active, useApp((s) => s.plotWindows.find((w) => w.id === s.focusedWindowId)?.document));
  if (!active || active.data.labels.length === 0) return null;

  // Default error pairing per series (Origin Y-error / parser hint) so the
  // per-row "Error bars" toggle knows which column to switch on.
  const natErr = defaultErrKeys(active.data);
  return (
    <Card
      title="Series style"
      count={styled || undefined}
      defaultOpen={false}
      helpTopic="Publication preview"
    >
      {active.data.labels.map((lab, i) => (
        <StyleRow
          key={i}
          channel={i}
          label={lab}
          labels={active.data.labels}
          naturalErr={natErr[i]}
          datasetId={active.id}
          errorRoles={active.errorRoles}
          cycle={cycle}
          drawnColor={ramped[i]?.color}
          selected={i === selectedChannel}
        />
      ))}
    </Card>
  );
}
