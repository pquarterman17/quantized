// Panel inset content (#15): the three kinds a box can show. The "dataset"
// kind is a small hand-rolled SVG line chart (see PanelInsetBox's doc for
// why it is not a second uPlot instance) -- a non-interactive preview of a
// FROZEN snapshot, close enough to the matplotlib export
// (`calc/figure_panel_insets.py`'s `_draw_dataset_inset`) for WYSIWYG intent
// without duplicating its axis/scale machinery pixel-for-pixel.

import type { PanelInsetContent } from "../../lib/panelInset";

const PALETTE = ["#1f77b4", "#d62728", "#2ca02c", "#9467bd", "#ff7f0e", "#17becf"];

function scaledPoints(x: number[], series: { y: number[] }[], scale: "linear" | "log" | undefined) {
  const log = scale === "log";
  const xs = x.filter((v) => Number.isFinite(v));
  const ys = series.flatMap((s) => s.y).filter((v) => Number.isFinite(v) && (!log || v > 0));
  const xLo = Math.min(...xs);
  const xHi = Math.max(...xs);
  const yLo = log ? Math.min(...ys) : Math.min(0, ...ys);
  const yHi = Math.max(...ys);
  const tx = (v: number) => (xHi > xLo ? ((v - xLo) / (xHi - xLo)) * 100 : 50);
  const ty = (v: number) => {
    const lv = log ? Math.log10(v) : v;
    const lo = log ? Math.log10(yLo) : yLo;
    const hi = log ? Math.log10(yHi) : yHi;
    return hi > lo ? 100 - ((lv - lo) / (hi - lo)) * 100 : 50;
  };
  return { tx, ty, log };
}

function DatasetChart({ content }: { content: PanelInsetContent & { kind: "dataset" } }) {
  const { tx, ty, log } = scaledPoints(content.x, content.series, content.yScale);
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      {content.title && (
        <div style={{ fontSize: 10, textAlign: "center", color: "var(--text)", padding: "1px 2px" }}>
          {content.title}
        </div>
      )}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ flex: 1, minHeight: 0 }}>
        <rect x={0} y={0} width={100} height={100} fill="none" stroke="var(--border)" strokeWidth={0.5} />
        {content.series.map((s, i) => {
          const pts = content.x
            .map((xv, j) => (log && s.y[j] <= 0 ? null : `${tx(xv)},${ty(s.y[j])}`))
            .filter((v): v is string => v != null)
            .join(" ");
          return (
            <polyline
              key={i}
              points={pts}
              fill="none"
              stroke={s.color || PALETTE[i % PALETTE.length]}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>
      {content.legend && (
        <div style={{ position: "absolute", top: content.title ? 12 : 2, right: 2, fontSize: 8, lineHeight: 1.3 }}>
          {content.series.map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 2 }}>
              <span
                style={{ width: 6, height: 6, background: s.color || PALETTE[i % PALETTE.length], display: "inline-block" }}
              />
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ImageContentView({ content }: { content: PanelInsetContent & { kind: "image" } }) {
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      {content.title && (
        <div style={{ fontSize: 10, textAlign: "center", color: "var(--text)", padding: "1px 2px" }}>
          {content.title}
        </div>
      )}
      <img
        src={content.dataUrl}
        alt={content.title || "panel inset image"}
        style={{ flex: 1, minHeight: 0, width: "100%", objectFit: "contain" }}
      />
    </div>
  );
}

function TableContentView({ content }: { content: PanelInsetContent & { kind: "table" } }) {
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", overflow: "auto" }}>
      {content.title && (
        <div style={{ fontSize: 10, textAlign: "center", color: "var(--text)", padding: "1px 2px" }}>
          {content.title}
        </div>
      )}
      <table style={{ fontSize: 9, width: "100%", borderCollapse: "collapse" }}>
        {content.headers && (
          <thead>
            <tr>
              {content.headers.map((h, i) => (
                <th key={i} style={{ border: "1px solid var(--border)", padding: "1px 3px" }}>{h}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {content.rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} style={{ border: "1px solid var(--border)", padding: "1px 3px", textAlign: "center" }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PanelInsetContentView({ content }: { content: PanelInsetContent }) {
  if (content.kind === "dataset") return <DatasetChart content={content} />;
  if (content.kind === "image") return <ImageContentView content={content} />;
  return <TableContentView content={content} />;
}
