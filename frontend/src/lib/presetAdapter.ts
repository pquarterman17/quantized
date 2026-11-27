// The preset adapter: the small per-workshop object the shared preset bar
// drives (plans/PRESET_BAR_CONTRACT.md section 6). One `presetAdapter.ts` per
// workshop, next to the hook it reads. Everything generic lives in
// lib/presets.ts and components/workshops/presets/; the adapter only says what
// the workshop's settings ARE (capture / apply / parse) and which of them name
// columns, so rollout is mechanical and `describePresetAdapterContract`
// (presetAdapterContract.testkit.ts) checks every adapter the same way.
//
// Lazy: imported only from a workshop's own lazy chunk, never from eager code.

import type { PresetListing, PresetOutcome } from "./presets";

/** What an Apply did. A skipped field is stated, never silent. */
export type ApplyOutcome =
  | { ok: true; applied: string[]; skipped: { field: string; reason: string }[]; notes: string[] }
  | { ok: false; reason: string };

/** The step from schema n to n+1. `dropped` is the ONLY way a removed setting
 *  is tolerated (the shared code deletes the named keys, and Apply reports
 *  them); `run` reshapes what remains. */
export interface MigrationStep {
  dropped?: readonly string[];
  run?: (old: Record<string, unknown>) => Record<string, unknown>;
}

/** Where a workshop's named presets live (contract section 3): the generic
 *  `qz.presets` file, or a legacy store the workshop already had (Curve Fit's
 *  fit templates). The bar only ever talks to this interface. */
export interface PresetBackend<S extends object> {
  list(): PresetListing<S>;
  /** How this store matches names (default: trimmed, case-insensitive). */
  sameName?: (a: string, b: string) => boolean;
  save(name: string, settings: S): PresetOutcome;
  /** Returns the id the preset has afterwards (a name-keyed store's id IS its name). */
  rename(id: string, name: string): PresetOutcome;
  remove(id: string): PresetOutcome;
}

export interface PresetAdapter<S extends object> {
  /** Omitted: the generic `qz.presets` backend. */
  backend?: PresetBackend<S>;
  /** The id the records carry: "resample", "curvefit", ... */
  workshop: string;
  label: string;
  /** The button that runs the tool ("Create"), for the Apply status line. */
  runLabel: string;
  /** The settings schema this build reads and writes. */
  schema: number;
  /** Keyed by the schema the step upgrades FROM (1 upgrades 1 to 2). */
  migrate?: Readonly<Record<number, MigrationStep>>;
  /** Settings that name a column by LABEL; a label missing on this sheet is skipped (or refuses, if required). */
  columnFields?: readonly (keyof S & string)[];
  /** The user-facing name of a settings field, for messages ("manualLabel" -> "manual error column"). */
  fieldNames?: Readonly<Record<string, string>>;
  /** Fields without which the preset cannot apply (a missing column then refuses the whole Apply). */
  requiredFields?: readonly (keyof S & string)[];
  defaults(): S;
  /** Strict: every key present, known, well typed and in range, or the reason naming the field. */
  parse(raw: unknown): S | { error: string };
  /** Read the panel: what the user set, not what the tool seeded. */
  capture(): S;
  /** Write the panel's draft. Never runs the tool, never commits. */
  apply(settings: S): ApplyOutcome;
  /** One line for the tooltip. */
  describe(settings: S): string;
}

/** Key-order independent JSON of any plain value, nested objects included (to
 *  compare settings: a replacer-array stringify would blank nested keys). */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/** One setting's check: null when fine, else the reason ("must be a whole number of 2 or more"). */
export type FieldCheck = (value: unknown) => string | null;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The strict parser every adapter builds from: each key of `spec` is required,
 *  and any other key is rejected with its name (P6). */
export function parseFields<S extends object>(raw: unknown, spec: { [K in keyof S & string]: FieldCheck }): S | { error: string } {
  if (!isRecord(raw)) return { error: "the settings are not an object" };
  for (const key of Object.keys(raw)) {
    if (!(key in spec)) return { error: `setting '${key}' is not known to this version` };
  }
  const out: Record<string, unknown> = {};
  for (const [key, check] of Object.entries<FieldCheck>(spec)) {
    if (!(key in raw)) return { error: `setting '${key}' is missing` };
    const problem = check(raw[key]);
    if (problem) return { error: `setting '${key}' ${problem}` };
    out[key] = raw[key];
  }
  return out as S;
}

export const checkOneOf = (allowed: readonly string[]): FieldCheck => (v) =>
  typeof v === "string" && allowed.includes(v) ? null : `must be one of ${allowed.join(", ")}`;

export const checkBoolean: FieldCheck = (v) => (typeof v === "boolean" ? null : "must be true or false");

/** A form text field: a string of at most 40 characters that is blank or a finite number passing `extra`. */
export const checkNumberText = (extra?: (n: number) => string | null): FieldCheck => (v) => {
  if (typeof v !== "string") return "must be text";
  if (v.length > 40) return "is too long";
  if (!v.trim()) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return "must be a number";
  return extra ? extra(n) : null;
};

/** The column-by-label rule, written once. Fields in `adapter.columnFields`
 *  whose label is absent from `labels` are skipped with a reason; if one is
 *  also in `requiredFields` the whole Apply is refused (nothing is written). */
export function planColumnFields<S extends object>(
  adapter: Pick<PresetAdapter<S>, "columnFields" | "requiredFields">,
  settings: S,
  labels: readonly string[],
): { skipped: { field: string; reason: string }[] } | { refuse: string } {
  const skipped: { field: string; reason: string }[] = [];
  for (const field of adapter.columnFields ?? []) {
    const label = settings[field];
    if (typeof label !== "string" || label === "" || labels.includes(label)) continue;
    if (adapter.requiredFields?.includes(field)) return { refuse: `column '${label}' (${field}) is not on this sheet` };
    skipped.push({ field, reason: `column '${label}' is not on this sheet` });
  }
  return { skipped };
}
