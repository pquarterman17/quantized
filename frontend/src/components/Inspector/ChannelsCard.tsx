// Inspector card: choose which value channels the plot draws (the backend
// /api/plot/series y_keys selection) and which ride the secondary (right) Y axis
// (y2_keys — the dual-Y feature). Only shown for multi-channel datasets — keeps
// reflectivity (R / dR / resolution) etc. legible. Analysis workshops still use
// the first channel; this controls the plot only.

import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { Card, Pill } from "../primitives";

export default function ChannelsCard({ active }: { active: Dataset | null }) {
  const yKeys = useApp((s) => s.yKeys);
  const setYKeys = useApp((s) => s.setYKeys);
  const y2Keys = useApp((s) => s.y2Keys);
  const setY2Keys = useApp((s) => s.setY2Keys);

  if (!active || active.data.labels.length < 2) return null;

  const { labels, units } = active.data;
  const selected = yKeys ?? labels.map((_, i) => i);
  const y2 = new Set(y2Keys ?? []);

  const toggle = (i: number) => {
    const next = selected.includes(i)
      ? selected.filter((x) => x !== i)
      : [...selected, i].sort((a, b) => a - b);
    if (next.length === 0) return; // always keep at least one channel visible
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
    <Card title="Channels">
      {labels.map((lab, i) => {
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
            <Pill
              active={y2.has(i)}
              disabled={!visible}
              title="Draw on the secondary (right) Y axis"
              onClick={() => toggleAxis(i)}
            >
              Y2
            </Pill>
          </div>
        );
      })}
    </Card>
  );
}
