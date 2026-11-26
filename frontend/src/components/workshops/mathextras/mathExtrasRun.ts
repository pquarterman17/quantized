// Math extras: one run of the chosen mode. Reads its inputs, calls the route and
// returns a result card, plus (for the modes that make a worksheet) the new
// dataset for the hook to commit with provenance. Pure of React: everything it
// needs comes in through `RunCtx`, so it is unit-testable with the API mocked.

import {
  bsplineResample, correlateMaps, optimizeBox, polygonArea, scatterInterp, solveRoot, surfaceArea, traceInterp,
} from "../../../lib/api/mathExtras";
import type { DataStruct, Dataset } from "../../../lib/types";
import { pickColumns, pickLabel, pickUnit, type PickColumn } from "../analysisextras/columnPicks";
import {
  finite, fmt, inputOf, parseBounds, parseConstants, parseQueries, parseSizing, type MathForm, type MathMode, type Parsed,
} from "./mathExtrasForm";

export interface Card {
  title: string;
  rows: [string, string][];
  note?: string;
}

export interface MathOutcome {
  card: Card;
  output?: { sources: Dataset[]; name: string; data: DataStruct; settings: Record<string, unknown> };
}

export interface RunCtx {
  mode: MathMode;
  form: MathForm;
  active: Dataset | null;
  columns: PickColumn[];
  /** Column picks: X, Y (Z), value. -1 is the worksheet's X axis. */
  picks: number[];
  /** The second map of a correlation. */
  other: Dataset | null;
  /** Scatter query points read from this worksheet's columns (null: the typed ones). */
  query: { ds: Dataset; picks: number[] } | null;
  load: (id: string, picks: readonly number[]) => Promise<{ columns: number[][]; data: DataStruct }>;
  resolve: (id: string) => Promise<Dataset | null | undefined>;
  signal: AbortSignal;
}

const ok = <T>(p: Parsed<T>): T => {
  if (p.error !== undefined) throw new Error(p.error);
  return p.value;
};

const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? "" : "s"}`;

async function fullMap(c: RunCtx, d: Dataset | null, what: string): Promise<Dataset> {
  if (!d || d.data.metadata?.["is2D"] !== true) throw new Error(`Select ${what}.`);
  const full = await c.resolve(d.id);
  if (!full) throw new Error("The map is unavailable (it was removed or replaced).");
  c.signal.throwIfAborted();
  return full;
}

async function curve(c: RunCtx): Promise<{ x: number[]; y: number[]; src: Dataset; lb: Record<string, string> }> {
  const { active, picks, columns } = c;
  if (!active) throw new Error("Select a worksheet with an X column and a Y column.");
  if (picks[0] === picks[1]) throw new Error("Pick two different columns for X and Y.");
  const { columns: cols, data } = await c.load(active.id, [picks[0]!, picks[1]!]);
  c.signal.throwIfAborted();
  const lb = {
    x_label: pickLabel(columns, picks[0]!), x_unit: pickUnit(data, picks[0]!),
    y_label: pickLabel(columns, picks[1]!), y_unit: pickUnit(data, picks[1]!),
  };
  return { x: cols[0]!, y: cols[1]!, src: active, lb };
}

/** The query points read from the chosen worksheet's columns (finite rows only). */
async function sheetQueries(c: RunCtx, dims: 2 | 3): Promise<number[][]> {
  if (!c.query) throw new Error("Choose the worksheet the query points come from.");
  const picks = c.query.picks.slice(0, dims);
  if (new Set(picks).size !== picks.length) throw new Error("Pick different columns for each coordinate of the query points.");
  const { columns } = await c.load(c.query.ds.id, picks);
  c.signal.throwIfAborted();
  return Array.from({ length: columns[0]!.length }, (_, i) => columns.map((col) => col[i]!));
}

async function runScatter(c: RunCtx): Promise<MathOutcome> {
  const f = c.form;
  const dims = f.dims === "3" ? 3 : 2;
  const fromSheet = f.queriesFrom === "sheet";
  const queries = fromSheet ? await sheetQueries(c, dims) : ok(parseQueries(f.queries, dims));
  const used = c.picks.slice(0, dims + 1);
  if (!c.active) throw new Error("Select a worksheet with the scattered points.");
  if (new Set(used).size !== used.length) throw new Error("Pick different columns for each coordinate and the value.");
  const { columns: cols, data } = await c.load(c.active.id, used);
  c.signal.throwIfAborted();
  const n = cols[0]!.length;
  const points = Array.from({ length: n }, (_, i) => cols.slice(0, dims).map((col) => col[i]!));
  const values = cols[dims]!;
  const settings = {
    method: f.method, extrapolation: f.nearestFill ? "nearest" : "none", dims, queries: queries.length,
    ...(fromSheet && c.query ? { queryFrom: { id: c.query.ds.id, picks: c.query.picks.slice(0, dims), labels: c.query.picks.slice(0, dims).map((p) => pickLabel(pickColumns(c.query!.ds), p)) } } : {}),
  };
  const data3 = await scatterInterp({
    points, values, queries, method: f.method, extrapolation: settings.extrapolation as "none" | "nearest",
    coord_labels: used.slice(0, dims).map((p) => pickLabel(c.columns, p)),
    coord_units: used.slice(0, dims).map((p) => pickUnit(data, p)),
    value_label: pickLabel(c.columns, used[dims]!), value_unit: pickUnit(data, used[dims]!),
  }, c.signal);
  const meta = (data3.metadata?.["math_extras"] ?? {}) as Record<string, unknown>;
  const outside = Number(meta["outside"] ?? 0);
  return {
    card: {
      title: "Interpolated onto the chosen points",
      rows: [["Points", String(queries.length)], ["Data points used", String(meta["n_points"] ?? n)], ["Outside the data", String(outside)]],
      note: outside > 0 ? "Points outside the convex hull are blank. Tick the fill option to use the nearest value." : undefined,
    },
    output: { sources: fromSheet && c.query ? [c.active, c.query.ds] : [c.active], name: `${c.active.name} · ${dims}-D interpolation`, data: data3, settings },
  };
}

async function runCorrelate(c: RunCtx): Promise<MathOutcome> {
  const a = await fullMap(c, c.active, "a 2-D map as the first map");
  const b = await fullMap(c, c.other, "a second 2-D map");
  if (a.id === b.id) throw new Error("Pick a second map that differs from the first.");
  const onNan = c.form.blanksOk ? "zero" : "error";
  const out = await correlateMaps(a.data, b.data, onNan, c.signal);
  const peak = ((out.metadata?.["math_extras"] ?? {}) as { peak?: Record<string, number> }).peak ?? {};
  return {
    card: {
      title: "Correlation peak",
      rows: [
        ["Normalised peak", fmt(peak["value"]!)],
        ["Offset X", fmt(peak["offset_x"]!)],
        ["Offset Y", fmt(peak["offset_y"]!)],
        ["Shift in cells", `${peak["lag_x"]}, ${peak["lag_y"]}`],
      ],
      note: "Offset is what to add to the second map's coordinates to land it on the first.",
    },
    output: { sources: [a, b], name: `${a.name} ⋆ ${b.name}`, data: out, settings: { mode: "correlate", on_nan: onNan, other: b.name } },
  };
}

async function runSolve(c: RunCtx): Promise<MathOutcome> {
  const f = c.form;
  const expr = f.expr.trim();
  if (expr === "") throw new Error("Enter an expression, for example x^2 - a.");
  if (c.mode === "root") {
    const lo = ok(finite(f.lo, "the lower end of the bracket"));
    const hi = ok(finite(f.hi, "the upper end of the bracket"));
    const target = ok(finite(f.target, "the target value"));
    const r = await solveRoot({ expr, lo, hi, target, constants: ok(parseConstants(f.constants)) }, c.signal);
    return {
      card: {
        title: r.roots.length === 1 ? "Root" : `${r.roots.length} roots`,
        rows: [...r.roots.map((v, i): [string, string] => [`x${r.roots.length > 1 ? ` (${i + 1})` : ""}`, fmt(v)]), ["Largest |residual|", fmt(Math.max(...r.residuals.map(Math.abs)))]],
        note: r.poles_discarded > 0 ? `${plural(r.poles_discarded, "jump")} across a pole was ignored.` : undefined,
      },
    };
  }
  const r = await optimizeBox({ expr, bounds: ok(parseBounds(f.bounds)), sense: f.sense }, c.signal);
  return {
    card: {
      title: f.sense === "min" ? "Minimum" : "Maximum",
      rows: [
        ...r.variables.map((v, i): [string, string] => [v, fmt(r.point[i]!)]),
        ["Value", fmt(r.value)],
        ["Starts agreeing", `${r.starts_agreeing} of ${r.starts}`],
      ],
      note: [
        r.converged ? "" : "The optimiser did not report convergence.",
        r.at_bound.length > 0 ? `At the edge of the box: ${r.at_bound.join(", ")}. Widen the bounds if that is not intended.` : "",
        "A local optimiser restarted from several points, not a proof of a global optimum.",
      ].filter(Boolean).join(" "),
    },
  };
}

export async function runMath(c: RunCtx): Promise<MathOutcome> {
  const input = inputOf(c.mode);
  if (input === "none") return runSolve(c);
  if (c.mode === "scatter") return runScatter(c);
  if (c.mode === "correlate") return runCorrelate(c);
  if (c.mode === "surface-area") {
    const m = await fullMap(c, c.active, "a 2-D map");
    const r = await surfaceArea(m.data, c.form.blanksOk ? "skip" : "error", c.signal);
    return {
      card: {
        title: "Surface area",
        rows: [["Surface area", fmt(r.surface_area)], ["Projected area", fmt(r.projected_area)], ["Cells used", String(r.n_cells)], ["Cells skipped", String(r.skipped_cells)]],
        note: "Each cell is four triangles meeting at the mean of its corner heights. Areas are in axis units squared, with Z in its own unit.",
      },
    };
  }
  const cv = await curve(c);
  if (c.mode === "polygon-area") {
    const r = await polygonArea(cv.x, cv.y, c.signal);
    return {
      card: {
        title: "Enclosed area",
        rows: [["Area", fmt(r.area)], ["Signed area", fmt(r.signed_area)], ["Perimeter", fmt(r.perimeter)], ["Points", String(r.n_points)]],
        note: r.self_intersecting
          ? "The curve crosses itself, so loops partly cancel in the signed area; split it into simple loops for each area."
          : "The last point is joined back to the first by a straight edge. Positive signed area means counter-clockwise.",
      },
    };
  }
  const size = ok(parseSizing(c.form));
  if (c.mode === "trace") {
    const body = { x: cv.x, y: cv.y, ...size, ...cv.lb, kind: c.form.kind, periodic: c.form.periodic };
    const out = await traceInterp(body, c.signal);
    const total = Number(((out.metadata?.["math_extras"] ?? {}) as Record<string, unknown>)["total_length"]);
    return {
      card: { title: "Resampled by arc length", rows: [["Points", String(out.time.length)], ["Path length", fmt(total)]] },
      output: { sources: [cv.src], name: `${cv.src.name} · trace`, data: out, settings: { mode: "trace", ...size, kind: c.form.kind, periodic: c.form.periodic } },
    };
  }
  const degree = ok(finite(c.form.degree, "the degree"));
  const smoothing = ok(finite(c.form.smoothing, "the smoothing (0 = interpolate)"));
  const out = await bsplineResample({ x: cv.x, y: cv.y, ...size, ...cv.lb, degree, smoothing }, c.signal);
  const m = (out.metadata?.["math_extras"] ?? {}) as Record<string, number>;
  return {
    card: { title: "B-spline resampled", rows: [["Points", String(out.time.length)], ["Knots", String(m["n_knots"])], ["Residual sum of squares", fmt(m["residual"]!)]] },
    output: { sources: [cv.src], name: `${cv.src.name} · B-spline`, data: out, settings: { mode: "bspline", ...size, degree, smoothing } },
  };
}
