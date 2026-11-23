// Restore a recorded sample profile (lane RO3, "Open in Units"). A Units result
// records the profile in the backend's wire shape (`profileWire`: entered value
// + unit per field) plus the chosen geometry; reopening rebuilds the form from
// it. Fail closed: an unknown unit, a malformed field or an unknown geometry
// refuses the whole profile (null), never a guessed or half-filled one.

import {
  FIELD_SPECS, PROFILE_FIELDS, SAMPLE_PROFILE_VERSION, isSampleGeometry, makeQuantity, normalizeUnitSpelling,
  type ProfileField, type SampleProfile,
} from "./sampleGeometry";

export function profileFromRecord(raw: unknown, geometry: unknown): SampleProfile | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw) || !isSampleGeometry(geometry)) return null;
  const record = raw as Record<string, unknown>;
  const out = { version: SAMPLE_PROFILE_VERSION, geometry } as SampleProfile;
  for (const field of PROFILE_FIELDS satisfies readonly ProfileField[]) {
    const spec = FIELD_SPECS[field];
    const entry = record[spec.wire];
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
    const { value, unit } = entry as Record<string, unknown>;
    if (typeof unit !== "string" || !spec.units.includes(normalizeUnitSpelling(unit))) return null;
    if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) return null;
    out[field] = makeQuantity(field, value, normalizeUnitSpelling(unit));
  }
  return out;
}
