// Inspector card: assign per-channel plot roles. Choose the x-axis source
// (x_key), which value channels the plot draws (y_keys), which ride the secondary
// (right) Y axis (y2_keys — the dual-Y feature), and which channel holds a series'
// ± error (error bars). Only shown for multi-channel datasets — keeps reflectivity
// (R / dR / resolution) etc. legible. Analysis workshops still use the first
// channel; this controls the plot only.

import { CHANNEL_DND, encodeChannelDrag } from "../../lib/dragaxis";
import { channelModelingType } from "../../lib/modeling";
import { defaultDenseChannels } from "../../lib/plotdata";
import type { ChannelRole, Dataset, ModelingType } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { Card, Pill, Select, SliderRow } from "../primitives";

/** Compact modeling-type tags for the per-channel select. */
const TYPE_TAG: Record<ModelingType, string> = { continuous: "C", ordinal: "O", nominal: "N" };

export default function ChannelsCard({ active }: { active: Dataset | null }) {
  const xKey = useApp((s) => s.xKey);
  const setXKey = useApp((s) => s.setXKey);
  const yKeys = useApp((s) => s.yKeys);
  const setYKeys = useApp((s) => s.setYKeys);
  const y2Keys = useApp((s) => s.y2Keys);
  const setY2Keys = useApp((s) => s.setY2Keys);
  const errKeys = useApp((s) => s.errKeys);
  const setErrKey = useApp((s) => s.setErrKey);
  const setChannelRole = useApp((s) => s.setChannelRole);
  const setChannelType = useApp((s) => s.setChannelType);
  const waterfall = useApp((s) => s.waterfall);
  const setWaterfall = useApp((s) => s.setWaterfall);

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
  const meta = active.data.metadata;
  const xDefaultLabel = String(meta?.["x_column_long"] || meta?.["x_column_name"] || "Index");

  const toggle = (i: number) => {
    const next = selected.includes(i)
      ? selected.filter((x) => x !== i)
      : [...selected, i].sort((a, b) => a - b);
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
    if (!next.includes(i) && y2.has(i)) {
      const ny2 = (y2Keys ?? []).filter((x) => x !== i);
      setY2Keys(ny2.length ? ny2 : null);
    }
  };

  const toggleAxis = (i: number) => {
    if (y2.has(i)) {
      const ny2 = (y2Keys ?? []).filter((x) => x !== i);
      setY2Keys(ny2.length ? ny2 : null);
    } else {
      // Keep at least one visible channel on the primary axis.
      const primaries = selected.filter((x) => !y2.has(x));
      if (primaries.length <= 1) return;
      setY2Keys([...(y2Keys ?? []), i].sort((a, b) => a - b));
    }
  };

  return (
    <Card title="Channels" defaultOpen={false}>
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
      {labels.map((lab, i) => {
        if (i === xKey) return null; // this channel is the X axis, not a Y series
        const role = channelRoles[i];
        const isData = !role; // a roled channel (label/ignore) is not a plotted series
        const visible = isData && selected.includes(i);
        return (
          <div
            key={i}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}
          >
            <label
              className="qz-check"
              // GUI_INTERACTION #17: `minWidth: 0` here alone gave this label a
              // flexbox shrink WEIGHT of 0 (flex:1 => flex-basis:0%, and CSS
              // shrink weight = flex-basis * flex-shrink) — so the row's negative
              // space (this checkbox + the 2-4 right-hand selects don't all fit
              // in the Inspector's fixed 296px column) was entirely assigned to
              // the right-hand controls `<div>` below. But THAT div's own
              // children (the Selects) had no `minWidth: 0` of their own, so it
              // hit ITS min-content floor before absorbing enough — leaving this
              // label's box at literally 0 width, with the right-hand div
              // rendered starting at the row's left edge, painting directly over
              // the checkbox. A small explicit floor (checkbox 14px + gap 7px +
              // a few px buffer) guarantees the checkbox always has a real box;
              // pushing `minWidth: 0` onto the right-hand controls instead (see
              // below) makes THEM absorb the rest of the squeeze — their text
              // is short (native <select> already clips its own display value)
              // and less harmed by shrinking than a hidden/overlapped checkbox.
              style={{ flex: 1, minWidth: 24, opacity: isData ? 1 : 0.6 }}
              draggable
              title={`Drag onto the plot's X / Y / Y2 axis band to re-plot "${lab}" there`}
              onDragStart={(e) => {
                e.dataTransfer.setData(CHANNEL_DND, encodeChannelDrag({ datasetId: active.id, channel: i }));
                e.dataTransfer.effectAllowed = "copy";
              }}
            >
              <input type="checkbox" checked={visible} disabled={!isData} onChange={() => toggle(i)} />
              {/* The channel name + units still truncates (rather than
                  overflowing into the right-hand controls) once the label
                  itself is down near its 24px floor. */}
              <span
                style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}
              >
                {lab}
                {units[i] ? ` (${units[i]})` : ""}
              </span>
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              <Select
                style={{ maxWidth: 64, minWidth: 0 }}
                value={active.channelTypes?.[i] ?? ""}
                onChange={(e) =>
                  setChannelType(i, e.target.value === "" ? null : (e.target.value as ModelingType))
                }
                title="Modeling type — what this column means. Continuous: a measurement axis · Ordinal: ordered levels · Nominal: categories. Auto = inferred from the values; drives categorical plotting (boxes/violins group by nominal columns)."
                options={[
                  { value: "", label: `auto·${TYPE_TAG[channelModelingType(active, i)]}` },
                  { value: "continuous", label: "Cont" },
                  { value: "ordinal", label: "Ord" },
                  { value: "nominal", label: "Nom" },
                ]}
              />
              <Select
                style={{ maxWidth: 78, minWidth: 0 }}
                value={role ?? ""}
                onChange={(e) => changeRole(i, e.target.value === "" ? null : (e.target.value as ChannelRole))}
                title="Column role — Data: plotted · Label: kept in the worksheet but off the plot · Ignore: also dropped from statistics"
                options={[
                  { value: "", label: "Data" },
                  { value: "label", label: "Label" },
                  { value: "ignore", label: "Ignore" },
                ]}
              />
              {visible && (
                <Select
                  style={{ maxWidth: 88, minWidth: 0 }}
                  value={errKeys[i] == null ? "" : String(errKeys[i])}
                  onChange={(e) => setErrKey(i, e.target.value === "" ? null : Number(e.target.value))}
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
              <Pill
                active={y2.has(i)}
                disabled={!visible}
                title="Draw on the secondary (right) Y axis"
                onClick={() => toggleAxis(i)}
              >
                Y2
              </Pill>
            </div>
          </div>
        );
      })}
      <SliderRow
        label="Waterfall"
        value={Math.round(waterfall * 100)}
        min={0}
        max={100}
        step={5}
        onChange={(v) => setWaterfall(v / 100)}
        format={(v) => `${v}%`}
      />
    </Card>
  );
}
