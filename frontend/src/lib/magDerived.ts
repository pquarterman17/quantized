// Derived magnetic quantities (OPEN_ITEMS row 36): the pure half. Which
// applied field a susceptibility divides by, which committed uncertainty may be
// propagated, and the worksheet that records it. The arithmetic and unit
// factors are the backend's (`calc/magnetic_derived_quantities.py`).
//
// Decisions (provisional, owner to confirm):
//  * The field is DECLARED, never guessed: the Y's own X axis when that is a
//    field (M(H)), else a field column the user picks (M(T) at fixed field).
//  * Only SYMMETRIC (+/-) committed uncertainty is propagated: for chi = M/H the
//    sign of H swaps the asymmetric sides row by row, which one error role
//    cannot express, so asymmetric bars are refused rather than misreported.
//    Field uncertainty must be in the field's unit. Sample quantities exact.
//  * Output rows align with the source worksheet (every row, as the Units tab
//    does); a row without a finite response or a nonzero finite field is a gap.

import type { ErrorBinding } from "./errorRoles";
import { detectMagXKind, magXAxis } from "./magDataKind";
import { ownXKey } from "./perSeriesX";
import type { Dataset } from "./types";

const FIELD_UNITS = new Set(["Oe", "T", "mT", "A/m"]);

export interface FieldChoice { kind: "x" | "column"; index: number | null; label: string; unit: string }

/** The applied-field sources of this response: its own X when a declared field, plus field columns. */
export function fieldChoices(ds: Dataset, xKey: number | null, yKey: number): FieldChoice[] {
  const out: FieldChoice[] = [];
  const own = ownXKey(ds, xKey, yKey);
  const axis = magXAxis(ds.data, own);
  if (detectMagXKind(axis.label, axis.unit).kind === "field" && FIELD_UNITS.has(axis.unit)) {
    out.push({ kind: "x", index: own, label: axis.label || "X axis", unit: axis.unit });
  }
  const errorChannels = (ds.errorRoles ?? []).map((r) => r.channel);
  ds.data.labels.forEach((label, index) => {
    const unit = ds.data.units[index] ?? "";
    if (index === yKey || index === own || errorChannels.includes(index)) return;
    if (FIELD_UNITS.has(unit) && detectMagXKind(label, unit).kind === "field") out.push({ kind: "column", index, label, unit });
  });
  return out;
}

/** The field row values and the committed roles that describe their uncertainty. */
export function fieldValues(ds: Dataset, choice: FieldChoice, xKey: number | null, yKey: number): { values: number[]; roles: ErrorBinding[] } {
  const own = ownXKey(ds, xKey, yKey);
  const values = choice.kind === "x"
    ? ds.data.time.map((t, r) => (own === null ? t : (ds.data.values[r]?.[own] ?? Number.NaN)))
    : ds.data.values.map((row) => row[choice.index!] ?? Number.NaN);
  const all = (ds.errorRoles ?? []).filter((r) => r.channel >= 0 && r.channel < ds.data.labels.length);
  const roles = choice.kind === "x"
    ? all.filter((r) => r.axis === "x" && (r.target === -1 ? own === null : r.target === own))
    : all.filter((r) => r.axis === "y" && r.target === choice.index);
  return { values, roles: roles.filter((r, i, a) => a.findIndex((o) => o.channel === r.channel) === i) };
}

/** Why committed uncertainty cannot be propagated exactly, or null. */
export function uncertaintyProblem(ds: Dataset, yRoles: readonly ErrorBinding[], fieldRoles: readonly ErrorBinding[], yUnit: string, fieldUnit: string): string | null {
  if ([...yRoles, ...fieldRoles].some((r) => r.side !== "both")) {
    return "The committed uncertainty is asymmetric (+/-); the sign of the field swaps its sides row by row, so only symmetric uncertainty is propagated. Nothing was created.";
  }
  const bad = (roles: readonly ErrorBinding[], unit: string): ErrorBinding | undefined =>
    roles.find((r) => (ds.data.units[r.channel] ?? "") !== "" && ds.data.units[r.channel] !== unit);
  const y = bad(yRoles, yUnit);
  if (y) return `The response uncertainty column "${ds.data.labels[y.channel]}" is in ${ds.data.units[y.channel]}, not ${yUnit}; convert it first.`;
  const f = bad(fieldRoles, fieldUnit);
  if (f) return `The field uncertainty column "${ds.data.labels[f.channel]}" is in ${ds.data.units[f.channel]}, not ${fieldUnit}; convert it first.`;
  return null;
}
