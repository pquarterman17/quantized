// One prediction-profiler panel (JMP Prediction Profiler): predicted Y against
// ONE factor with the others held at their current settings. A continuous
// factor draws the curve with its confidence band and a draggable vertical
// line (pointer) plus a keyboard-operable slider; a nominal factor is a step
// plot (one level per column, CI whisker) with a level picker. All colours are
// design tokens.

import { type PointerEvent, useRef } from "react";

import type { FactorTrace as Trace } from "../../../lib/api/modelEvaluate";
import { fmtNum } from "../../../lib/format";
import { clamp, sliderStep } from "../../../lib/profiler";
import { Select } from "../../primitives";
import { SliderRow } from "../../primitives/SliderRow";

const W = 240;
const H = 120;
const PAD_L = 6;
const PAD_R = 6;
const PAD_T = 8;
const PAD_B = 16;
export const AVERAGE = "__average__";

interface Props {
  trace: Trace;
  /** Shared y-axis across every panel (JMP draws the traces on one scale). */
  yLo: number;
  yHi: number;
  value: number | string | null;
  currentPredicted: number | null;
  onChange: (value: number | string | null) => void;
}

export default function FactorTrace({ trace, yLo, yHi, value, currentPredicted, onChange }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const innerW = W - PAD_L - PAD_R;
  const sy = (v: number) => PAD_T + (1 - (v - yLo) / (yHi - yLo || 1)) * (H - PAD_T - PAD_B);
  const axis = { fontSize: 9, fill: "var(--text-faint)", fontFamily: "var(--font-mono)" };

  if (trace.kind === "nominal") {
    const n = trace.levels.length;
    const cx = (i: number) => PAD_L + ((i + 0.5) / n) * innerW;
    const chosen = typeof value === "string" ? trace.levels.indexOf(value) : -1;
    return (
      <figure className="qz-profiler-trace" style={{ margin: 0 }}>
        <svg role="group" aria-label={`${trace.name} step plot`} width={W} height={H} style={{ background: "var(--surface-3)" }}>
          {trace.levels.map((lv, i) => {
            const half = innerW / n / 2 - 4;
            const on = i === chosen;
            const stroke = on ? "var(--accent)" : "var(--text-faint)";
            return (
              <g key={lv} onClick={() => onChange(lv)} style={{ cursor: "default" }}>
                <rect x={cx(i) - innerW / n / 2} y={0} width={innerW / n} height={H} fill="transparent" />
                <line x1={cx(i)} x2={cx(i)} y1={sy(trace.upper[i]!)} y2={sy(trace.lower[i]!)} stroke={stroke} strokeWidth={1} />
                <line x1={cx(i) - half} x2={cx(i) + half} y1={sy(trace.predicted[i]!)} y2={sy(trace.predicted[i]!)}
                  stroke={stroke} strokeWidth={on ? 2.5 : 1.5} />
                <text x={cx(i)} y={H - 4} textAnchor="middle" {...axis}>{lv.length > 8 ? `${lv.slice(0, 7)}…` : lv}</text>
              </g>
            );
          })}
          {currentPredicted !== null && (
            <line x1={PAD_L} x2={W - PAD_R} y1={sy(currentPredicted)} y2={sy(currentPredicted)}
              stroke="var(--accent)" strokeWidth={1} strokeDasharray="4 3" />
          )}
        </svg>
        <figcaption>
          <label className="qz-k" style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
            <span>{trace.name}</span>
            <Select aria-label={`${trace.name} level`} value={typeof value === "string" ? value : AVERAGE}
              onChange={(e) => onChange(e.target.value === AVERAGE ? null : e.target.value)}
              options={[{ value: AVERAGE, label: "Average over levels" }, ...trace.levels.map((l) => ({ value: l, label: l }))]} />
          </label>
        </figcaption>
      </figure>
    );
  }

  const [lo, hi] = trace.range;
  const sx = (v: number) => PAD_L + ((v - lo) / (hi - lo || 1)) * innerW;
  const line = trace.x.map((x, i) => `${sx(x)},${sy(trace.predicted[i]!)}`).join(" ");
  // Polygon: upper edge left-to-right, then lower edge right-to-left.
  const poly = [
    ...trace.x.map((x, i) => `${sx(x)},${sy(trace.upper[i]!)}`),
    ...[...trace.x].reverse().map((x, i) => `${sx(x)},${sy(trace.lower[trace.x.length - 1 - i]!)}`),
  ].join(" ");
  const v = typeof value === "number" ? clamp(value, lo, hi) : (lo + hi) / 2;
  const fromPointer = (e: PointerEvent<SVGSVGElement>) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || !box.width) return;
    const frac = (e.clientX - box.left) / box.width * W;
    onChange(clamp(lo + ((frac - PAD_L) / innerW) * (hi - lo), lo, hi));
  };
  return (
    <figure className="qz-profiler-trace" style={{ margin: 0 }}>
      <svg ref={svgRef} role="img" aria-label={`${trace.name} prediction trace`} width={W} height={H}
        style={{ background: "var(--surface-3)", touchAction: "none", cursor: "default" }}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); fromPointer(e); }}
        onPointerMove={(e) => { if (e.buttons) fromPointer(e); }}>
        <polygon points={poly} fill="var(--accent)" fillOpacity={0.18} stroke="none" />
        <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth={1.5} />
        <line x1={sx(v)} x2={sx(v)} y1={PAD_T} y2={H - PAD_B} stroke="var(--text)" strokeWidth={1} strokeDasharray="4 3" />
        {currentPredicted !== null && <circle cx={sx(v)} cy={sy(currentPredicted)} r={3} fill="var(--accent)" />}
        <text x={PAD_L} y={H - 4} {...axis}>{fmtNum(lo)}</text>
        <text x={W - PAD_R} y={H - 4} textAnchor="end" {...axis}>{fmtNum(hi)}</text>
      </svg>
      <figcaption>
        <SliderRow label={trace.name} aria-label={`${trace.name} setting`} value={v} min={lo} max={hi}
          step={sliderStep(lo, hi)} onChange={onChange} format={(x) => fmtNum(x)} />
      </figcaption>
    </figure>
  );
}
