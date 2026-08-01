// Multivariate workbench (JMP_GAP J10) — SPLOM tab: the point-count / N /
// downsample note (item 3's "downsample above ~5k points per panel and say
// so in the UI" requirement) over the canvas grid, plus a server-side
// (matplotlib) SPLOM figure export (JMP_GAP_PLAN #10 residual,
// calc.figure_multivar.render_splom_figure) over the SAME listwise-complete
// row set (m.rows) the canvas draws -- the export renders the FULL row set,
// not the on-screen downsample (downsampling is a canvas performance
// concession, not a data-fidelity choice the export should inherit).

import { useCallback, useState } from "react";

import { exportSplomFigure } from "../../../lib/api";
import { transposeRows } from "../../../lib/multivar";
import { Button } from "../../primitives";
import { useApp } from "../../../store/useApp";
import SplomView from "./SplomView";
import type { MultivarState } from "./useMultivar";

export default function SplomTabView({ m }: { m: MultivarState }) {
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const setStatus = useApp((s) => s.setStatus);
  const [sample, setSample] = useState<[number, number]>([0, 0]);
  const [drawn, total] = sample;
  const [exporting, setExporting] = useState(false);

  async function exportFigure(): Promise<void> {
    setExporting(true);
    try {
      await exportSplomFigure({ labels: m.labels, columns: transposeRows(m.rows), filename: "splom" });
      setStatus("exported SPLOM figure");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "export failed");
    } finally {
      setExporting(false);
    }
  }
  // Stable identity + same-value bail-out. SplomView calls this from an
  // effect keyed on the callback's identity; an inline arrow storing a fresh
  // array each time is a render->effect->setState loop that allocates until
  // the process dies (found as PR #94's CI OOM: the fork ran this loop for
  // ~16 min past the last test before exhausting ANY heap it was given).
  const onSampleInfo = useCallback(
    (d: number, t: number) => setSample((cur) => (cur[0] === d && cur[1] === t ? cur : [d, t])),
    [],
  );

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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          N = {total} complete rows
          {drawn < total && ` — downsampled to ${drawn} points per panel (>5,000)`}
        </div>
        <Button size="sm" disabled={exporting} onClick={() => void exportFigure()}>
          {exporting ? "Exporting…" : "Export figure"}
        </Button>
      </div>
      <SplomView labels={m.labels} rows={m.rows} theme={theme} accent={accent} onSampleInfo={onSampleInfo} />
    </div>
  );
}
