// The `magnetometry_normalization` record a derived dataset carries
// (MAIN_PLAN #42): everything a save/reopen/recompute needs to reproduce the
// derived values exactly — the source (dataset, channel indices and label),
// every used geometry input with its entered unit and canonical value, the
// basis, the output unit, the factor and the formula. The numbers are the
// BACKEND's (the authority that produced the data).
//
// The stored `profile` is SANITIZED (no NaN, no non-positive values) and
// holds only the fields the calculation used; every other field is blank
// (`value: null`, `canonical: null`) — so the record is JSON-stable and
// compares equal after a .dwk save and reopen.

import {
  FIELD_SPECS,
  PROFILE_FIELDS,
  makeQuantity,
  sanitizeSampleProfile,
  type SampleProfile,
} from "./sampleGeometry";
import type { NormalizationSummary } from "./sampleNormalization";

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

export interface ProvenanceSource {
  datasetId: string;
  datasetName: string;
  /** The plotted x channel index, or null when x is the dataset's time column. */
  xKey: number | null;
  /** The moment channel index the values came from. */
  yKey: number;
  channel: string;
  xUnit: string;
}

/** `profile` reduced to the fields `used`, sanitized. */
export function usedProfile(profile: SampleProfile, used: readonly string[]): SampleProfile {
  const clean = sanitizeSampleProfile(profile) ?? profile;
  const out = { ...clean };
  for (const f of PROFILE_FIELDS) {
    if (!used.includes(f)) out[f] = makeQuantity(f, null, clean[f].unit);
  }
  return out;
}

export function normalizationProvenance(args: {
  profile: SampleProfile;
  summary: NormalizationSummary;
  record: NormalizeRecord;
  source: ProvenanceSource;
  toField: string;
}): Record<string, unknown> {
  const { summary, record, source } = args;
  const profile = usedProfile(args.profile, summary.fields);
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
    source_x_key: source.xKey,
    source_y_key: source.yKey,
    source_channel: source.channel,
  };
}

/** A later field-only conversion (moment untouched) of an already-normalized
 *  dataset: the moment record stays, but its field portion must describe the
 *  NEW x unit, and the conversion is appended to `field_conversions` so the
 *  chain stays reproducible. Returns null when there is no prior record. */
export function withFieldConversion(
  prior: unknown,
  conversion: { from_field: string; to_field: string; source_dataset_id: string; source_dataset_name: string },
): Record<string, unknown> | null {
  if (typeof prior !== "object" || prior === null || Array.isArray(prior)) return null;
  const rec = prior as Record<string, unknown>;
  const chain = Array.isArray(rec.field_conversions) ? rec.field_conversions : [];
  return { ...rec, to_field: conversion.to_field, field_conversions: [...chain, conversion] };
}
