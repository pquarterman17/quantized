// Reflectivity workshop — graded (spline) layers. Pure: a graded film layer is
// an SLD(z) profile through knots (evenly spaced unless given fractional
// positions), optionally with an absorption knot each, which the backend
// (POST /api/reflectivity/spline-sld: calc.sld.spline_sld + profile_to_layers)
// cuts into thin slabs. `expandGraded` splices those slabs into the stack the
// Model mode sends to /simulate and /sld-profile. The fit sends the same layer
// as a `graded` spec (`gradedSpecs`) whose knots are fit parameters;
// calc/refl_graded.py cuts it into the same slabs.

import { reflSplineSld, type ReflLayer, type SplineMethod } from "../../../lib/api/reflectivity";
import type { ModelLayer } from "./useReflectivity";

/** A graded layer: SLD knots (Å⁻², top → bottom) and the interpolation
 *  between them. `isld`: one absorption knot per SLD knot (Å⁻², POSITIVE =
 *  absorption), or absent for none. `positions`: the knots' depths as
 *  fractions of the thickness (0 = top, 1 = bottom), or absent for evenly
 *  spaced. calc/refl_graded.py's rules apply (`gradedProblem`). */
export interface GradedProfile {
  knots: number[];
  method: SplineMethod;
  isld?: number[];
  positions?: number[];
}

export const SPLINE_METHODS: SplineMethod[] = ["pchip", "spline", "makima", "linear"];

/** Knots are typed in units of 10⁻⁶ Å⁻², the usual scale for SLDs. */
const KNOT_UNIT = 1e-6;

/** About 2 Å per slab, clamped to 4..200 slabs (each is one Parratt layer). */
export function gradedSlices(thickness: number): number {
  return Math.min(200, Math.max(4, Math.ceil(thickness / 2)));
}

/** Parse "2, 3.5 4" (10⁻⁶ Å⁻²) into SLDs in Å⁻²; null unless ≥ 2 finite numbers. */
export function parseKnots(text: string): number[] | null {
  const parts = text.split(/[\s,;]+/).filter((p) => p !== "");
  if (parts.length < 2) return null;
  const vals = parts.map(Number);
  if (!vals.every(Number.isFinite)) return null;
  return vals.map((v) => Number((v * KNOT_UNIT).toPrecision(12)));
}

/** The editable text for knots in Å⁻² (shown in 10⁻⁶ Å⁻²). */
export function formatKnots(knots: number[]): string {
  return knots.map((k) => String(Number((k / KNOT_UNIT).toPrecision(6)))).join(", ");
}

/** Parse fractional knot positions: undefined when blank (evenly spaced),
 *  null when any entry is not a number. */
export function parsePositions(text: string): number[] | null | undefined {
  const parts = text.split(/[\s,;]+/).filter((p) => p !== "");
  if (parts.length === 0) return undefined;
  const vals = parts.map(Number);
  return vals.every(Number.isFinite) ? vals : null;
}

/** The editable text for positions; blank when evenly spaced. */
export function formatPositions(positions: number[] | undefined): string {
  return (positions ?? []).map((p) => String(Number(p.toPrecision(6)))).join(", ");
}

/** Why calc/refl_graded.py would refuse this profile, or null. */
export function gradedProblem(layer: number, g: GradedProfile): string | null {
  const k = g.knots.length;
  if (g.isld && g.isld.length !== k) return `Layer ${layer} needs an absorption value for every knot or for none.`;
  const p = g.positions;
  if (!p) return null;
  if (p.length !== k) return `Layer ${layer} needs one knot position per knot (${k}).`;
  if (!p.every((x) => x >= 0 && x <= 1)) return `Layer ${layer}'s knot positions must lie within 0 to 1.`;
  if (p.some((x, j) => j > 0 && !(x > p[j - 1]))) return `Layer ${layer}'s knot positions must be strictly increasing.`;
  return null;
}

function linspace(lo: number, hi: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => (n === 1 ? lo : lo + ((hi - lo) * i) / (n - 1)));
}

type SplineFetch = typeof reflSplineSld;

/** Replace each graded film layer in `rows` (the API stack, row-aligned with
 *  `layers`) with its microslabs. The first slab keeps the layer's roughness
 *  (the interface above it); the slabs' absorption is the interpolated isld
 *  knots, or none (the fit sends no `L{i}.isld` for a graded layer). A
 *  slab-only stack comes back unchanged without a request. */
export async function expandGraded(
  rows: ReflLayer[],
  layers: ModelLayer[],
  fetchSpline?: SplineFetch,
): Promise<ReflLayer[]> {
  const last = layers.length - 1;
  const isGraded = (l: ModelLayer, i: number) => l.graded != null && i > 0 && i < last;
  if (!layers.some(isGraded)) return rows;
  const fetch = fetchSpline ?? reflSplineSld;
  const parts = await Promise.all(
    rows.map(async (row, i): Promise<ReflLayer[]> => {
      const g = layers[i].graded;
      if (!g || !isGraded(layers[i], i)) return [row];
      const t = layers[i].thickness;
      if (!(t > 0)) throw new Error(`Layer ${i} is graded and needs a thickness above 0 Å.`);
      const problem = gradedProblem(i, g);
      if (problem) throw new Error(problem);
      const z = g.positions ? g.positions.map((p) => p * t) : linspace(0, t, g.knots.length);
      const profile = (knots: number[]) =>
        fetch({ z_knots: z, sld_knots: knots, method: g.method, z_range: [0, t], n_points: gradedSlices(t) + 1 });
      // The absorption knots go through the same interpolation onto the same slabs.
      const [res, abs] = await Promise.all([profile(g.knots), g.isld ? profile(g.isld) : undefined]);
      return res.layers.slice(1, -1).map((s, j): ReflLayer => [
        s[0] ?? 0,
        s[1] ?? Number.NaN,
        abs ? (abs.layers[j + 1]?.[1] ?? Number.NaN) : 0,
        j === 0 ? row[3] : 0,
      ]);
    }),
  );
  return parts.flat();
}

/** A graded layer as the fit request names it (`ReflGradedLayer` on the wire):
 *  its knots are `L{layer}.knot{j}.sld` (and `.isld`) parameters at FIXED
 *  `positions` (absent: evenly spaced), cut into the slab count the Model
 *  mode simulates with. */
export interface GradedFitSpec {
  layer: number;
  method: SplineMethod;
  slices: number;
  positions?: number[];
}

const gradedFilm = (l: ModelLayer, i: number, n: number): GradedProfile | undefined =>
  i > 0 && i < n - 1 ? l.graded : undefined;

/** The request's `graded` list: every graded film layer of the stack. */
export function gradedSpecs(layers: ModelLayer[]): GradedFitSpec[] {
  return layers.flatMap((l, i) => {
    const g = gradedFilm(l, i, layers.length);
    if (!g) return [];
    const spec: GradedFitSpec = { layer: i, method: g.method, slices: gradedSlices(l.thickness) };
    return [g.positions ? { ...spec, positions: g.positions } : spec];
  });
}

/** Why the fit cannot run with these graded layers, or null. */
export function gradedFitBlock(layers: ModelLayer[]): string | null {
  for (const [i, l] of layers.entries()) {
    const g = gradedFilm(l, i, layers.length);
    if (!g) continue;
    if (!(l.thickness > 0)) return `Graded layer ${i} needs a thickness above 0 Å to fit.`;
    const problem = gradedProblem(i, g);
    if (problem) return problem;
  }
  return null;
}
