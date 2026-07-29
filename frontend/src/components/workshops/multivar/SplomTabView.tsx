// Multivariate workbench (JMP_GAP J10) — SPLOM tab: the point-count / N /
// downsample note (item 3's "downsample above ~5k points per panel and say
// so in the UI" requirement) over the canvas grid.

import { useState } from "react";

import { useApp } from "../../../store/useApp";
import SplomView from "./SplomView";
import type { MultivarState } from "./useMultivar";

export default function SplomTabView({ m }: { m: MultivarState }) {
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const [sample, setSample] = useState<[number, number]>([0, 0]);
  const [drawn, total] = sample;

  if (m.tooFewColumns) {
    return (
      <div className="qzk-ds-meta" style={{ marginTop: 12, color: "var(--text-faint)" }}>
        select at least 2 columns
      </div>
    );
  }
  if (m.rows.length < 2) {
    return (
      <div className="qzk-ds-meta" style={{ marginTop: 12, color: "var(--text-faint)" }}>
        need at least 2 complete rows
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
        N = {total} complete rows
        {drawn < total && ` — downsampled to ${drawn} points per panel (>5,000)`}
      </div>
      <SplomView labels={m.labels} rows={m.rows} theme={theme} accent={accent} onSampleInfo={(d, t) => setSample([d, t])} />
    </div>
  );
}
