// Generated data for the sample gallery (plan item 45). Everything here is
// computed from a seeded generator, so the gallery ships no data files, copies
// nothing from the private test corpus, and every open yields the same numbers.
// Pure: DataStruct in the app's contract, no store, no React.

import type { DataStruct } from "../types";

/** A small deterministic generator (mulberry32), uniform in [0, 1). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal deviates from `rand` (Box-Muller). */
export function normal(rand: () => number): () => number {
  return () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}

const round = (v: number, digits = 6): number => Number(v.toFixed(digits));

/** Signal decaying with time, symbols with a per-point uncertainty. */
export function decayWithErrors(): DataStruct {
  const g = normal(seeded(11));
  const time: number[] = [];
  const values: number[][] = [];
  for (let i = 0; i < 24; i++) {
    const t = i * 0.5;
    const truth = 4.2 * Math.exp(-t / 3.2) + 0.3;
    const sigma = 0.06 + 0.03 * truth;
    time.push(t);
    values.push([round(truth + sigma * g()), round(sigma)]);
  }
  return { time, values, labels: ["Signal", "Signal err"], units: ["V", "V"], metadata: { x_column_name: "Time", x_column_unit: "s", source: "sample" } };
}

/** Three groups of a measured value, long form: a categorical Group channel and a Value channel. */
export function groupsCompared(): DataStruct {
  const g = normal(seeded(23));
  const centres = [10.0, 12.5, 11.2];
  const spreads = [1.1, 1.8, 0.8];
  const time: number[] = [];
  const values: number[][] = [];
  for (let k = 0; k < centres.length; k++) {
    for (let i = 0; i < 30; i++) {
      time.push(time.length + 1);
      values.push([k, round(centres[k]! + spreads[k]! * g(), 4)]);
    }
  }
  return {
    time, values, labels: ["Group", "Response"], units: ["", "mV"],
    metadata: { x_column_name: "Run", x_column_unit: "", source: "sample" },
    cat_levels: { 0: ["Control", "Dose A", "Dose B"] },
  };
}

/** A gridded x, y, intensity map (row-major, y fastest) flagged as a 2-D map. */
function grid(n: number, f: (x: number, y: number) => number, labels: [string, string, string], units: [string, string, string], lo: number, hi: number): DataStruct {
  const time: number[] = [];
  const values: number[][] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = lo + ((hi - lo) * i) / (n - 1);
      const y = lo + ((hi - lo) * j) / (n - 1);
      time.push(time.length);
      values.push([round(x), round(y), round(f(x, y))]);
    }
  }
  return { time, values, labels: [...labels], units: [...units], metadata: { is2D: true, axis1_name: labels[0], map_shape: [n, n], source: "sample" } };
}

/** Two Gaussian peaks on a shallow background: a heatmap. */
export function intensityMap(): DataStruct {
  const peak = (x: number, y: number, cx: number, cy: number, w: number, a: number) => a * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * w * w));
  return grid(25, (x, y) => 40 + peak(x, y, -1.2, -0.8, 0.9, 900) + peak(x, y, 1.5, 1.1, 0.6, 450), ["Qx", "Qz", "Intensity"], ["1/nm", "1/nm", "counts"], -4, 4);
}

/** A radial ripple, the classic surface test shape (sinc of the radius). */
export function rippleSurface(): DataStruct {
  return grid(31, (x, y) => { const r = Math.hypot(x, y) * 2.2; return r === 0 ? 1 : Math.sin(r) / r; }, ["X", "Y", "Height"], ["mm", "mm", "mm"], -5, 5);
}

/** Least-squares quadratic through (x, y): the coefficients [c0, c1, c2] from the normal equations. */
export function quadraticFit(x: readonly number[], y: readonly number[]): [number, number, number] {
  const s = (p: number, q = 0) => x.reduce((a, xi, i) => a + xi ** p * y[i]! ** q, 0);
  const m = [
    [s(0), s(1), s(2), s(0, 1)],
    [s(1), s(2), s(3), s(1, 1)],
    [s(2), s(3), s(4), s(2, 1)],
  ];
  for (let c = 0; c < 3; c++) {
    let piv = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[piv]![c]!)) piv = r;
    [m[c], m[piv]] = [m[piv]!, m[c]!];
    for (let r = c + 1; r < 3; r++) {
      const f = m[r]![c]! / m[c]![c]!;
      for (let k = c; k < 4; k++) m[r]![k]! -= f * m[c]![k]!;
    }
  }
  const out: [number, number, number] = [0, 0, 0];
  for (let r = 2; r >= 0; r--) {
    let v = m[r]![3]!;
    for (let k = r + 1; k < 3; k++) v -= m[r]![k]! * out[k]!;
    out[r] = v / m[r]![r]!;
  }
  return out;
}

/** A noisy calibration curve, its least-squares quadratic fit and the residuals (data minus fit). */
export function fitWithResiduals(): DataStruct {
  const g = normal(seeded(5));
  const x = Array.from({ length: 30 }, (_, i) => round(i * 0.4, 3));
  const y = x.map((xi) => round(0.8 + 1.1 * xi - 0.045 * xi * xi + 0.12 * g(), 5));
  const [c0, c1, c2] = quadraticFit(x, y);
  const fit = x.map((xi) => c0 + c1 * xi + c2 * xi * xi);
  return {
    time: x,
    values: y.map((yi, i) => [yi, round(fit[i]!, 6), round(yi - fit[i]!, 6)]),
    labels: ["Response", "Quadratic fit", "Residual"],
    units: ["a.u.", "a.u.", "a.u."],
    metadata: { x_column_name: "Concentration", x_column_unit: "mM", source: "sample" },
  };
}

/** Compositions summing to 100 wt% with a property that varies smoothly across the triangle. */
export function ternaryComposition(): DataStruct {
  const g = normal(seeded(41));
  const time: number[] = [];
  const values: number[][] = [];
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; i + j <= steps; j++) {
      const a = (100 * i) / steps;
      const b = (100 * j) / steps;
      const c = 100 - a - b;
      const z = 180 + 1.4 * a + 0.6 * b - 0.5 * c + 0.012 * a * b + 3 * g();
      time.push(time.length + 1);
      values.push([round(a, 3), round(b, 3), round(c, 3), round(z, 3)]);
    }
  }
  return { time, values, labels: ["A", "B", "C", "Hardness"], units: ["wt%", "wt%", "wt%", "HV"], metadata: { x_column_name: "Sample", x_column_unit: "", source: "sample" } };
}
