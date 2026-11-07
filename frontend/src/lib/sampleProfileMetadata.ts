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
//      `metadata.instrument.SAMPLE_MASS`), which MultiVu writes in mg. The
//      QD SAMPLE_VOLUME/SAMPLE_SIZE lines carry no unit, so they are not
//      read — a volume is never guessed.

import {
  FIELD_SPECS,
  PROFILE_FIELDS,
  makeQuantity,
  sanitizeSampleProfile,
  type SampleProfile,
} from "./sampleGeometry";

export interface MetadataFill {
  profile: SampleProfile;
  /** Human description of each field that was filled, for the status line. */
  filled: string[];
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** The profile with metadata-stated fields applied, or null when the
 *  metadata states nothing usable. `current` is never mutated. */
export function profileFromMetadata(metadata: Record<string, unknown>, current: SampleProfile): MetadataFill | null {
  const stored = sanitizeSampleProfile(metadata.sample_profile)
    ?? sanitizeSampleProfile(asRecord(metadata.magnetometry_normalization)?.profile);
  if (stored) {
    const next: SampleProfile = { ...current, geometry: stored.geometry };
    const filled: string[] = [];
    for (const f of PROFILE_FIELDS) {
      if (stored[f].value === null) continue;
      next[f] = stored[f];
      filled.push(`${FIELD_SPECS[f].label} ${stored[f].value} ${stored[f].unit}`);
    }
    if (filled.length) return { profile: next, filled };
  }
  const raw = asRecord(metadata.instrument)?.SAMPLE_MASS;
  const mass = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : Number.NaN;
  if (Number.isFinite(mass) && mass > 0) {
    return {
      profile: { ...current, mass: makeQuantity("mass", mass, "mg") },
      filled: [`Sample mass ${mass} mg (Quantum Design SAMPLE_MASS header)`],
    };
  }
  return null;
}
