// SIMS Region measures over SEVERAL profiles (roadmap "SIMS: ... batch region
// tables"): the Region tab's own measures (calc.sims_region, via
// `POST /api/sims/region`) run once per selected profile with ONE region,
// species list and threshold, recorded as a table with one row per profile and
// a block of columns per species (integral, peak, peak depth, mean, junction
// depth). Nothing is computed here: every value is the backend's, and the
// junction is the Region tab's (first falling crossing at or beyond the
// species' own peak depth).
//
// FAIL CLOSED (a failed row names why; nothing is guessed or bridged):
// - a profile whose depth unit differs from the one the region limits are
//   stated in (the Region tab's profile);
// - a profile that lacks a chosen species, or has two columns of that name;
// - non-finite data: an infinite value in a chosen column, a non-finite depth,
//   a species with no finite value in the region, and (unless the user opts in
//   to bridging them, as the Region tab does) blank samples inside the region;
// - species whose value or integral units differ between profiles: the
//   summary worksheet refuses rather than put them in one column.

import { measureSimsRegion, type SimsRegionResult } from "../../../lib/api/sims";
import { inOrder, summaryXMeta, type SummaryXResult } from "../../../lib/batchSummaryX";
import { simsSource, simsWireDataset } from "../../../lib/transformSims";
import { xUnitOf } from "../../../lib/transformResample";
import type { DataStruct, Dataset } from "../../../lib/types";
import type { AnalysisBatchRow } from "../analysisselection/AnalysisBatchControls";
import { leftOut, regionRequest, type RegionForm } from "./useSimsRegion";

/** Per species, in this order, after the leading "Depth unit". */
export const SPECIES_BLOCK = ["integral", "integral unit", "peak", "peak depth", "mean", "value unit", "junction depth"] as const;
const N = SPECIES_BLOCK.length;

/** The batch table's summary columns for `species`. */
export const regionBatchColumns = (species: readonly string[]): string[] => [
  "Depth unit", ...species.flatMap((s) => SPECIES_BLOCK.map((m) => `${s} ${m}`)),
];

/** The settings the batch runs with: the Region tab's form plus the one opt-in. */
export interface RegionBatchSettings {
  form: RegionForm;
  /** Species in the order they are tabulated. */
  species: readonly string[];
  /** The depth unit the region limits are stated in (the Region tab's profile). */
  xUnit: string;
  /** Opt-in (default off): bridge blank samples inside the region, as the Region tab does. */
  allowBlanks: boolean;
}

/** One reason the selected profiles cannot share the region limits, or null. */
export function depthUnitProblem(profiles: readonly Dataset[], xUnit: string): string | null {
  const bad = profiles.filter((d) => xUnitOf(simsSource(d)) !== xUnit);
  if (!bad.length) return null;
  const shown = bad.map((d) => `${d.name} (${xUnitOf(simsSource(d)) || "no unit"})`).join(", ");
  return `The region limits are in ${xUnit || "no recorded unit"}, but ${shown} ${bad.length === 1 ? "is" : "are"} not; ` +
    "convert the depth first (Process tab) so every profile shares one depth unit.";
}

/** Thrown message when `source` cannot be measured for these species, else the column count check passes. */
export function profileProblem(source: DataStruct, species: readonly string[]): string | null {
  for (const name of species) {
    const hits = source.labels.filter((l) => l === name).length;
    if (hits === 0) return `this profile has no species "${name}"`;
    if (hits > 1) return `this profile has ${hits} columns named "${name}"`;
  }
  if (source.time.some((x) => !Number.isFinite(x))) return "the depth column has non-finite values";
  for (const name of species) {
    const col = source.labels.indexOf(name);
    if (source.values.some((row) => row[col] === Infinity || row[col] === -Infinity)) {
      return `"${name}" has infinite values`;
    }
  }
  return null;
}

const num = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** One profile's table row (and warnings) from the backend result; throws the reason it cannot. */
export function regionBatchRow(
  result: SimsRegionResult, species: readonly string[], xUnit: string, allowBlanks: boolean,
): { values: (string | number | null)[]; warnings: string[] } {
  if ((result.x_unit ?? "") !== xUnit) {
    throw new Error(`its depth unit is ${result.x_unit || "unrecorded"}, not ${xUnit || "unrecorded"}`);
  }
  const values: (string | number | null)[] = [xUnit];
  for (const name of species) {
    const s = result.species.find((e) => e.name === name);
    if (!s) throw new Error(`no result for "${name}"`);
    if (s.points === 0) throw new Error(`"${name}" has no finite value in the region`);
    if (s.blank > 0 && !allowBlanks) {
      throw new Error(`"${name}" has ${s.blank} blank sample${s.blank === 1 ? "" : "s"} inside the region (allow bridging blanks to include it)`);
    }
    values.push(num(s.integral), s.integral_unit, num(s.peak), num(s.peak_depth), num(s.mean), s.unit, num(s.junction_depth));
  }
  const warnings = result.warnings.filter((w) => !w.info).map((w) => w.text);
  return { values, warnings };
}

/** Measure one profile: validate, post the Region request, build the row. */
export async function runRegionBatchItem(dataset: Dataset, o: RegionBatchSettings) {
  const source = simsSource(dataset);
  const problem = profileProblem(source, o.species);
  if (problem) throw new Error(problem);
  const parsed = regionRequest({ ...o.form, species: [...o.species] }, source.labels);
  if (typeof parsed === "string") throw new Error(parsed);
  const result = await measureSimsRegion({
    dataset: simsWireDataset(source),
    dataset_name: leftOut(dataset.data.time.length, source.time.length, dataset.name),
    ...parsed,
  });
  return regionBatchRow(result, o.species, o.xUnit, o.allowBlanks);
}

const fin = (v: string | number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : Number.NaN);

/** The summary worksheet for a finished run, or the reason it is refused. Every
 *  row must have completed (no partial table passes for the whole selection) and
 *  a species' units must agree across the profiles. */
export function regionSummaryData(
  inputRows: readonly AnalysisBatchRow[], species: readonly string[], form: RegionForm, allowBlanks: boolean, x?: SummaryXResult,
): { data: DataStruct } | { refused: string } {
  const notDone = inputRows.filter((r) => r.status !== "completed");
  if (notDone.length) {
    return { refused: `${notDone.map((r) => `${r.name} (${r.status}${r.warning ? `: ${r.warning}` : ""})`).join("; ")} did not complete; fix or deselect before creating the summary` };
  }
  if (!inputRows.length) return { refused: "no profile was measured" };
  const rows = x ? inOrder(inputRows, x) : [...inputRows];
  const depths = new Set(rows.map((r) => String(r.values[0] ?? "")));
  if (depths.size > 1) return { refused: `the profiles' depth units differ (${[...depths].join(", ")}); nothing was created` };
  const depthUnit = [...depths][0] ?? "";
  const cols: { label: string; unit: string; at: number }[] = [];
  for (const [k, name] of species.entries()) {
    const base = 1 + k * N;
    // [offset of the value, offset of the column naming its unit; -1 = the depth unit]
    for (const [off, unitAt] of [[0, 1], [2, 5], [3, -1], [4, 5], [6, -1]] as const) {
      const units = new Set(rows.map((r) => (unitAt < 0 ? depthUnit : String(r.values[base + unitAt] ?? ""))));
      if (units.size > 1) {
        return { refused: `"${name}" ${SPECIES_BLOCK[off]} is in different units across the profiles (${[...units].join(", ")}); nothing was created` };
      }
      cols.push({ label: `${name} ${SPECIES_BLOCK[off]}`, unit: [...units][0] ?? "", at: base + off });
    }
  }
  const data: DataStruct = {
    time: x ? x.x : rows.map((_, i) => i + 1),
    values: rows.map((r) => cols.map((c) => fin(r.values[c.at]))),
    labels: cols.map((c) => c.label),
    units: cols.map((c) => c.unit),
    metadata: {
      source: "sims-region-batch",
      x_column_name: "Profile",
      ...(x ? summaryXMeta(x) : {}),
      simsRegionBatch: {
        region: [Number(form.lo), Number(form.hi)], depthUnit, species: [...species],
        thresholdMode: form.mode, threshold: Number(form.threshold), allowBlanks,
        sources: rows.map((r) => ({ id: r.datasetId, name: r.name })), createdAt: new Date().toISOString(),
      },
      text_columns: {
        Worksheet: rows.map((r) => r.name),
        Warnings: rows.map((r) => r.warning ?? ""),
      },
    },
  };
  return { data };
}
