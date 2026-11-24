// The imperative half of the Magnetometry "Derived" tab (OPEN_ITEMS row 36):
// resolve the worksheet, send the declared field / response / uncertainty to the
// backend, and commit ONE row-aligned worksheet through the shared contract.
// In store/ (not components/) because it reads the store after every async
// edge; the pure rules are in lib/magDerived.ts, the arithmetic in the backend.

import { analysisDataFingerprint } from "../lib/analysisResultFreshness";
import { magneticMomentPerFormulaUnit, magneticSusceptibility, type SusceptibilityOutput } from "../lib/api/magnetic";
import type { ErrorBinding } from "../lib/errorRoles";
import { fieldChoices, fieldValues, uncertaintyProblem, type FieldChoice } from "../lib/magDerived";
import { plottedYKey } from "../lib/fitselectionActions";
import { stampXIdentity } from "../lib/magDataKind";
import { ownXKey } from "../lib/perSeriesX";
import type { DataStruct, Dataset } from "../lib/types";
import { commitComputedOutput } from "./commitComputedOutput";
import { useApp } from "./useApp";

const SUSCEPTIBILITY_PRODUCER = { id: "mag-susceptibility", label: "Susceptibility", version: 1 } as const;
const MOMENT_FU_PRODUCER = { id: "mag-moment-fu", label: "Moment per formula unit", version: 1 } as const;

export interface DerivedReadout {
  owners: readonly string[];
  key: string;
  summary: string | null;
  warning: string | null;
  error: string | null;
}

export interface DerivedRequest {
  sourceId: string;
  yKey: number;
  /** Stamps the readout so a later change of any input marks it out of date. */
  key: string;
}

export interface SusceptibilityParams {
  output: SusceptibilityOutput;
  system: "cgs" | "si";
  field: { kind: "x" | "column"; index: number | null };
  sampleMassG: number;
  sampleVolumeCm3: number;
  molarMass: number;
}

/** Resolve the source and refuse if the plot moved while it loaded. */
async function resolveSource(request: DerivedRequest): Promise<{ ds: Dataset; xKey: number | null } | string> {
  const start = useApp.getState();
  const xKey = start.xKey;
  const ds = await start.resolveDataset(request.sourceId);
  const live = useApp.getState();
  if (!ds) return "The worksheet could not be loaded.";
  const yKey = plottedYKey(ds, live.xKey, live.yKeys, live.seriesOrder) ?? 0;
  if (live.activeId !== request.sourceId || live.xKey !== xKey || yKey !== request.yKey) {
    return "The selection or plot changed while the worksheet was loading; run it again.";
  }
  return { ds, xKey };
}

function stillCurrent(ds: Dataset): boolean {
  return useApp.getState().datasets.find((d) => d.id === ds.id)?.data === ds.data;
}

const yRolesOf = (ds: Dataset, yKey: number): ErrorBinding[] =>
  (ds.errorRoles ?? []).filter((r, i, all) => r.axis === "y" && r.target === yKey && r.channel >= 0 &&
    r.channel < ds.data.labels.length &&
    all.findIndex((o) => o.channel === r.channel && o.side === r.side && o.target === r.target && o.axis === r.axis) === i);

function cleanMetadata(meta: Record<string, unknown>): Record<string, unknown> {
  const out = { ...meta };
  for (const key of [
    "origin_column_names", "column_designations", "column_comments",
    "all_column_names", "all_column_units", "y_column_indices", "error_roles", "label_rows",
  ]) delete out[key];
  return out;
}

export async function runSusceptibility(request: DerivedRequest, p: SusceptibilityParams): Promise<DerivedReadout> {
  const owners = [request.sourceId];
  const fail = (error: string): DerivedReadout => ({ owners, key: request.key, summary: null, warning: null, error });
  try {
    const source = await resolveSource(request);
    if (typeof source === "string") return fail(source);
    const { ds, xKey } = source;
    const { yKey } = request;
    const own = ownXKey(ds, xKey, yKey);
    const choice: FieldChoice | undefined = fieldChoices(ds, xKey, yKey)
      .find((c) => c.kind === p.field.kind && c.index === p.field.index);
    if (!choice) return fail("Choose a declared applied-field source (the X axis of an M(H) sweep, or a field column).");
    const responseUnit = (ds.data.units[yKey] ?? "").trim();
    if (!responseUnit) return fail(`The response "${ds.data.labels[yKey] ?? ""}" has no declared unit; a susceptibility is never computed from an unlabeled response.`);
    const field = fieldValues(ds, choice, xKey, yKey);
    const yRoles = yRolesOf(ds, yKey);
    const problem = uncertaintyProblem(ds, yRoles, field.roles, responseUnit, choice.unit);
    if (problem) return fail(problem);

    const n = ds.data.time.length;
    const response = ds.data.values.map((row) => row[yKey] ?? Number.NaN);
    const keep: number[] = [];
    for (let r = 0; r < n; r++) if (Number.isFinite(response[r]) && Number.isFinite(field.values[r])) keep.push(r);
    if (keep.length === 0) return fail("No rows have both a finite response and a finite applied field.");
    const col = (channel: number): number[] => ds.data.values.map((row) => Math.abs(row[channel] ?? Number.NaN));
    const yErr = yRoles.map((role) => col(role.channel));
    const hErr = field.roles.map((role) => col(role.channel));
    const sendable = (values: number[]): number[] => keep.map((r) => (Number.isFinite(values[r]) ? values[r]! : 0));
    const errorGap = (series: number[][]): boolean[] => keep.map((r) => series.some((s) => !Number.isFinite(s[r])));
    const yGap = errorGap(yErr);
    const hGap = errorGap(hErr);

    // Only the sample quantities this basis uses are sent and recorded: a value left in a
    // hidden input must not be applied to (or logged against) a conversion that never uses it.
    const total = responseUnit === "emu" || responseUnit === "A·m²";
    const massUsed = total && p.output !== "volume" && p.sampleMassG > 0 ? p.sampleMassG : null;
    const volumeUsed = total && p.output === "volume" && p.sampleVolumeCm3 > 0 ? p.sampleVolumeCm3 : null;
    const molarUsed = p.output === "molar" && p.molarMass > 0 ? p.molarMass : null;
    const result = await magneticSusceptibility({
      field: keep.map((r) => field.values[r]!), response: keep.map((r) => response[r]!),
      response_unit: responseUnit, field_unit: choice.unit, output: p.output, system: p.system,
      sample_mass_g: massUsed, sample_volume_cm3: volumeUsed, molar_mass_g_mol: molarUsed,
      response_errors: yErr.map(sendable),
      ...(hErr.length ? { field_errors: hErr.map(sendable) } : {}),
    });
    if (!stillCurrent(ds)) return fail("The worksheet changed during the calculation; run it again.");
    if (result.susceptibility.length !== keep.length) throw new Error(`backend returned ${result.susceptibility.length} rows for ${keep.length} sent`);
    const scatter = (values: readonly (number | null)[], blank: readonly boolean[] | null): number[] => {
      const out = new Array<number>(n).fill(Number.NaN);
      keep.forEach((r, i) => { out[r] = blank?.[i] ? Number.NaN : (values[i] ?? Number.NaN); });
      return out;
    };
    // Field uncertainty alone yields one error column with no response role.
    const sides = yRoles.length ? yRoles : result.errors.length ? [null] : [];
    if (result.errors.length !== sides.length) throw new Error(`backend returned ${result.errors.length} uncertainty columns for ${sides.length} expected`);
    const symbol = p.output === "volume" ? "volume" : p.output === "mass" ? "mass" : "molar";
    const labels = [`Susceptibility (${symbol}, ${p.system.toUpperCase()})`];
    const units = [result.unit];
    const columns = [scatter(result.susceptibility, null)];
    const errorRoles: ErrorBinding[] = [];
    result.errors.forEach((e) => {
      errorRoles.push({ channel: columns.length, target: 0, axis: "y", side: "both" });
      labels.push("Susceptibility uncertainty");
      units.push(result.unit);
      columns.push(scatter(e, keep.map((_, i) => yGap[i] || hGap[i])));
    });
    const time = ds.data.time.map((t, r) => (own === null ? t : (ds.data.values[r]?.[own] ?? Number.NaN)));
    const x = stampXIdentity(cleanMetadata(ds.data.metadata), ds.data, own);
    const data: DataStruct = {
      time, values: time.map((_, r) => columns.map((c) => c[r]!)), labels, units,
      metadata: {
        ...x, error_roles: errorRoles,
        magnetometry_susceptibility: {
          version: 1, source_dataset_id: ds.id, source_response: ds.data.labels[yKey] ?? "", response_unit: result.response_unit,
          field_source: choice.kind === "x" ? "X axis" : choice.label, field_unit: result.field_unit,
          output: result.output, system: result.system, unit: result.unit,
          sample_mass_g: massUsed, sample_volume_cm3: volumeUsed, molar_mass_g_mol: molarUsed,
          basis_factor: result.basis_factor, formula: result.formula,
          uncertainty: yRoles.length || hErr.length
            ? `Propagated in quadrature from committed ${[yRoles.length ? "response" : "", hErr.length ? "applied-field" : ""].filter(Boolean).join(" and ")} uncertainty; sample quantities exact.`
            : "No committed uncertainty was available; sample quantities exact.",
        },
      },
    };
    const outcome = commitComputedOutput({
      producer: SUSCEPTIBILITY_PRODUCER,
      sources: [{ id: ds.id, computedOn: analysisDataFingerprint(ds) }],
      settings: { ...p, field: `${p.field.kind}:${p.field.index ?? "time"}`, xKey, yKey },
      xKey: own,
      name: `${ds.name.replace(/\.[^.]+$/, "")} (susceptibility)`, data, errorRoles,
      status: `created ${symbol} susceptibility in ${result.unit}`,
    });
    if (outcome.kind === "refused") return fail(outcome.reason);
    const warnings: string[] = [];
    if (result.n_invalid_field > 0) warnings.push(`${result.n_invalid_field} rows at zero field are gaps.`);
    if (n - keep.length > 0) warnings.push(`${n - keep.length} rows without a finite response or field remain gaps.`);
    if (!yRoles.length && !hErr.length) warnings.push("No committed uncertainty was available to propagate.");
    return {
      owners: [...owners, outcome.outputId], key: request.key, error: null,
      summary: `χ in ${result.unit} (${result.formula}).`,
      warning: warnings.length ? warnings.join(" ") : null,
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "susceptibility failed");
  }
}

export interface MomentFuParams { sampleMassG: number; molarMass: number }

/** mu (mu_B / formula unit) from a per-mass or total moment. A positive scale,
 *  so committed uncertainty keeps its sides (asymmetric bars carry over). */
export async function runMomentPerFormulaUnit(request: DerivedRequest, p: MomentFuParams): Promise<DerivedReadout> {
  const owners = [request.sourceId];
  const fail = (error: string): DerivedReadout => ({ owners, key: request.key, summary: null, warning: null, error });
  try {
    const source = await resolveSource(request);
    if (typeof source === "string") return fail(source);
    const { ds, xKey } = source;
    const { yKey } = request;
    const own = ownXKey(ds, xKey, yKey);
    const responseUnit = (ds.data.units[yKey] ?? "").trim();
    if (!responseUnit) return fail(`The response "${ds.data.labels[yKey] ?? ""}" has no declared unit; a moment per formula unit is never computed from an unlabeled response.`);
    const n = ds.data.time.length;
    const response = ds.data.values.map((row) => row[yKey] ?? Number.NaN);
    const keep: number[] = [];
    for (let r = 0; r < n; r++) if (Number.isFinite(response[r])) keep.push(r);
    if (keep.length === 0) return fail("No rows have a finite response.");
    const roles = yRolesOf(ds, yKey);
    const bad = roles.find((r) => (ds.data.units[r.channel] ?? "") !== "" && ds.data.units[r.channel] !== responseUnit);
    if (bad) return fail(`The uncertainty column "${ds.data.labels[bad.channel]}" is in ${ds.data.units[bad.channel]}, not ${responseUnit}; convert it first.`);
    const errs = roles.map((role) => ds.data.values.map((row) => Math.abs(row[role.channel] ?? Number.NaN)));
    // The sample mass only enters a total moment; a per-mass response is never divided by it.
    const massUsed = (responseUnit === "emu" || responseUnit === "A·m²") && p.sampleMassG > 0 ? p.sampleMassG : null;
    const result = await magneticMomentPerFormulaUnit({
      response: keep.map((r) => response[r]!), response_unit: responseUnit,
      molar_mass_g_mol: p.molarMass > 0 ? p.molarMass : null,
      sample_mass_g: massUsed,
      response_errors: errs.map((e) => keep.map((r) => (Number.isFinite(e[r]) ? e[r]! : 0))),
    });
    if (!stillCurrent(ds)) return fail("The worksheet changed during the calculation; run it again.");
    if (result.moment.length !== keep.length || result.errors.length !== roles.length) throw new Error("backend returned a different number of rows or uncertainty columns than sent");
    const scatter = (values: readonly (number | null)[], gapOf: ((r: number) => boolean) | null): number[] => {
      const out = new Array<number>(n).fill(Number.NaN);
      keep.forEach((r, i) => { out[r] = gapOf?.(r) ? Number.NaN : (values[i] ?? Number.NaN); });
      return out;
    };
    const labels = ["Moment per formula unit"];
    const units = [result.unit];
    const columns = [scatter(result.moment, null)];
    const errorRoles: ErrorBinding[] = [];
    result.errors.forEach((e, k) => {
      errorRoles.push({ channel: columns.length, target: 0, axis: "y", side: roles[k]!.side });
      labels.push(ds.data.labels[roles[k]!.channel] ?? "Moment uncertainty");
      units.push(result.unit);
      columns.push(scatter(e, (r) => !Number.isFinite(errs[k]![r])));
    });
    const time = ds.data.time.map((t, r) => (own === null ? t : (ds.data.values[r]?.[own] ?? Number.NaN)));
    const data: DataStruct = {
      time, values: time.map((_, r) => columns.map((c) => c[r]!)), labels, units,
      metadata: {
        ...stampXIdentity(cleanMetadata(ds.data.metadata), ds.data, own), error_roles: errorRoles,
        magnetometry_moment_per_formula_unit: {
          version: 1, source_dataset_id: ds.id, source_response: ds.data.labels[yKey] ?? "", response_unit: result.response_unit,
          sample_mass_g: massUsed, molar_mass_g_mol: p.molarMass,
          scale: result.scale, constants: result.constants, formula: result.formula,
          uncertainty: roles.length
            ? "Committed response uncertainty scaled by the exact factor; sample quantities and constants exact."
            : "No committed uncertainty was available; sample quantities and constants exact.",
        },
      },
    };
    const outcome = commitComputedOutput({
      producer: MOMENT_FU_PRODUCER,
      sources: [{ id: ds.id, computedOn: analysisDataFingerprint(ds) }],
      settings: { ...p, xKey, yKey },
      xKey: own,
      name: `${ds.name.replace(/\.[^.]+$/, "")} (μB per f.u.)`, data, errorRoles,
      status: "created moment per formula unit in μB/f.u.",
    });
    if (outcome.kind === "refused") return fail(outcome.reason);
    const warnings: string[] = [];
    if (n - keep.length > 0) warnings.push(`${n - keep.length} rows without a finite response remain gaps.`);
    if (!roles.length) warnings.push("No committed uncertainty was available to propagate.");
    return {
      owners: [...owners, outcome.outputId], key: request.key, error: null,
      summary: `μ in μB per formula unit (${result.formula}).`,
      warning: warnings.length ? warnings.join(" ") : null,
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "moment per formula unit failed");
  }
}
