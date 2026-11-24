// Contour profiler (JMP Contour Profiler): the predicted response over two
// CONTINUOUS factors, every other factor held at its current setting. Filled
// cells carry the response (accent opacity), contour lines mark evenly spaced
// levels, and an optional user-set response limit shades the region that
// violates it. Click or drag sets both factors' current settings. Colours are
// design tokens.

import { type PointerEvent, type ReactElement, useRef, useState } from "react";

import type { ProfilerModel, ProfilerSettings } from "../../../lib/api/modelEvaluate";
import { fmtNum } from "../../../lib/format";
import { clamp, contourLevels, contourSegments, outsideLimits, type ProfilerFactor } from "../../../lib/profiler";
import { Select } from "../../primitives";
import BufferedNumberField from "../../primitives/BufferedNumberField";
import { useContour } from "./useContour";

const W = 300;
const H = 240;
const PAD = 26;

interface Props {
  model: ProfilerModel;
  factors: ProfilerFactor[];
  settings: ProfilerSettings;
  onSet: (name: string, value: number) => void;
}

export default function ContourProfile({ model, factors, settings, onSet }: Props) {
  const cont = factors.filter((f) => f.kind === "continuous" && f.range);
  const [xName, setX] = useState(cont[0]?.name ?? "");
  const [yName, setY] = useState(cont[1]?.name ?? "");
  const [lower, setLower] = useState<number | null>(null);
  const [upper, setUpper] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { grid, error } = useContour(model, settings, xName, yName, cont.length >= 2);
  if (cont.length < 2) {
    return <p className="qzk-ds-meta">The contour profiler needs at least two continuous factors in the model.</p>;
  }
  const xf = cont.find((f) => f.name === xName)!;
  const yf = cont.find((f) => f.name === yName);
  const opts = cont.map((f) => ({ value: f.name, label: f.name }));
  const pick = (which: "x" | "y", name: string) => {
    if (which === "x") { setX(name); if (name === yName) setY(cont.find((f) => f.name !== name)!.name); }
    else { setY(name); if (name === xName) setX(cont.find((f) => f.name !== name)!.name); }
  };
  const body = (() => {
    if (!yf) return null;
    const [x0, x1] = xf.range!;
    const [y0, y1] = yf.range!;
    const sx = (v: number) => PAD + ((v - x0) / (x1 - x0)) * (W - 2 * PAD);
    const sy = (v: number) => H - PAD - ((v - y0) / (y1 - y0)) * (H - 2 * PAD);
    const curX = typeof settings[xName] === "number" ? settings[xName] : (x0 + x1) / 2;
    const curY = typeof settings[yName] === "number" ? settings[yName] : (y0 + y1) / 2;
    const fromPointer = (e: PointerEvent<SVGSVGElement>) => {
      const box = svgRef.current?.getBoundingClientRect();
      if (!box?.width) return;
      const px = ((e.clientX - box.left) / box.width) * W;
      const py = ((e.clientY - box.top) / box.height) * H;
      onSet(xName, clamp(x0 + ((px - PAD) / (W - 2 * PAD)) * (x1 - x0), x0, x1));
      onSet(yName, clamp(y0 + ((H - PAD - py) / (H - 2 * PAD)) * (y1 - y0), y0, y1));
    };
    let zLo = Infinity, zHi = -Infinity;
    if (grid) for (const row of grid.z) for (const v of row) { zLo = Math.min(zLo, v); zHi = Math.max(zHi, v); }
    const cells: ReactElement[] = [];
    const lines: ReactElement[] = [];
    if (grid) {
      const cw = (W - 2 * PAD) / (grid.x.length - 1), ch = (H - 2 * PAD) / (grid.y.length - 1);
      grid.z.forEach((row, j) => row.forEach((v, i) => {
        const bad = outsideLimits(v, lower, upper);
        cells.push(<rect key={`${i}-${j}`} x={sx(grid.x[i]!) - cw / 2} y={sy(grid.y[j]!) - ch / 2} width={cw + 0.5} height={ch + 0.5}
          fill={bad ? "var(--warn)" : "var(--accent)"} fillOpacity={bad ? 0.5 : 0.06 + 0.4 * ((v - zLo) / (zHi - zLo || 1))} />);
      }));
      const draw = (level: number, stroke: string, width: number, key: string) => contourSegments(grid.x, grid.y, grid.z, level)
        .forEach((s, k) => lines.push(<line key={`${key}-${k}`} x1={sx(s.x1)} y1={sy(s.y1)} x2={sx(s.x2)} y2={sy(s.y2)} stroke={stroke} strokeWidth={width} />));
      contourLevels(grid.z).forEach((lv) => draw(lv, "var(--text-faint)", 0.8, `l${lv}`));
      if (lower !== null) draw(lower, "var(--warn)", 1.8, "lo");
      if (upper !== null) draw(upper, "var(--warn)", 1.8, "hi");
    }
    const label = { fontSize: 9, fill: "var(--text-faint)", fontFamily: "var(--font-mono)" };
    return (
      <svg ref={svgRef} role="img" aria-label={`${model.response} contour over ${xName} and ${yName}`} width={W} height={H}
        style={{ background: "var(--surface-3)", touchAction: "none", cursor: "default" }}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); fromPointer(e); }}
        onPointerMove={(e) => { if (e.buttons) fromPointer(e); }}>
        {cells}{lines}
        <line x1={sx(curX)} x2={sx(curX)} y1={PAD} y2={H - PAD} stroke="var(--text)" strokeDasharray="4 3" />
        <line x1={PAD} x2={W - PAD} y1={sy(curY)} y2={sy(curY)} stroke="var(--text)" strokeDasharray="4 3" />
        <circle cx={sx(curX)} cy={sy(curY)} r={3.5} fill="var(--accent)" stroke="var(--text)" />
        <text x={PAD} y={H - 8} {...label}>{fmtNum(x0)}</text>
        <text x={W - PAD} y={H - 8} textAnchor="end" {...label}>{fmtNum(x1)}</text>
        <text x={2} y={H - PAD} {...label}>{fmtNum(y0)}</text>
        <text x={2} y={PAD + 4} {...label}>{fmtNum(y1)}</text>
      </svg>
    );
  })();
  return (
    <div className="qz-profiler-contour">
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <label className="qz-k">X <Select aria-label="Contour X factor" value={xName} options={opts} onChange={(e) => pick("x", e.target.value)} /></label>
        <label className="qz-k">Y <Select aria-label="Contour Y factor" value={yName} options={opts} onChange={(e) => pick("y", e.target.value)} /></label>
      </div>
      {body}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
        <span className="qz-k">Response limits</span>
        <label className="qz-k">Lower
          <BufferedNumberField aria-label="Response lower limit" value={lower ?? undefined} width={72}
            onValue={(v) => setLower(v ?? null)} /></label>
        <label className="qz-k">Upper
          <BufferedNumberField aria-label="Response upper limit" value={upper ?? undefined} width={72}
            onValue={(v) => setUpper(v ?? null)} /></label>
      </div>
      <p className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
        {grid ? `${model.response} ${fmtNum(Math.min(...grid.z.flat()))} to ${fmtNum(Math.max(...grid.z.flat()))}. ` : ""}
        Click or drag to set both factors; shaded cells violate a limit.
      </p>
      {error && <div role="alert" className="qzk-ds-meta" style={{ color: "var(--warn)" }}>{error}</div>}
    </div>
  );
}
