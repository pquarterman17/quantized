// SIMS multi-profile depth alignment as a recordable transform (roadmap row 23,
// "multi-profile alignment"). The `simsalign` op of lib/transformRun: several
// profiles' depth axes are shifted so that ONE reference species' feature
// (its peak depth, or its junction depth) lands at the same depth in every
// profile, then the chosen species are laid side by side in ONE combined
// worksheet (the `simscompare` layout, `calc.sims_compare`: row blocks, one
// column per profile x species, nothing interpolated).
//
// THE DEPTH DEFINITION IS NOT NEW. The reference depth of each profile is the
// backend's `region_measures` (`POST /api/sims/region`, calc/sims_region.py)
// value for the reference species: `peak_depth`, or `junction_depth` (the first
// falling threshold crossing at or beyond the species' own peak). Nothing here
// measures a depth.
//
//   shift_i   = referenceDepth_i - referenceDepth_0      (profile 0 = the primary)
//   aligned x = x - shift_i                              (the primary is untouched)
//
// so the reference feature of every profile sits where the primary's does. The
// shifts are recorded in `metadata.sims_align`.
//
// FAIL CLOSED (nothing is guessed, bridged or partially aligned; each message
// names the profile):
// - fewer than two profiles;
// - the same profile twice;
// - depth units that differ between profiles (`simsDepthUnit`: the backend's
//   own reading, nested parser metadata included);
// - the reference or an output species missing from a profile, or two columns
//   of that name;
// - non-finite data: a non-finite depth, a reference species with no finite value,
//   or a non-finite (blank or infinite) value BETWEEN its measured rows;
// - no peak, or no junction (a surface-peaked profile that never falls back
//   through the threshold, a non-positive peak), in any profile.
//
// PROVISIONAL, owner to confirm: ONE combined worksheet (not one per profile),
// matching how `simscompare` outputs one table; the shift sign (the primary is
// the reference and stays put); a blank-but-uniform depth unit is allowed (as
// the batch region table does); a blank BETWEEN measured rows of the reference
// species refuses rather than being bridged (blanks at either end of its range
// are a union-grid end and are ignored); an absent region means each profile's whole depth range.
//
// Species are recorded BY NAME and the other profiles are dataset REFERENCES
// (`with`), as `simscompare` records them. Lazy: only the SIMS workshop and
// the transform runner import this.

import { measureSimsRegion } from "./api/sims";
import { computeSimsCompare } from "./transformSimsCompare";
import { simsDepthUnit, simsWireDataset } from "./transformSims";
import type { DatasetRef } from "./transformRun";
import type { TransformWarning } from "./transformWarnings";
import type { DataStruct } from "./types";

export type SimsAlignBy = "peak" | "junction";

export interface SimsAlignParams {
  op: "simsalign";
  /** The species (column name) whose peak / junction depth the profiles are aligned on. */
  reference: string;
  by: SimsAlignBy;
  /** Species laid out in the aligned worksheet; always includes `reference`. */
  species: string[];
  /** The OTHER profiles (the primary is the transform's input and the depth reference). */
  with: DatasetRef[];
  /** Region the reference depth is measured in (the profile's depth unit).
   *  Absent = each profile's whole depth range. */
  region?: { lo: number; hi: number };
  /** `junction` only: percent-of-peak as a FRACTION (0..1 exclusive), or an
   *  absolute value; absent = half the peak (the Region tab's default). */
  threshold?: { mode: "fraction" | "absolute"; value: number };
}

export interface SimsAlignShift {
  id: string;
  name: string;
  /** The reference species' depth in this profile (profile unit). */
  referenceDepth: number;
  /** Subtracted from this profile's depth (0 for the primary). */
  shift: number;
}

export interface SimsAlignComputed {
  data: DataStruct;
  name: string;
  warnings: TransformWarning[];
  shifts: SimsAlignShift[];
  depthUnit: string;
}

const stem = (name: string): string => name.replace(/\.[^.]+$/, "");
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function simsAlignLabel(p: SimsAlignParams, primaryName: string): string {
  const n = p.with.length + 1;
  return `SIMS align ${n} profile${n === 1 ? "" : "s"} on ${p.reference} ${p.by} depth (${primaryName}${p.with.length ? ", …" : ""})`;
}

export function simsAlignOutputName(primaryName: string, others: number): string {
  return `${stem(primaryName)} + ${others} (SIMS aligned)`;
}

/** The first reason `d` cannot be aligned for `p`, or null. */
function profileProblem(d: DataStruct, p: SimsAlignParams): string | null {
  for (const name of p.species) {
    const hits = d.labels.filter((l) => l === name).length;
    if (hits === 0) return `has no species "${name}"`;
    if (hits > 1) return `has ${hits} columns named "${name}"`;
  }
  for (let i = 0; i < d.time.length; i++) if (!finite(d.time[i])) return "has a non-finite depth value";
  // Blanks BEFORE the reference's first or AFTER its last measured row are a
  // union-grid end (io.sims: species measured to different depths), outside its
  // range, exactly as `calc.sims_region` reads them: not refused. A blank
  // BETWEEN two measured rows would be bridged by the junction interpolation:
  // refused.
  const col = d.labels.indexOf(p.reference);
  let first = -1;
  let last = -1;
  d.values.forEach((row, i) => { if (finite(row[col])) { if (first < 0) first = i; last = i; } });
  if (first < 0) return `has no finite values in "${p.reference}"`;
  for (let i = first; i <= last; i++) {
    if (!finite(d.values[i][col])) return `has blank or non-finite values in "${p.reference}"`;
  }
  return null;
}

/** The reference depth of one profile from the backend's `region_measures`. */
async function referenceDepth(
  name: string, d: DataStruct, p: SimsAlignParams, signal?: AbortSignal,
): Promise<number> {
  let lo = p.region?.lo ?? Infinity;
  let hi = p.region?.hi ?? -Infinity;
  if (!p.region) for (const x of d.time) { if (x < lo) lo = x; if (x > hi) hi = x; }
  const t = p.threshold ?? { mode: "fraction" as const, value: 0.5 };
  let res;
  try {
    res = await measureSimsRegion({
      dataset: simsWireDataset(d), dataset_name: name,
      lo, hi, columns: [d.labels.indexOf(p.reference)], threshold_mode: t.mode, threshold: t.value,
    }, signal);
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(`${name}: ${e instanceof Error ? e.message : "the region could not be measured"}`);
  }
  const s = res.species.find((e) => e.name === p.reference);
  const depth = p.by === "peak" ? s?.peak_depth : s?.junction_depth;
  if (!s || !finite(depth)) {
    throw new Error(
      p.by === "peak"
        ? `${name}: no peak of "${p.reference}" was found in the region`
        : `${name}: no junction of "${p.reference}" was found (no falling threshold crossing at or beyond its peak)`,
    );
  }
  return depth;
}

/** THE compute for the workshop's live preview, the commit and the replay:
 *  `profiles[0]` is the primary. Throws the refusal message. */
export async function computeSimsAlign(
  p: SimsAlignParams,
  profiles: readonly { id: string; name: string; data: DataStruct }[],
  opts: { signal?: AbortSignal } = {},
): Promise<SimsAlignComputed> {
  const { signal } = opts;
  if (profiles.length < 2) throw new Error("alignment needs at least 2 profiles");
  const dup = profiles.find((d, i) => profiles.findIndex((e) => e.id === d.id) !== i);
  if (dup) throw new Error(`"${dup.name}" is picked twice; each profile can be aligned once`);
  for (const d of profiles) {
    const why = profileProblem(d.data, p);
    if (why) throw new Error(`${d.name} ${why}`);
  }
  const unit = simsDepthUnit(profiles[0].data);
  const mixed = profiles.filter((d) => simsDepthUnit(d.data) !== unit);
  if (mixed.length) {
    throw new Error(
      `the depth units differ: ${profiles[0].name} is in ${unit || "no recorded unit"}, but ` +
      `${mixed.map((d) => `${d.name} (${simsDepthUnit(d.data) || "no unit"})`).join(", ")} ` +
      `${mixed.length === 1 ? "is" : "are"} not; convert the depth first (Process tab)`,
    );
  }
  const depths: number[] = [];
  for (const d of profiles) {
    signal?.throwIfAborted();
    depths.push(await referenceDepth(d.name, d.data, p, signal));
  }
  const shifts = profiles.map((d, i) => ({
    id: d.id, name: d.name, referenceDepth: depths[i], shift: i === 0 ? 0 : depths[i] - depths[0],
  }));
  if (shifts.some((s) => !finite(s.shift))) throw new Error("a depth shift is not finite; nothing was aligned");
  const shifted = profiles.map((d, i) => ({
    ...d,
    data: shifts[i].shift === 0 ? d.data : { ...d.data, time: d.data.time.map((x) => x - shifts[i].shift) },
  }));
  const cmp = await computeSimsCompare(
    { op: "simscompare", species: p.species, with: [] }, shifted, { signal },
  );
  const align = {
    reference: p.reference, by: p.by, depthUnit: unit, shifts,
    ...(p.region ? { region: p.region } : {}), ...(p.threshold && p.by === "junction" ? { threshold: p.threshold } : {}),
  };
  return {
    data: { ...cmp.data, metadata: { ...cmp.data.metadata, sims_align: align } },
    name: simsAlignOutputName(profiles[0].name, profiles.length - 1),
    warnings: cmp.warnings,
    shifts,
    depthUnit: unit,
  };
}

/** Validate a recorded `simsalign` step (user-editable JSON), or throw. */
export function simsAlignParamsOf(raw: Record<string, unknown>): SimsAlignParams {
  const reference = raw.reference;
  if (typeof reference !== "string" || !reference.trim()) throw new Error('simsalign needs a "reference" species name');
  if (raw.by !== "peak" && raw.by !== "junction") throw new Error('simsalign "by" must be "peak" or "junction"');
  const sp = raw.species ?? [reference];
  if (!Array.isArray(sp) || !sp.length || !sp.every((s) => typeof s === "string" && s.trim())) {
    throw new Error('simsalign "species" must list column names');
  }
  if (!sp.includes(reference)) throw new Error('simsalign "species" must include the reference species');
  const w = raw.with;
  if (!Array.isArray(w) || !w.length) throw new Error("simsalign needs at least 2 profiles (the others are recorded in \"with\")");
  const refs = w.map((v) => {
    const o = (v ?? {}) as Record<string, unknown>;
    if (typeof o.id !== "string" || !o.id) throw new Error("simsalign has a recorded profile with no id");
    return { id: o.id, name: typeof o.name === "string" ? o.name : o.id };
  });
  const p: SimsAlignParams = { op: "simsalign", reference, by: raw.by, species: sp as string[], with: refs };
  const rg = raw.region;
  if (rg !== undefined && rg !== null) {
    const o = rg as Record<string, unknown>;
    if (typeof rg !== "object" || Array.isArray(rg) || !finite(o.lo) || !finite(o.hi)) {
      throw new Error('simsalign "region" needs numbers "lo" and "hi"');
    }
    p.region = { lo: o.lo, hi: o.hi };
  }
  const th = raw.threshold;
  if (th !== undefined && th !== null) {
    if (raw.by !== "junction") throw new Error('simsalign "threshold" applies to a junction alignment only');
    const o = th as Record<string, unknown>;
    if (typeof th !== "object" || Array.isArray(th) || (o.mode !== "fraction" && o.mode !== "absolute") || !finite(o.value)) {
      throw new Error('simsalign "threshold" needs a "mode" (fraction | absolute) and a number "value"');
    }
    if (o.mode === "fraction" && !(o.value > 0 && o.value < 1)) throw new Error("a threshold fraction must lie strictly between 0 and 1");
    p.threshold = { mode: o.mode, value: o.value };
  }
  return p;
}
