// Explicit-basis moment normalization: the live, read-only calculation
// summary shown before Apply, and the provenance a derived dataset records
// (MAIN_PLAN #42). Mirrors `quantized.calc.magnetometry_normalization` (the
// backend does the actual conversion; this side only previews and validates).
//
// The basis is ALWAYS the user's explicit choice — none/raw, mass, area or
// volume. Nothing here looks at metadata to pick one.
//
// Factors (1 emu = 1e-3 A·m², exact):
//   1 emu/g   = 1e-3 A·m² / 1e-3 kg = 1 A·m²/kg
//   1 emu/cm³ = 1e-3 A·m² / 1e-6 m³ = 1000 A/m = 1 kA/m
//   1 emu/cm² = 1e-3 A·m² / 1e-4 m² = 10 A·m²/m²

import {
  FIELD_SPECS,
  PROFILE_FIELDS,
  type ProfileField,
  type SampleGeometry,
  type SampleProfile,
} from "./sampleGeometry";

export type NormalizationBasis = "none" | "mass" | "area" | "volume";

export const BASIS_OPTIONS: readonly { value: NormalizationBasis; label: string }[] = [
  { value: "none", label: "None — raw moment" },
  { value: "mass", label: "Mass" },
  { value: "area", label: "Area (area-normalized moment)" },
  { value: "volume", label: "Volume (magnetization)" },
];

/** Raw moment units a normalization can start from, in emu. */
export const RAW_MOMENT_TO_EMU: Readonly<Record<string, number>> = { emu: 1, "A·m²": 1e3 };

export const BASIS_OUTPUT_UNITS: Readonly<Record<NormalizationBasis, readonly string[]>> = {
  none: ["emu", "A·m²"],
  mass: ["emu/g", "A·m²/kg"],
  volume: ["emu/cm³", "A/m", "kA/m"],
  area: ["emu/cm²", "A·m²/m²"],
};

/** Output value for 1 emu per one canonical divisor unit (— / g / cm³ / cm²). */
export const OUTPUT_PER_EMU: Readonly<Record<string, number>> = {
  emu: 1, "A·m²": 1e-3, "emu/g": 1, "A·m²/kg": 1,
  "emu/cm³": 1, "A/m": 1e3, "kA/m": 1, "emu/cm²": 1, "A·m²/m²": 10,
};

export const isRawMoment = (unit: string): boolean => unit in RAW_MOMENT_TO_EMU;

/** The output units offered for `basis`. An already-normalized source can only
 *  be kept as it is: it is never divided a second time. */
export function outputUnitsFor(basis: NormalizationBasis, fromMoment: string): readonly string[] {
  if (!isRawMoment(fromMoment)) return basis === "none" ? [fromMoment] : [];
  return BASIS_OUTPUT_UNITS[basis];
}

export const GEOMETRY_LABELS: Readonly<Record<SampleGeometry, string>> = {
  rectangle: "Width × length",
  area: "Direct area",
  circle: "Circular (diameter)",
  volume: "Direct volume",
};

/** Geometry paths that can give the basis's divisor (a direct volume has no area). */
export function geometriesFor(basis: NormalizationBasis): readonly SampleGeometry[] {
  if (basis === "area") return ["rectangle", "area", "circle"];
  if (basis === "volume") return ["rectangle", "area", "circle", "volume"];
  return [];
}

/** The profile fields a basis/geometry pair actually uses, in display order. */
export function fieldsFor(basis: NormalizationBasis, geometry: SampleGeometry): readonly ProfileField[] {
  if (basis === "mass") return ["mass"];
  if (basis === "none") return [];
  const plane: ProfileField[] = geometry === "rectangle" ? ["width", "length"]
    : geometry === "area" ? ["area"] : geometry === "circle" ? ["diameter"] : [];
  if (basis === "area") return plane;
  return geometry === "volume" ? ["volume"] : [...plane, "filmThickness"];
}

/** Per-field validation text (the backend's `SampleGeometryError` wording). */
export function fieldProblem(field: ProfileField, profile: SampleProfile): string | null {
  const { label } = FIELD_SPECS[field];
  const q = profile[field];
  if (q.value === null) return `${label} is required.`;
  if (Number.isNaN(q.value)) return `${label} must be a number.`;
  if (!Number.isFinite(q.value)) return `${label} must be a finite number.`;
  if (q.value <= 0) return `${label} must be greater than zero.`;
  if (q.canonical === null || !(q.canonical > 0)) return `${label} is out of range in canonical units.`;
  return null;
}

export interface NormalizationSummary {
  basis: NormalizationBasis;
  geometry: SampleGeometry | null;
  fromMoment: string;
  toMoment: string;
  /** Exactly the fields this calculation reads. */
  fields: readonly ProfileField[];
  fieldErrors: Partial<Record<ProfileField, string>>;
  /** First blocking reason, or null when Apply may run. */
  problem: string | null;
  massG: number | null;
  areaCm2: number | null;
  volumeCm3: number | null;
  divisor: number | null;
  divisorUnit: string;
  /** Multiplier from the source moment to the output, or null when blocked. */
  factor: number | null;
  equation: string;
  geometryEquation: string;
}

const SYMBOL: Record<NormalizationBasis, string> = { none: "m", mass: "σ", volume: "M", area: "m/A" };
const DIVISOR_SYMBOL: Record<NormalizationBasis, string> = { none: "", mass: "mass", volume: "V", area: "A" };
const DIVISOR_UNIT: Record<NormalizationBasis, string> = { none: "", mass: "g", volume: "cm³", area: "cm²" };

/** Six significant figures — the precision the summary prints. */
export const fmt6 = (v: number): string => String(Number(v.toPrecision(6)));

function momentEquation(basis: NormalizationBasis, from: string, to: string): string {
  const scale = basis === "none" && from === to ? 1 : (RAW_MOMENT_TO_EMU[from] ?? 1) * (OUTPUT_PER_EMU[to] ?? 1);
  const lhs = `${SYMBOL[basis]} [${to}] = m [${from}]${scale === 1 ? "" : ` × ${fmt6(scale)}`}`;
  return basis === "none" ? lhs : `${lhs} / ${DIVISOR_SYMBOL[basis]} [${DIVISOR_UNIT[basis]}]`;
}

function geometryValues(
  basis: NormalizationBasis, geometry: SampleGeometry, p: SampleProfile,
): { massG: number | null; areaCm2: number | null; volumeCm3: number | null; text: string } {
  const c = (f: ProfileField): number => p[f].canonical ?? Number.NaN;
  if (basis === "mass") return { massG: c("mass"), areaCm2: null, volumeCm3: null, text: `mass = ${fmt6(c("mass"))} g` };
  if (geometry === "volume") return { massG: null, areaCm2: null, volumeCm3: c("volume"), text: `V = ${fmt6(c("volume"))} cm³` };
  const area = geometry === "rectangle" ? c("width") * c("length")
    : geometry === "area" ? c("area") : Math.PI * (c("diameter") / 2) ** 2;
  const areaText = geometry === "rectangle" ? `A = w × l = ${fmt6(c("width"))} cm × ${fmt6(c("length"))} cm`
    : geometry === "area" ? "A" : `A = π (d/2)² = π (${fmt6(c("diameter"))} cm / 2)²`;
  if (basis === "area") return { massG: null, areaCm2: area, volumeCm3: null, text: `${areaText} = ${fmt6(area)} cm²` };
  const volume = area * c("filmThickness");
  return {
    massG: null, areaCm2: area, volumeCm3: volume,
    text: `${areaText} = ${fmt6(area)} cm²; V = A × t_film = ${fmt6(area)} cm² × ${fmt6(c("filmThickness"))} cm = ${fmt6(volume)} cm³`,
  };
}

/** The live summary for the current choices. Pure; recomputed every render,
 *  so it can never describe a stale profile. */
export function summarizeNormalization(
  profile: SampleProfile, basis: NormalizationBasis, fromMoment: string, toMoment: string,
): NormalizationSummary {
  const geometry = basis === "area" || basis === "volume" ? profile.geometry : null;
  const fields = geometry || basis === "mass" ? fieldsFor(basis, profile.geometry) : [];
  const base: NormalizationSummary = {
    basis, geometry, fromMoment, toMoment, fields, fieldErrors: {}, problem: null,
    massG: null, areaCm2: null, volumeCm3: null, divisor: null, divisorUnit: DIVISOR_UNIT[basis],
    factor: null, equation: momentEquation(basis, fromMoment, toMoment), geometryEquation: "",
  };
  const allowed = outputUnitsFor(basis, fromMoment);
  if (basis !== "none" && !isRawMoment(fromMoment)) {
    return { ...base, problem: `The moment is already in ${fromMoment}; normalize the raw-moment (emu or A·m²) dataset instead.` };
  }
  if (!allowed.includes(toMoment)) {
    return { ...base, problem: `Choose an output unit for the ${basis === "none" ? "raw" : basis} basis (${allowed.join(", ")}).` };
  }
  if (geometry && !geometriesFor(basis).includes(geometry)) {
    return { ...base, problem: `${GEOMETRY_LABELS[geometry]} cannot give a sample area; choose another geometry.` };
  }
  const fieldErrors: Partial<Record<ProfileField, string>> = {};
  for (const f of fields) {
    const err = fieldProblem(f, profile);
    if (err) fieldErrors[f] = err;
  }
  const firstError = PROFILE_FIELDS.map((f) => fieldErrors[f]).find((e) => e);
  if (firstError) return { ...base, fieldErrors, problem: firstError };
  const scale = basis === "none" && fromMoment === toMoment ? 1 : RAW_MOMENT_TO_EMU[fromMoment] * OUTPUT_PER_EMU[toMoment];
  if (basis === "none") return { ...base, divisor: 1, factor: scale };
  const g = geometryValues(basis, profile.geometry, profile);
  const divisor = basis === "mass" ? g.massG : basis === "area" ? g.areaCm2 : g.volumeCm3;
  if (divisor === null || !Number.isFinite(divisor) || divisor <= 0) {
    return { ...base, ...g, problem: `The computed sample ${basis} is out of range.` };
  }
  return { ...base, massG: g.massG, areaCm2: g.areaCm2, volumeCm3: g.volumeCm3, geometryEquation: g.text, divisor, factor: scale / divisor };
}

/** The `/api/magnetometry/normalize` response fields provenance records. */
export interface NormalizeRecord {
  factor: number;
  divisor: number;
  divisor_unit: string;
  mass_g: number | null;
  area_cm2: number | null;
  volume_cm3: number | null;
  canonical: Record<string, number>;
  equation: string;
  geometry_equation: string;
}

export const NORMALIZATION_PROVENANCE_VERSION = 1;

/** Everything a save/reopen/recompute needs to reproduce the derived values
 *  exactly: the source, every entered geometry input with its original unit
 *  and canonical value, the basis, the output unit, the factor and formula.
 *  The numbers are the BACKEND's (the authority that produced the data). */
export function normalizationProvenance(args: {
  profile: SampleProfile;
  summary: NormalizationSummary;
  record: NormalizeRecord;
  source: { datasetId: string; datasetName: string; channel: string; xUnit: string };
  toField: string;
}): Record<string, unknown> {
  const { profile, summary, record, source } = args;
  const inputs: Record<string, unknown> = {};
  for (const f of summary.fields) {
    const q = profile[f];
    inputs[FIELD_SPECS[f].wire] = {
      label: FIELD_SPECS[f].label, value: q.value, unit: q.unit,
      canonical: record.canonical[FIELD_SPECS[f].wire] ?? q.canonical, canonical_unit: FIELD_SPECS[f].canonicalUnit,
    };
  }
  return {
    version: NORMALIZATION_PROVENANCE_VERSION,
    basis: summary.basis,
    geometry: summary.geometry,
    from_moment: summary.fromMoment,
    to_moment: summary.toMoment,
    from_field: source.xUnit,
    to_field: args.toField,
    factor: record.factor,
    divisor: summary.basis === "none" ? null : record.divisor,
    divisor_unit: record.divisor_unit,
    sample_mass_g: record.mass_g,
    sample_area_cm2: record.area_cm2,
    sample_volume_cm3: record.volume_cm3,
    equation: record.equation,
    geometry_equation: record.geometry_equation,
    inputs,
    profile,
    source_dataset_id: source.datasetId,
    source_dataset_name: source.datasetName,
    source_channel: source.channel,
  };
}
