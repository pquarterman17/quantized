// Multivariate workbench (JMP_GAP J10) — PCA view: scree (explained +
// cumulative variance), a scores scatter over any two selectable PCs, and a
// loadings/biplot toggle. Thin — the fetch + standardize option live in
// useMultivar; this composes PcaScree (DOM bars) + PcaScoresCanvas (pure
// canvas render) over the already-fetched `/api/stats/pca` response. Both
// the scree and the scores/loadings/biplot panel export server-side
// (matplotlib) figures (JMP_GAP_PLAN #10 residual,
// calc.figure_multivar.render_pca_figure/render_pca_scree_figure) reading
// the SAME `drawData`/`pca` numbers the canvas draws.

import { useMemo, useState } from "react";

import { exportPcaFigure, exportPcaScreeFigure } from "../../../lib/api";
import { fmtNum } from "../../../lib/format";
import { SegmentedControl } from "../../primitives/SegmentedControl";
import { Switch } from "../../primitives/Switch";
import { Button, Select } from "../../primitives";
import { useApp } from "../../../store/useApp";
import type { PcaDrawData } from "./pcaScoresRender";
import PcaScoresCanvas from "./PcaScoresCanvas";
import PcaScree from "./PcaScree";
import type { MultivarState } from "./useMultivar";

type Mode = "scores" | "loadings" | "biplot";
const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: "scores", label: "Scores" },
  { value: "loadings", label: "Loadings" },
  { value: "biplot", label: "Biplot" },
];

export default function PcaView({ m }: { m: MultivarState }) {
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const setStatus = useApp((s) => s.setStatus);
  const [mode, setMode] = useState<Mode>("scores");
  const [exporting, setExporting] = useState<"scree" | "panel" | null>(null);

  const pca = m.pca;
  const k = pca?.explained.length ?? 0;

  const drawData = useMemo<PcaDrawData | null>(() => {
    if (!pca || k < 2) return null;
    const showPoints = mode !== "loadings";
    const showVectors = mode !== "scores";
    return {
      points: showPoints ? pca.score.map((row) => [row[m.pcX] ?? 0, row[m.pcY] ?? 0] as [number, number]) : [],
      vectors: showVectors
        ? m.labels.map((label, j) => ({ x: pca.coeff[j]?.[m.pcX] ?? 0, y: pca.coeff[j]?.[m.pcY] ?? 0, label }))
        : [],
      xLabel: `PC${m.pcX + 1} (${fmtNum(pca.explained[m.pcX])}%)`,
      yLabel: `PC${m.pcY + 1} (${fmtNum(pca.explained[m.pcY])}%)`,
    };
  }, [pca, k, mode, m.pcX, m.pcY, m.labels]);

  async function exportScree(): Promise<void> {
    if (!pca) return;
    setExporting("scree");
    try {
      await exportPcaScreeFigure({ explained: pca.explained, cumulative: pca.cumulative });
      setStatus("exported PCA scree figure");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "export failed");
    } finally {
      setExporting(null);
    }
  }

  async function exportPanel(): Promise<void> {
    if (!drawData) return;
    setExporting("panel");
    try {
      await exportPcaFigure({
        mode,
        points: drawData.points,
        vectors: drawData.vectors,
        x_label: drawData.xLabel,
        y_label: drawData.yLabel,
        filename: `pca-${mode}`,
      });
      setStatus(`exported PCA ${mode} figure`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "export failed");
    } finally {
      setExporting(null);
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <label className="qzk-field-lbl" style={{ margin: 0 }}>
          Principal component analysis
        </label>
        <Switch checked={m.standardize} onChange={m.setStandardize} label="Standardize" />
      </div>

      {m.pcaBusy ? (
        <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--text-faint)" }}>
          computing…
        </div>
      ) : m.pcaError ? (
        <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--text-faint)" }}>
          {m.pcaError}
        </div>
      ) : pca ? (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 6 }}>
            <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
              scree — explained variance (click = X axis, shift-click = Y axis)
            </div>
            <Button size="sm" disabled={exporting !== null} onClick={() => void exportScree()}>
              {exporting === "scree" ? "Exporting…" : "Export scree"}
            </Button>
          </div>
          <PcaScree
            explained={pca.explained}
            cumulative={pca.cumulative}
            pcX={m.pcX}
            pcY={m.pcY}
            onPick={(i, asY) => (asY ? m.setPcY(i) : m.setPcX(i))}
          />

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
            <Select
              options={pca.explained.map((_, i) => ({ value: String(i), label: `X: PC${i + 1}` }))}
              value={String(m.pcX)}
              onChange={(e) => m.setPcX(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <Select
              options={pca.explained.map((_, i) => ({ value: String(i), label: `Y: PC${i + 1}` }))}
              value={String(m.pcY)}
              onChange={(e) => m.setPcY(Number(e.target.value))}
              style={{ flex: 1 }}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 8 }}>
            <SegmentedControl options={MODE_OPTIONS} value={mode} onChange={setMode} />
            <Button size="sm" disabled={!drawData || exporting !== null} onClick={() => void exportPanel()}>
              {exporting === "panel" ? "Exporting…" : "Export figure"}
            </Button>
          </div>

          <PcaScoresCanvas data={drawData} theme={theme} accent={accent} />
        </>
      ) : null}
    </div>
  );
}
