// Inspector card: choose which value channels the plot draws (the backend
// /api/plot/series y_keys selection). Only shown for multi-channel datasets —
// keeps reflectivity (R / dR / resolution) etc. legible. Analysis workshops
// still use the first channel; this controls the plot only.

import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { Card } from "../primitives";

export default function ChannelsCard({ active }: { active: Dataset | null }) {
  const yKeys = useApp((s) => s.yKeys);
  const setYKeys = useApp((s) => s.setYKeys);

  if (!active || active.data.labels.length < 2) return null;

  const { labels, units } = active.data;
  const selected = yKeys ?? labels.map((_, i) => i);

  const toggle = (i: number) => {
    const next = selected.includes(i)
      ? selected.filter((x) => x !== i)
      : [...selected, i].sort((a, b) => a - b);
    if (next.length === 0) return; // always keep at least one channel visible
    setYKeys(next.length === labels.length ? null : next);
  };

  return (
    <Card title="Channels">
      {labels.map((lab, i) => (
        <label key={i} className="qz-check">
          <input
            type="checkbox"
            checked={selected.includes(i)}
            onChange={() => toggle(i)}
          />
          {lab}
          {units[i] ? ` (${units[i]})` : ""}
        </label>
      ))}
    </Card>
  );
}
