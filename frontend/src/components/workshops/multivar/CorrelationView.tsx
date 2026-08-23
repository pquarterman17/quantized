// Multivariate workbench (JMP_GAP J10) — correlation tab: pearson/spearman
// toggle, the CorrelationMatrix heatmap, a copy-TSV export (item 6's floor)
// and a server-side (matplotlib) heatmap figure export (JMP_GAP_PLAN #10
// residual, calc.figure_multivar.render_correlation_heatmap_figure — the
// SAME `r` matrix the on-screen heatmap colors), and the busy/error/too-
// few-rows states.

import { useState } from "react";

import { exportCorrelationHeatmapFigure } from "../../../lib/api";
import { copyText } from "../../../lib/clipboard";
import { SegmentedControl } from "../../primitives/SegmentedControl";
import { Button } from "../../primitives";
import { useApp } from "../../../store/useApp";
import CorrelationMatrix from "./CorrelationMatrix";
import type { CorrMethod, MultivarState } from "./useMultivar";

const METHOD_OPTIONS: { value: CorrMethod; label: string }[] = [
  { value: "pearson", label: "Pearson" },
  { value: "spearman", label: "Spearman" },
];

export default function CorrelationView({ m }: { m: MultivarState }) {
  const setStatus = useApp((s) => s.setStatus);
  const [exporting, setExporting] = useState(false);

  async function copy(): Promise<void> {
    const ok = await copyText(m.toTSV());
    setStatus(ok ? `copied ${m.labels.length}×${m.labels.length} correlation matrix to clipboard` : "clipboard unavailable");
  }

  async function exportFigure(): Promise<void> {
    if (!m.corr) return;
    setExporting(true);
    try {
      await exportCorrelationHeatmapFigure({ labels: m.labels, r: m.corr.r, filename: "correlation" });
      setStatus("exported correlation heatmap figure");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <SegmentedControl options={METHOD_OPTIONS} value={m.method} onChange={m.setMethod} />
        <div style={{ display: "flex", gap: 6 }}>
          <Button size="sm" disabled={!m.corr} onClick={() => void copy()}>
            Copy TSV
          </Button>
          <Button size="sm" disabled={!m.corr || exporting} onClick={() => void exportFigure()}>
            {exporting ? "Exporting…" : "Export figure"}
          </Button>
        </div>
      </div>

      {m.corrBusy ? (
        <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--text-faint)" }}>
          computing…
        </div>
      ) : m.corrError ? (
        <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--text-faint)" }}>
          {m.corrError}
        </div>
      ) : m.corr ? (
        <>
          <div style={{ marginTop: 10 }}>
            <CorrelationMatrix labels={m.labels} corr={m.corr} />
          </div>
          <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--text-faint)" }}>
            N = {m.corr.N} complete rows · {m.corr.method}
          </div>
        </>
      ) : null}
    </div>
  );
}
