// "Use metadata values" for the sample profile (MAIN_PLAN #42) — an EXPLICIT
// user action, never run on its own. It fills only the fields the dataset's
// metadata actually states, leaves every other field as the user left it,
// and never picks a normalization basis (that stays the user's choice).
//
// Recognised sources, in order:
//   1. `metadata.sample_profile` — a SampleProfile written by this app;
//   2. `metadata.magnetometry_normalization.profile` — the profile a derived
//      dataset recorded when it was normalized;
//   3. Quantum Design `INFO,<value>,SAMPLE_MASS` header lines (parsed into
//      `metadata.instrument.SAMPLE_MASS`, a bare string). The file states NO
//      unit for it. MultiVu's sample-info dialog takes mass in mg, so it is
//      filled as mg — an ASSUMPTION, not a fact from the file, and the status
//      line says so and asks the user to verify. It is refused outright when
//      the header's MOMENT_UNITS line is present and not "0" (the value in
//      emu files) or the moment channel is already SI (A·m²), because then
//      nothing supports the mg reading. The QD SAMPLE_VOLUME/SAMPLE_SIZE
//      lines are never read — a volume is never guessed.
//
// The stored profile's geometry path is adopted only when that profile also
// states a value for the path's own size fields (`GEOMETRY_FIELDS`), so a
// mass-only profile cannot flip the user's chosen geometry.

import {
  FIELD_SPECS,
  GEOMETRY_FIELDS,
  PROFILE_FIELDS,
  isSampleGeometry,
  makeQuantity,
  sanitizeSampleProfile,
  type SampleProfile,
} from "./sampleGeometry";
import { GEOMETRY_LABELS } from "./sampleNormalization";

export type MetadataFill =
  | { kind: "fill"; profile: SampleProfile; filled: string[] }
  | { kind: "refused"; reason: string };

const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

function fromStoredProfile(raw: unknown, current: SampleProfile): MetadataFill | null {
  const stored = sanitizeSampleProfile(raw);
  if (!stored) return null;
  const next: SampleProfile = { ...current };
  const filled: string[] = [];
  for (const f of PROFILE_FIELDS) {
    if (stored[f].value === null) continue;
    next[f] = stored[f];
    filled.push(`${FIELD_SPECS[f].label} ${stored[f].value} ${stored[f].unit}`);
  }
  if (!filled.length) return null;
  // `sanitizeSampleProfile` defaults an invalid geometry to "rectangle", so
  // validity is judged on the RAW value, never on the sanitized one.
  const rawGeometry = asRecord(raw)?.geometry;
  if (isSampleGeometry(rawGeometry) && rawGeometry !== current.geometry
    && GEOMETRY_FIELDS[rawGeometry].some((f) => stored[f].value !== null)) {
    next.geometry = rawGeometry;
    filled.push(`sample geometry changed to ${GEOMETRY_LABELS[rawGeometry]}`);
  }
  return { kind: "fill", profile: next, filled };
}

/** The profile with metadata-stated fields applied, a refusal naming why a
 *  present value could not be used, or null when nothing usable is stated.
 *  `momentUnit` is the plotted moment channel's unit. `current` is never
 *  mutated. */
export function profileFromMetadata(
  metadata: Record<string, unknown>, current: SampleProfile, momentUnit = "",
): MetadataFill | null {
  const stored = fromStoredProfile(metadata.sample_profile, current)
    ?? fromStoredProfile(asRecord(metadata.magnetometry_normalization)?.profile, current);
  if (stored) return stored;
  const instrument = asRecord(metadata.instrument);
  const raw = instrument?.SAMPLE_MASS;
  const mass = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : Number.NaN;
  if (!(Number.isFinite(mass) && mass > 0)) return null;
  const momentUnits = instrument?.MOMENT_UNITS;
  if (momentUnits !== undefined && String(momentUnits).trim() !== "0") {
    return {
      kind: "refused",
      reason: `The Quantum Design header has SAMPLE_MASS ${String(raw)} with no unit, and MOMENT_UNITS is "${String(momentUnits)}" rather than "0" (the value in emu files), so its mass unit cannot be assumed. Nothing was filled; enter the mass by hand.`,
    };
  }
  if (momentUnit === "A·m²") {
    return {
      kind: "refused",
      reason: `The Quantum Design header has SAMPLE_MASS ${String(raw)} with no unit, and the moment is in SI (A·m²), so its mass unit cannot be assumed. Nothing was filled; enter the mass by hand.`,
    };
  }
  return {
    kind: "fill",
    profile: { ...current, mass: makeQuantity("mass", mass, "mg") },
    filled: [`Sample mass ${mass} mg from the Quantum Design SAMPLE_MASS header — the file states no unit, mg is assumed; verify it`],
  };
}
