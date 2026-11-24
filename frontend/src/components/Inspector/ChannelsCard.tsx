// Inspector card: assign per-channel plot roles. Choose the x-axis source
// (x_key), which value channels the plot draws (y_keys), which Y axis each rides
// (Y1 left; Y2, Y3, ... right -- y2_keys / yAxisOf, lib/multiY.ts), and which channel holds a series'
// ± error (error bars). Only shown for multi-channel datasets — keeps reflectivity
// (R / dR / resolution) etc. legible. Analysis workshops still use the first
// channel; this controls the plot only.

import { useState } from "react";

import { CHANNEL_DND, encodeChannelDrag } from "../../lib/dragaxis";
import { describeLabelRow, labelRows, labelsFromRow, type LabelRow } from "../../lib/labelRows";
import { withErrKey, withSymmetricYError } from "../../lib/errorRoleEdits";
import { symmetricBinding } from "../../lib/errorRoles";
import { channelModelingType } from "../../lib/modeling";
import { defaultDenseChannels } from "../../lib/plotdata";
import { MAX_EXTRA_Y } from "../../lib/multiY";
import { setSeriesYAxis } from "../../lib/multiYEdit";
import type { ChannelRole, Dataset, ModelingType } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { SliderRow } from "../primitives/SliderRow";
import BufferedNumberField from "../primitives/BufferedNumberField";
import { Select } from "../primitives";
import Card from "../primitives/Card";
import ChannelsFilterBar from "./ChannelsFilterBar";
import { useWaterfallReveal } from "./useWaterfallReveal";

/** Above this many columns the card switches to one compact line per channel. */
const COMPACT_ABOVE = 12;

/** Compact modeling-type tags for the per-channel select. */
const TYPE_TAG: Record<ModelingType, string> = { continuous: "C", ordinal: "O", nominal: "N" };

/** Keyed by dataset so the filter text and opened rows never leak across files. */
export default function ChannelsCard({ active }: { active: Dataset | null }) {
  return <ChannelsCardBody key={active?.id ?? ""} active={active} />;
}

function ChannelsCardBody({ active }: { active: Dataset | null }) {
  const xKey = useApp((s) => s.xKey);
  const setXKey = useApp((s) => s.setXKey);
  const yKeys = useApp((s) => s.yKeys);
  const setYKeys = useApp((s) => s.setYKeys);
  const y2Keys = useApp((s) => s.y2Keys);
  const setY2Keys = useApp((s) => s.setY2Keys);
  const yAxes = useApp((s) => s.yAxes), yAxisOf = useApp((s) => s.yAxisOf);
  const exchanged = useApp((s) => s.exchangeXY); // Y3+ is not drawn on an exchanged plot (lib/exchangeXY.ts)
  const errKeys = useApp((s) => s.errKeys);
  const setErrKey = useApp((s) => s.setErrKey);
  const setErrorRoles = useApp((s) => s.setErrorRoles);
  const setChannelRole = useApp((s) => s.setChannelRole);
  const setChannelType = useApp((s) => s.setChannelType);
  const waterfall = useApp((s) => s.waterfall);
  const setWaterfall = useApp((s) => s.setWaterfall);
  const waterfallDx = useApp((s) => s.waterfallDx);
  const setWaterfallDx = useApp((s) => s.setWaterfallDx);
  const endHistoryRun = useApp((s) => s.endHistoryRun);

  const waterfallRef = useWaterfallReveal("Channels");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());

  if (!active || active.data.labels.length < 2) return null;

  const { labels, units } = active.data;
  const channelRoles = active.channelRoles ?? {}; // per-dataset label/ignore roles
  // The auto-picked default (yKeys=null) is the dense-channel subset, not
  // "every channel" — a NaN-sparse channel (e.g. QD magnetometry columns
  // populated only for one measurement sub-mode) stays off by default so it
  // can't wreck the shared y-axis autoscale. See defaultDenseChannels.
  const denseDefault = defaultDenseChannels(active.data, xKey);
  const selected = yKeys ?? denseDefault;
  const y2 = new Set(y2Keys ?? []);
  // Plottable data channels = non-x channels with no column role; the plot needs ≥1.
  const dataCount = labels.filter((_, i) => i !== xKey && !channelRoles[i]).length;

  const changeRole = (i: number, role: ChannelRole | null) => {
    // Keep at least one plottable data channel (don't let the plot go empty).
    if (role != null && !channelRoles[i] && dataCount <= 1) return;
    setChannelRole(i, role);
    // A non-data channel can't ride the secondary axis.
    if (role != null && y2.has(i)) {
      const ny2 = (y2Keys ?? []).filter((x) => x !== i);
      setY2Keys(ny2.length ? ny2 : null);
    }
  };
  // Default x source name (ds.time), e.g. "Temperature" or "Index". Prefer the
  // Origin long name over the raw column letter, matching the plot x-axis.
  // Figures-audit #10: a series' "±" shows the error actually drawn -- the
  // legacy pick, else the dataset's role binding (the Error columns card's
  // answer, which used to be invisible here) -- and a pick writes BOTH, so
  // the two cards never disagree about one series.
  const roles = active.errorRoles ?? [];
  const errorFor = (i: number): number | null => errKeys[i] ?? symmetricBinding(roles, i, "y");
  const pickError = (i: number, channel: number | null) => {
    // ONE undo step per pick. Each store setter records its own, so only the
    // one(s) that change anything run -- and when BOTH must (a restored
    // legacy pick plus an unbound role), the roles' entry already holds the
    // pre-pick state, so the legacy key is written under it, unrecorded.
    const keyChanges = (errKeys[i] ?? null) !== channel;
    const rolesChange = symmetricBinding(roles, i, "y") !== channel;
    if (rolesChange) setErrorRoles(active.id, withSymmetricYError(roles, i, channel));
    if (keyChanges && !rolesChange) setErrKey(i, channel);
    else if (keyChanges) useApp.setState((s) => ({ errKeys: withErrKey(s.errKeys, i, channel) }));
  };
  const meta = active.data.metadata;
  // #33: the file's other descriptive rows, offered as legend-label sources.
  const sources = labelRows(active.data);
  const applyLabelRow = (row: LabelRow) => {
    // One history entry for the whole row: picking a source is a single
    // gesture, and undoing it channel-by-channel would be unusable.
    useApp.getState().recordHistory("legend labels from header row");
    const labelsMap = labelsFromRow(row);
    useApp.setState((s) => ({ seriesLabels: { ...s.seriesLabels, ...labelsMap } }));
    useApp.getState().setStatus(
      `legend labels from "${describeLabelRow(row)}" (${Object.keys(labelsMap).length} channels)`,
    );
  };
  const xDefaultLabel = String(meta?.["x_column_long"] || meta?.["x_column_name"] || "Index");

  const apply = (next: number[], dropped: number[]) => {
    // Keep at least one *plotted* (non-x) channel — the x channel is filtered out.
    if (next.filter((x) => x !== xKey).length === 0) return;
    // Collapse back to the "auto" sentinel (null) only when the manual pick
    // matches what the dense default would already select — NOT whenever
    // every channel is checked, since the default itself may hide some
    // (sparse) channels. Otherwise a user who deliberately re-enables a sparse
    // channel would see it immediately un-check itself on the next render.
    const isDefault =
      next.length === denseDefault.length && next.every((v, idx) => v === denseDefault[idx]);
    setYKeys(isDefault ? null : next);
    // A hidden channel can't sit on the secondary axis.
    const ny2 = (y2Keys ?? []).filter((x) => !dropped.includes(x));
    if (ny2.length !== y2.size) setY2Keys(ny2.length ? ny2 : null);
  };
  const toggle = (i: number) =>
    selected.includes(i)
      ? apply(selected.filter((x) => x !== i), [i])
      : apply([...selected, i].sort((a, b) => a - b), []);

  // Many-column mode: Select all / none act on the rows the filter shows.
  const compact = labels.length > COMPACT_ABOVE;
  const needle = query.trim().toLowerCase();
  const matches = (i: number): boolean => !needle || `${labels[i]} ${units[i] ?? ""}`.toLowerCase().includes(needle);
  const targets = labels.map((_, i) => i).filter((i) => i !== xKey && !channelRoles[i] && matches(i));
  const shownCount = labels.filter((_, i) => i !== xKey && matches(i)).length;
  const selectAll = () => apply([...new Set([...selected, ...targets])].sort((a, b) => a - b), []);
  const selectNone = () => {
    const rest = selected.filter((x) => !targets.includes(x));
    // Never empty the plot: the first channel that was plotted stays.
    const keep = rest.some((x) => x !== xKey) ? rest : [selected.find((x) => x !== xKey) ?? 0];
    apply(keep, targets.filter((t) => !keep.includes(t)));
  };

  // The axis a channel draws on: an extra axis that exists, else Y2 / Y1 (an
  // orphan assignment draws on Y1 -- lib/multiY.ts).
  const axisOf = (i: number): number => (yAxisOf[i] !== undefined && yAxisOf[i] - 3 < yAxes.length ? yAxisOf[i] : y2.has(i) ? 2 : 1);
  const axisChoices = [1, 2, ...yAxes.map((_, k) => k + 3), ...(yAxes.length < MAX_EXTRA_Y && !exchanged ? [yAxes.length + 3] : [])];
  const moveAxis = (i: number, n: number) => {
    // Keep at least one visible channel on the primary axis.
    if (n !== 1 && axisOf(i) === 1 && selected.filter((x) => x !== xKey && axisOf(x) === 1).length <= 1) {
      useApp.getState().setStatus("Keep at least one series on Y1");
      return;
    }
    setSeriesYAxis(useApp.getState, i, n);
  };

  return (
    <Card title="Channels" defaultOpen={false} helpTopic="Graph Builder">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ flex: "0 0 auto", color: "var(--text-dim)" }}>X axis</span>
        <Select
          style={{ flex: 1 }}
          value={xKey == null ? "" : String(xKey)}
          onChange={(e) => setXKey(e.target.value === "" ? null : Number(e.target.value))}
          title="Channel to use as the plot's x-axis (default = the dataset's x column)"
          options={[
            { value: "", label: `${xDefaultLabel} (default)` },
            ...labels.map((lab, i) => ({ value: String(i), label: units[i] ? `${lab} (${units[i]})` : lab })),
          ]}
        />
      </div>
      {sources.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          {/* MAIN #33: a lab file often describes its columns on several rows
              (name, units, sample id, applied field). The parser keeps them all
              now; which one deserves to be the legend depends on the plot, not
              on the file, so it is a choice here rather than a parse-time
              guess. Applying one writes the same per-channel overrides a manual
              legend rename does, so it is undoable and round-trips. */}
          <span style={{ flex: "0 0 auto", color: "var(--text-dim)" }}>Legend from</span>
          <Select
            style={{ flex: 1 }}
            value=""
            onChange={(e) => {
              const row = sources.find((r) => String(r.index) === e.target.value);
              if (row) applyLabelRow(row);
            }}
            title="Use one of the file's descriptive header rows as the legend labels"
            options={[
              { value: "", label: "— choose a header row —" },
              ...sources.map((r) => ({ value: String(r.index), label: describeLabelRow(r) })),
            ]}
          />
        </div>
      )}
      {compact && (
        <ChannelsFilterBar query={query} onQuery={setQuery} shown={shownCount} total={labels.length - (xKey == null ? 0 : 1)} onAll={selectAll} onNone={selectNone} />
      )}
      {labels.map((lab, i) => {
        if (i === xKey) return null; // this channel is the X axis, not a Y series
        if (compact && !matches(i)) return null;
        const role = channelRoles[i];
        const isData = !role; // a roled channel (label/ignore) is not a plotted series
        const visible = isData && selected.includes(i);
        const expanded = !compact || open.has(i);
        const roleSelect = (
          <Select
            style={{ flex: compact ? "0 0 auto" : "0.9 1 0", minWidth: 0, width: compact ? 74 : undefined }}
            aria-label={`${lab} column role`}
            value={role ?? ""}
            onChange={(e) => changeRole(i, e.target.value === "" ? null : (e.target.value as ChannelRole))}
            title="Column role — Data: plotted · Label: kept in the worksheet but off the plot · Ignore: also dropped from statistics"
            options={[
              { value: "", label: "Data" },
              { value: "label", label: "Label" },
              { value: "ignore", label: "Ignore" },
            ]}
          />
        );
        const axisSelect = (
          <Select
            style={{ flex: "0 0 auto", width: 64 }}
            aria-label={`${lab} Y axis`}
            disabled={!visible}
            value={String(axisOf(i))}
            onChange={(e) => moveAxis(i, Number(e.target.value))}
            title="The Y axis this series is drawn on: Y1 left, Y2 right, Y3 and up further right, each pushed out one slot (Plot ▸ Y Axis Settings… sets each one's range, scale, title and color)"
            options={axisChoices.map((n) => ({ value: String(n), label: n - 3 === yAxes.length ? `+Y${n}` : `Y${n}` }))}
          />
        );
        return (
          // Figures-audit #14: TWO lines per channel. One line (name + up to
          // three selects + the Y2 pill) did not fit the Inspector's default
          // 296px column: the name collapsed to a few characters and the
          // error select clipped to "± symmet…". The name line now owns the
          // full width; the controls share the line below it equally.
          // Many-column files (UX-D): ONE line per channel -- checkbox, name,
          // role -- and the rest behind a "⋯" disclosure, so a 38-column file
          // is a scannable list rather than 114 dropdowns.
          <div key={i} className="qzk-channel-row" style={{ marginBottom: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label
                className="qz-check"
                style={{ flex: 1, minWidth: 0, opacity: isData ? 1 : 0.6 }}
                draggable
                title={`${lab}${units[i] ? ` (${units[i]})` : ""} — drag onto the plot's X / Y / Y2 axis band to re-plot it there`}
                onDragStart={(e) => {
                  e.dataTransfer.setData(CHANNEL_DND, encodeChannelDrag({ datasetId: active.id, channel: i }));
                  e.dataTransfer.effectAllowed = "copy";
                }}
              >
                <input type="checkbox" checked={visible} disabled={!isData} onChange={() => toggle(i)} />
                {/* Still truncates (never overflows) for a genuinely long
                    name; the full name is the row's tooltip. */}
                <span
                  style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}
                >
                  {lab}
                  {units[i] ? ` (${units[i]})` : ""}
                </span>
              </label>
              {compact && visible && axisOf(i) !== 1 && (
                <span className="qz-k" title="Drawn on this Y axis (change it under ⋯)" style={{ flex: "0 0 auto", color: "var(--accent)" }}>
                  Y{axisOf(i)}
                </span>
              )}
              {compact ? roleSelect : axisSelect}
              {compact && (
                <button
                  type="button"
                  className="qz-icon-btn"
                  aria-label={`${lab} more options`}
                  aria-expanded={expanded}
                  title="Y axis, modeling type and error column"
                  onClick={() => setOpen((o) => { const n = new Set(o); if (!n.delete(i)) n.add(i); return n; })}
                >
                  ⋯
                </button>
              )}
            </div>
            {expanded && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 21 }}>
              {compact && axisSelect}
              <Select
                style={{ flex: "1.2 1 0", minWidth: 0 }}
                aria-label={`${lab} modeling type`}
                value={active.channelTypes?.[i] ?? ""}
                onChange={(e) =>
                  setChannelType(active.id, i, e.target.value === "" ? null : (e.target.value as ModelingType))
                }
                title="Modeling type — what this column means: Continuous: a measurement axis · Ordinal: ordered levels · Nominal: categories; Auto = inferred from the values; drives categorical plotting (boxes/violins group by nominal columns)."
                options={[
                  { value: "", label: `auto·${TYPE_TAG[channelModelingType(active, i)]}` },
                  { value: "continuous", label: "Cont" },
                  { value: "ordinal", label: "Ord" },
                  { value: "nominal", label: "Nom" },
                ]}
              />
              {!compact && roleSelect}
              {visible && (
                <Select
                  style={{ flex: "1.4 1 0", minWidth: 0 }}
                  aria-label={`${lab} error column`}
                  value={errorFor(i) == null ? "" : String(errorFor(i))}
                  onChange={(e) => pickError(i, e.target.value === "" ? null : Number(e.target.value))}
                  title="Channel holding this series' ± error (draws error bars)"
                  options={[
                    { value: "", label: "± none" },
                    ...labels
                      .map((elab, j) => ({ elab, j }))
                      .filter(({ j }) => j !== i && j !== xKey)
                      .map(({ elab, j }) => ({ value: String(j), label: `± ${elab}` })),
                  ]}
                />
              )}
            </div>
            )}
          </div>
        );
      })}
      <div ref={waterfallRef}>
        <SliderRow
          label="Waterfall"
          value={Math.round(waterfall * 100)}
          min={0}
          max={100}
          step={5}
          onChange={(v) => setWaterfall(v / 100)}
          onGestureStart={endHistoryRun}
          format={(v) => <span style={{ whiteSpace: "nowrap" }}>{`${v}% of range`}</span>}
        />
        {waterfall > 0 && (
          <div className="qzk-helptext" data-testid="waterfall-axis-hint">
            Curves are stacked: the Y axis scale reads the offset values, not each curve&apos;s own.
          </div>
        )}
      </div>
      {/* Origin's waterfall X step: series i slides right by i x this % of the x-range.
          Typed per keystroke, so focus starts a fresh undo run (setWaterfallDx coalesces). */}
      <div className="qz-slider-row" title="Shift each next series right by this % of the x-range (negative shifts left).">
        <span className="qz-k">X offset</span>
        <BufferedNumberField
          aria-label="Waterfall X offset"
          value={Number((waterfallDx * 100).toFixed(6))}
          min={-100}
          max={100}
          width={56}
          required
          unit="%"
          onFocus={endHistoryRun}
          onValue={(v) => setWaterfallDx((v ?? 0) / 100)}
        />
      </div>
    </Card>
  );
}
