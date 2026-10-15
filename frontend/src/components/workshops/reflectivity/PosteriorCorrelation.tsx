import { useMemo, useRef, useState } from "react";

import { exportCorrelationHeatmapFigure } from "../../../lib/api";
import { copyText } from "../../../lib/clipboard";
import { cellInk, diverging } from "../../../lib/divergingColormap";
import { fmtNum } from "../../../lib/format";
import { correlationToTSV } from "../../../lib/multivar";
import { runCancellable } from "../../../store/pendingOpActions";
import { useApp } from "../../../store/useApp";
import { Button } from "../../primitives";
import type { SavedPosterior } from "./reflPosterior";
import {
  POSTERIOR_CORRELATION_GRID_LIMIT,
  POSTERIOR_CORRELATION_THRESHOLD,
  posteriorCorrelationDiagnostic,
} from "./reflPosteriorCorrelation";

const MONO = { fontFamily: "var(--font-mono)" } as const;

export default function PosteriorCorrelation({ posterior }: { posterior: SavedPosterior }) {
  const setStatus = useApp((state) => state.setStatus);
  const [exporting, setExporting] = useState(false);
  const exportingRef = useRef(false);
  const diagnostic = useMemo(() => posteriorCorrelationDiagnostic(posterior), [posterior]);
  if (diagnostic.issue) return <div className="qzk-ds-meta" role="note">{diagnostic.issue}</div>;
  const strongest = diagnostic.pairs[0];
  const strong = diagnostic.pairs.filter((pair) => Math.abs(pair.r) >= POSTERIOR_CORRELATION_THRESHOLD);

  const copy = async (): Promise<void> => {
    const copied = await copyText(correlationToTSV(diagnostic.labels, diagnostic.matrix));
    setStatus(copied ? "copied posterior correlation matrix" : "clipboard unavailable");
  };
  const exportFigure = async (): Promise<void> => {
    if (exportingRef.current) return;
    exportingRef.current = true;
    setExporting(true);
    try {
      const done = await runCancellable("Exporting posterior correlation heatmap…", (signal) =>
        exportCorrelationHeatmapFigure({ labels: diagnostic.labels, r: diagnostic.matrix,
          title: "Reflectivity posterior parameter correlation", filename: "reflectivity_posterior_correlation" }, signal));
      setStatus(done ? "exported posterior correlation heatmap" : "export cancelled");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "posterior correlation export failed");
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  };

  return <details>
    <summary className="qzk-field-lbl" style={{ cursor: "pointer" }}>
      Parameter correlation · {strongest ? `strongest |r| ${Math.abs(strongest.r).toFixed(2)}` : "no finite pairs"}
    </summary>
    <p className="qzk-ds-meta">
      Large |r| means the posterior lets two parameters trade off; it is a model-identifiability warning, not evidence that one parameter causes the other.
    </p>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
      <Button size="sm" onClick={() => void copy()}>Copy matrix</Button>
      <Button size="sm" disabled={exporting} onClick={() => void exportFigure()}>
        {exporting ? "Exporting…" : "Export heatmap"}
      </Button>
    </div>
    {diagnostic.labels.length <= POSTERIOR_CORRELATION_GRID_LIMIT ? <div style={{ overflow: "auto", maxHeight: 420 }}>
      <div role="table" aria-label="posterior parameter correlation" style={{
        display: "grid", minWidth: Math.max(360, diagnostic.labels.length * 52 + 150),
        gridTemplateColumns: `minmax(120px, auto) repeat(${diagnostic.labels.length}, minmax(48px, 1fr))`,
        gap: 1, fontSize: 10, fontVariantNumeric: "tabular-nums",
      }}>
        <div />
        {diagnostic.labels.map((label) => <div key={`head-${label}`} role="columnheader" title={label}
          style={{ overflow: "hidden", textOverflow: "ellipsis", textAlign: "center", padding: 2 }}>{label}</div>)}
        {diagnostic.labels.map((rowLabel, row) => <div key={`row-${rowLabel}`} role="row" style={{ display: "contents" }}>
          <div role="rowheader" title={rowLabel} style={{ overflow: "hidden", textOverflow: "ellipsis", textAlign: "right", padding: "3px 5px" }}>{rowLabel}</div>
          {diagnostic.labels.map((columnLabel, column) => {
            const r = diagnostic.matrix[row][column];
            const rgb = r === null ? null : diverging(r);
            return <div key={`${rowLabel}-${columnLabel}`} role="cell"
              title={`${rowLabel} × ${columnLabel}: r=${fmtNum(r)}`} style={{
                background: rgb ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` : "var(--surface-2)",
                color: rgb ? cellInk(rgb) : "var(--text-faint)", textAlign: "center", padding: "3px 2px", borderRadius: 2,
              }}>{fmtNum(r)}</div>;
          })}
        </div>)}
      </div>
    </div> : <p className="qzk-ds-meta" role="note">
      The {diagnostic.labels.length} × {diagnostic.labels.length} matrix is too large for a useful inline grid. Copy or export the complete matrix instead.
    </p>}
    <div style={{ marginTop: 8 }}>
      <div className="qzk-ds-meta">Strong trade-offs (|r| ≥ {POSTERIOR_CORRELATION_THRESHOLD})</div>
      {strong.length ? <div role="table" aria-label="strong posterior correlations">
        {strong.slice(0, 12).map((pair) => <div role="row" key={`${pair.first}-${pair.second}`}
          style={{ display: "grid", gridTemplateColumns: "1fr 22px 1fr 64px", gap: 6, fontSize: "var(--font-size-sm)" }}>
          <span role="cell" style={MONO}>{pair.first}</span><span role="cell">↔</span>
          <span role="cell" style={MONO}>{pair.second}</span><span role="cell" style={MONO}>{fmtNum(pair.r)}</span>
        </div>)}
        {strong.length > 12 && <div className="qzk-ds-meta">{strong.length - 12} additional strong pairs are included in Copy/Export.</div>}
      </div> : <p className="qzk-ds-meta">No finite off-diagonal pair reaches the warning threshold.</p>}
    </div>
  </details>;
}
