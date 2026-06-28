// Inspector card: assign per-channel plot roles. Choose the x-axis source
// (x_key), which value channels the plot draws (y_keys), which ride the secondary
// (right) Y axis (y2_keys — the dual-Y feature), and which channel holds a series'
// ± error (error bars). Only shown for multi-channel datasets — keeps reflectivity
// (R / dR / resolution) etc. legible. Analysis workshops still use the first
// channel; this controls the plot only.

import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { Card, Pill, Select, SliderRow } from "../primitives";

export default function ChannelsCard({ active }: { active: Dataset | null }) {
  const xKey = useApp((s) => s.xKey);
  const setXKey = useApp((s) => s.setXKey);
  const yKeys = useApp((s) => s.yKeys);
  const setYKeys = useApp((s) => s.setYKeys);
  const y2Keys = useApp((s) => s.y2Keys);
  const setY2Keys = useApp((s) => s.setY2Keys);
  const errKeys = useApp((s) => s.errKeys);
  const setErrKey = useApp((s) => s.setErrKey);
  const waterfall = useApp((s) => s.waterfall);
  const setWaterfall = useApp((s) => s.setWaterfall);

  if (!active || active.data.labels.length < 2) return null;

  const { labels, units } = active.data;
  const selected = yKeys ?? labels.map((_, i) => i);
  const y2 = new Set(y2Keys ?? []);
  // Default x source name (ds.time), e.g. "Temperature" or "Index".
  const xDefaultLabel = String(active.data.metadata?.["x_column_name"] ?? "Index");

  const toggle = (i: number) => {
    const next = selected.includes(i)
      ? selected.filter((x) => x !== i)
      : [...selected, i].sort((a, b) => a - b);
    // Keep at least one *plotted* (non-x) channel — the x channel is filtered out.
    if (next.filter((x) => x !== xKey).length === 0) return;
    setYKeys(next.length === labels.length ? null : next);
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
        const visible = selected.includes(i);
        return (
          <div
            key={i}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}
          >
            <label className="qz-check">
              <input type="checkbox" checked={visible} onChange={() => toggle(i)} />
              {lab}
              {units[i] ? ` (${units[i]})` : ""}
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {visible && (
                <Select
                  style={{ maxWidth: 96 }}
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
