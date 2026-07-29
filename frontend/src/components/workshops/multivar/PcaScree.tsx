// Multivariate workbench (JMP_GAP J10) — PCA scree: DOM bars for percent
// explained variance per component, with the cumulative curve as a dotted
// baseline + numeric readout (HistogramStrip's "DOM not canvas, so the whole
// panel is testable" precedent — a scree is a handful of bars, not worth a
// canvas). Clicking a bar picks it as the X or Y axis for the scores plot
// (shift-click = Y), mirroring PC-picker conventions elsewhere in the app.

import { fmtNum } from "../../../lib/format";

export interface PcaScreeProps {
  explained: number[];
  cumulative: number[];
  pcX: number;
  pcY: number;
  onPick: (index: number, asY: boolean) => void;
}

export default function PcaScree({ explained, cumulative, pcX, pcY, onPick }: PcaScreeProps) {
  const maxPct = Math.max(1, ...explained);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 90, marginTop: 8 }}>
      {explained.map((pct, i) => {
        const isX = i === pcX;
        const isY = i === pcY;
        return (
          <button
            key={i}
            type="button"
            title={`PC${i + 1}: ${fmtNum(pct)}% (cumulative ${fmtNum(cumulative[i])}%) — click = X axis, shift-click = Y axis`}
            onClick={(e) => onPick(i, e.shiftKey)}
            style={{
              flex: "1 1 0",
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
              alignItems: "center",
              background: "none",
              border: "none",
              cursor: "default",
              padding: 0,
              minWidth: 10,
            }}
          >
            <span
              style={{
                width: "100%",
                height: Math.max(2, (pct / maxPct) * 64),
                background: isX || isY ? "var(--accent)" : "var(--series-1)",
                opacity: isX || isY ? 1 : 0.55,
                borderRadius: "2px 2px 0 0",
                outline: isX ? "1px solid var(--accent-text)" : isY ? "1px dashed var(--accent-text)" : "none",
              }}
            />
            <span style={{ fontSize: 9, color: "var(--text-faint)", marginTop: 2 }}>PC{i + 1}</span>
          </button>
        );
      })}
    </div>
  );
}
