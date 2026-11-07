// Sample profile contract for unit-aware normalization (MAIN_PLAN #42).
//
// A `SampleProfile` holds every optional physical quantity a magnetometry
// normalization can use — mass, direct volume, direct area, width, length,
// diameter, and the MAGNETIC-FILM thickness — each as the value and unit the
// user entered (for editing) plus its canonical value (g, cm, cm², cm³) for
// calculation. `filmThickness` is the magnetic layer only, never the substrate
// or total-sample thickness; nothing here guesses which one was meant.
//
// The profile is VERSIONED and persisted (saved named profiles in the .dwk,
// and inside every derived dataset's provenance). `sanitizeSampleProfile`
// re-derives each canonical value from the entered value + unit on load, so a
// hand-edited canonical number can never disagree with what the form shows. A
// later uncertainty field can be added as an optional sibling of `value`
// without changing what a version-1 profile means.
//
// The backend twin is `quantized.calc.sample_geometry` — the unit tables and
// field labels below must stay identical to it.

export const MASS_UNITS = ["µg", "mg", "g", "kg"] as const;
export const LENGTH_UNITS = ["Å", "nm", "µm", "mm", "cm", "m"] as const;
export const AREA_UNITS = ["µm²", "mm²", "cm²", "m²"] as const;
export const VOLUME_UNITS = ["µm³", "mm³", "cm³", "µL", "mL", "m³"] as const;

export type MassUnit = typeof MASS_UNITS[number];
export type LengthUnit = typeof LENGTH_UNITS[number];
export type AreaUnit = typeof AREA_UNITS[number];
export type VolumeUnit = typeof VOLUME_UNITS[number];

const MASS_TO_G: Record<MassUnit, number> = { "µg": 1e-6, mg: 1e-3, g: 1, kg: 1e3 };
const LENGTH_TO_CM: Record<LengthUnit, number> = { "Å": 1e-8, nm: 1e-7, "µm": 1e-4, mm: 0.1, cm: 1, m: 100 };
const AREA_TO_CM2: Record<AreaUnit, number> = { "µm²": 1e-8, "mm²": 1e-2, "cm²": 1, "m²": 1e4 };
const VOLUME_TO_CM3: Record<VolumeUnit, number> = { "µm³": 1e-12, "mm³": 1e-3, "cm³": 1, "µL": 1e-3, "mL": 1, "m³": 1e6 };

/** Mass in grams, or null for a missing / non-positive / non-finite value. */
export function massInGrams(value: number, unit: MassUnit): number | null {
  return Number.isFinite(value) && value > 0 ? value * MASS_TO_G[unit] : null;
}

export const SAMPLE_PROFILE_VERSION = 1;

export type ProfileField = "mass" | "volume" | "area" | "width" | "length" | "diameter" | "filmThickness";
export const PROFILE_FIELDS: readonly ProfileField[] = ["mass", "volume", "area", "width", "length", "diameter", "filmThickness"];

/** How the in-plane size (and so area/volume) is described. Chosen explicitly
 *  by the user; never inferred from which fields happen to be filled in. */
export type SampleGeometry = "rectangle" | "area" | "circle" | "volume";

interface FieldSpec {
  label: string;
  units: readonly string[];
  toCanonical: Readonly<Record<string, number>>;
  canonicalUnit: string;
  defaultUnit: string;
  /** Wire name used by the backend (`calc.sample_geometry`). */
  wire: string;
}

export const FIELD_SPECS: Readonly<Record<ProfileField, FieldSpec>> = {
  mass: { label: "Sample mass", units: MASS_UNITS, toCanonical: MASS_TO_G, canonicalUnit: "g", defaultUnit: "mg", wire: "mass" },
  volume: { label: "Sample volume", units: VOLUME_UNITS, toCanonical: VOLUME_TO_CM3, canonicalUnit: "cm³", defaultUnit: "cm³", wire: "volume" },
  area: { label: "Sample area", units: AREA_UNITS, toCanonical: AREA_TO_CM2, canonicalUnit: "cm²", defaultUnit: "cm²", wire: "area" },
  width: { label: "Width", units: LENGTH_UNITS, toCanonical: LENGTH_TO_CM, canonicalUnit: "cm", defaultUnit: "cm", wire: "width" },
  length: { label: "Length", units: LENGTH_UNITS, toCanonical: LENGTH_TO_CM, canonicalUnit: "cm", defaultUnit: "cm", wire: "length" },
  diameter: { label: "Diameter", units: LENGTH_UNITS, toCanonical: LENGTH_TO_CM, canonicalUnit: "cm", defaultUnit: "mm", wire: "diameter" },
  filmThickness: { label: "Magnetic-film thickness", units: LENGTH_UNITS, toCanonical: LENGTH_TO_CM, canonicalUnit: "cm", defaultUnit: "nm", wire: "film_thickness" },
};

/** One entered quantity. `value` is null when the field is blank; it may be
 *  NaN in memory while the user is mid-typing garbage (validation names it),
 *  but a sanitized/persisted profile never carries NaN. */
export interface ProfileQuantity {
  value: number | null;
  unit: string;
  /** `value` in the field's canonical unit, or null when value is unusable. */
  canonical: number | null;
}

export interface SampleProfile {
  version: typeof SAMPLE_PROFILE_VERSION;
  geometry: SampleGeometry;
  mass: ProfileQuantity;
  volume: ProfileQuantity;
  area: ProfileQuantity;
  width: ProfileQuantity;
  length: ProfileQuantity;
  diameter: ProfileQuantity;
  filmThickness: ProfileQuantity;
}

/** An explicitly saved, named profile (store/sampleProfiles.ts). */
export interface SavedSampleProfile {
  id: string;
  name: string;
  savedAt: string;
  profile: SampleProfile;
}

/** Fold the Greek mu (U+03BC) onto the micro sign (U+00B5) — both are typed. */
export function normalizeUnitSpelling(unit: string): string {
  return unit.trim().replace(/μ/g, "µ");
}

/** `value` in `unit` -> the field's canonical unit; null if either is unusable. */
export function canonicalValue(field: ProfileField, value: number | null, unit: string): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const k = FIELD_SPECS[field].toCanonical[normalizeUnitSpelling(unit)];
  if (k === undefined) return null;
  const v = value * k;
  return Number.isFinite(v) ? v : null;
}

export function makeQuantity(field: ProfileField, value: number | null, unit: string): ProfileQuantity {
  return { value, unit, canonical: canonicalValue(field, value, unit) };
}

export function emptySampleProfile(): SampleProfile {
  const q = (f: ProfileField): ProfileQuantity => makeQuantity(f, null, FIELD_SPECS[f].defaultUnit);
  return {
    version: SAMPLE_PROFILE_VERSION, geometry: "rectangle",
    mass: q("mass"), volume: q("volume"), area: q("area"), width: q("width"),
    length: q("length"), diameter: q("diameter"), filmThickness: q("filmThickness"),
  };
}

/** Re-express `q` in `unit` so the PHYSICAL quantity is unchanged (5 cm ->
 *  50 mm). Rounded to 12 significant figures so a round trip through several
 *  units does not accumulate binary noise into what the user sees. */
export function convertQuantityUnit(field: ProfileField, q: ProfileQuantity, unit: string): ProfileQuantity {
  const table = FIELD_SPECS[field].toCanonical;
  const from = table[normalizeUnitSpelling(q.unit)];
  const to = table[normalizeUnitSpelling(unit)];
  if (q.value === null || !Number.isFinite(q.value) || from === undefined || to === undefined) {
    return makeQuantity(field, q.value, unit);
  }
  return makeQuantity(field, Number((q.value * from / to).toPrecision(12)), unit);
}

const GEOMETRIES: readonly SampleGeometry[] = ["rectangle", "area", "circle", "volume"];

function sanitizeQuantity(field: ProfileField, raw: unknown): ProfileQuantity {
  const spec = FIELD_SPECS[field];
  if (typeof raw !== "object" || raw === null) return makeQuantity(field, null, spec.defaultUnit);
  const r = raw as Record<string, unknown>;
  const unit = typeof r.unit === "string" ? normalizeUnitSpelling(r.unit) : "";
  // An unknown unit is never guessed at: the value is dropped with it.
  if (!spec.units.includes(unit)) return makeQuantity(field, null, spec.defaultUnit);
  const value = typeof r.value === "number" && Number.isFinite(r.value) ? r.value : null;
  return makeQuantity(field, value, unit);
}

/** Load-time sanitizer: null for anything that is not a profile of a version
 *  this build understands; otherwise every field is re-validated and its
 *  canonical value recomputed from the entered value + unit. */
export function sanitizeSampleProfile(raw: unknown): SampleProfile | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== SAMPLE_PROFILE_VERSION) return null;
  const geometry = GEOMETRIES.includes(r.geometry as SampleGeometry) ? (r.geometry as SampleGeometry) : "rectangle";
  const out = { version: SAMPLE_PROFILE_VERSION, geometry } as SampleProfile;
  for (const f of PROFILE_FIELDS) out[f] = sanitizeQuantity(f, r[f]);
  return out;
}

/** Drop-malformed-never-throw sanitizer for the `.dwk` `savedSampleProfiles`
 *  field (the `sanitizeCollections` convention). Duplicate ids keep the first. */
export function sanitizeSavedSampleProfiles(raw: unknown): SavedSampleProfile[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SavedSampleProfile[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const profile = sanitizeSampleProfile(e.profile);
    if (typeof e.id !== "string" || !e.id || seen.has(e.id) || typeof e.name !== "string" || !e.name.trim() || !profile) continue;
    seen.add(e.id);
    out.push({ id: e.id, name: e.name.trim().slice(0, 120), savedAt: typeof e.savedAt === "string" ? e.savedAt : "", profile });
  }
  return out;
}

/** The backend request shape (`SampleProfileIn`): entered values + units only
 *  — the server recomputes the canonical values itself. */
export function profileWire(profile: SampleProfile): Record<string, { value: number | null; unit: string }> {
  const out: Record<string, { value: number | null; unit: string }> = {};
  for (const f of PROFILE_FIELDS) {
    const q = profile[f];
    out[FIELD_SPECS[f].wire] = { value: q.value !== null && Number.isFinite(q.value) ? q.value : null, unit: q.unit };
  }
  return out;
}
