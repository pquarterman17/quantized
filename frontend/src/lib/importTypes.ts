// Import-wizard wire types — the shapes `routes/import_wizard.py` and
// `routes/import_template.py` exchange with the Import Wizard, extracted
// from lib/types.ts (the lib/reductionTypes.ts precedent, P1.6 PR 1) so the
// error-binding contract could be added without raising types.ts's pinned
// ratchet ceiling. Re-exported from lib/types.ts, so every existing import
// path keeps working.

// ── Import wizard (ORIGIN_GAP_PLAN #40) ─────────────────────────────────────

/** Per-column role (`io/import_preview.DATA_ROLES`): `x` -> axis; `y`/`error` -> DataStruct channels; `categorical` -> a P1.4 categorical channel (string levels preserved); `label`/`ignore` drop from `.values` (`label`'s raw strings still land in `text_columns`, `ignore`'s don't). */
export type ImportColumnRole = "x" | "y" | "error" | "label" | "ignore" | "categorical";

/** One error-column -> signal pairing as persisted on `ImportSettingsWire`
 *  (`quantized.io.import_error_bindings.ErrorBinding.to_dict()`), RAW FILE
 *  COLUMN indexed (`column`/`target` are positions in the delimited file,
 *  like `roles`/`column_names` above), NOT the `channel`-indexed shape
 *  `Dataset.errorRoles`/`./errorRoles.ErrorBinding` uses once a dataset has
 *  been imported -- see that dataclass's docstring for why. `side` uses the SAME
 *  `"both" | "+" | "-"` vocabulary as the post-import `ErrorSide`, so a
 *  binding round-trips import filter -> `DataStruct.metadata["error_roles"]`
 *  -> a `.dwk`'s `Dataset.errorRoles` with nothing to translate. */
export interface ImportErrorBindingWire {
  column: number;
  /** -1 means the dataset's x axis. */
  target: number;
  axis: "x" | "y";
  side: "both" | "+" | "-";
}

/** How to read a delimited file — mirrors `quantized.io.import_preview.
 *  ImportSettings.to_dict()` exactly (also the persistable import-filter shape). */
export interface ImportSettingsWire {
  delimiter: string;
  header_line: number | null;
  units_line: number | null;
  label_line: number | null; // P1.6: legend-label row's cells override each channel's display label; null = header-derived name stands
  data_start_line: number;
  column_names: string[] | null;
  roles: ImportColumnRole[] | null;
  /** P1.6: error-column -> signal bindings, raw-column-indexed. `null`/absent
   *  (the common case, and every settings object saved before this field
   *  existed) means no bindings recorded -- not yet wired into the Import
   *  Wizard UI; present so the wire type doesn't drift from the backend and
   *  a round-tripped saved filter doesn't lose the field if a future UI
   *  slice sets it. */
  error_bindings?: ImportErrorBindingWire[] | null;
  /** P1.6 Part C review finding #2: lifts `parse_import`'s default refusal
   *  of a `categorical` column whose level table exceeds
   *  `import_categorical_guards.MAX_CATEGORICAL_LEVELS` — for a column with
   *  genuinely many levels (real sample IDs, run labels, ...) rather than
   *  one mis-marked categorical. `preview_import` reports the level-cap
   *  problem (`categorical_problems`) either way. Optional/absent (the
   *  common case, and every settings object saved before this field
   *  existed) means `false` — the default refusal still applies. */
  allow_large_categorical?: boolean;
}

/** One resolved column descriptor from `preview_import`. */
export interface ImportPreviewColumn {
  index: number;
  name: string;
  /** P1-5 DEFECT 2: the name this column's channel/label will ACTUALLY
   *  carry once imported -- `name` with any `label_line` override applied
   *  (io/import_preview.py's `_effective_names`, the same rule
   *  `parse_import` uses for `.labels`). Optional on the wire type (older
   *  fixtures / mocked previews may omit it); callers that need the true
   *  post-import name should read `c.effective_name ?? c.name`. Equal to
   *  `name` whenever no `label_line` override applies to this column. */
  effective_name?: string;
  unit: string;
  role: ImportColumnRole;
}

/** `/api/import/preview` response — the wizard's live preview payload. */
export interface ImportPreviewResponse {
  raw_lines: string[];
  n_lines: number;
  delimiter: string;
  header_line: number | null;
  units_line: number | null;
  label_line: number | null;
  data_start_line: number;
  columns: ImportPreviewColumn[];
  rows: (number | null)[][];
  n_data_rows: number;
  n_preview_rows: number;
  comments: string[]; // P1.6 item 3: retained preamble lines not consumed as header/units/label — searchable, never dropped
  /** P1.6 Part A: the SAME `comments` lines, additionally parsed into an
   *  ordered `key -> value` map (`quantized.io.import_metadata.
   *  parse_header_fields`) — strictly additive, never a replacement.
   *  Optional on the wire type (older fixtures / mocked previews may omit
   *  it) -- always present on a live `/api/import/preview` response. */
  header_fields?: Record<string, string>;
  /** P1.6 Part A: keys that appeared more than once in the preamble — the
   *  LAST occurrence's value won (see `header_fields`); each entry names
   *  which key was overwritten. */
  header_field_problems?: ImportHeaderFieldProblem[];
  /** P1.6: the error bindings from `settings` that SURVIVED validation
   *  against this file, echoed back raw-column-indexed. */
  error_bindings?: ImportErrorBindingWire[];
  /** P1.6: bindings this file rejected — each with a `code` and a
   *  human-readable `reason` naming the column. What the wizard shows when a
   *  saved filter's pairings no longer fit the file being imported. */
  error_binding_problems?: ImportErrorBindingProblem[];
  /** P1.6 Part C: structured problems in every `categorical`-role column's
   *  level table (`quantized.io.import_categorical_guards`) — a
   *  `categorical_level_cap` entry means `parse_import` will REFUSE the
   *  import UNLESS the settings sent set `allow_large_categorical`, in which
   *  case the same problem is still reported here but Import proceeds; a
   *  `categorical_case_collision`/`categorical_case_collision_truncated`
   *  entry is informational only (never blocks Import). The backend reports
   *  this field; NOTHING in the frontend reads it yet — there is no
   *  consumer, so today a level-cap refusal surfaces to the user as a raw
   *  422 from Import, not a preflight warning. Wiring a warning/disable
   *  here is the Import Wizard UI slice (not this backend contract).
   *  Optional on the wire type for the same reason as `header_fields`
   *  above. */
  categorical_problems?: ImportCategoricalProblem[];
}

/** One duplicate key found while parsing `header_fields` (P1.6 Part A). */
export interface ImportHeaderFieldProblem {
  type: "duplicate_header_field";
  key: string;
}

/** One structured problem in a `categorical` column's level table (P1.6
 *  Part C), mirroring `quantized.io.import_categorical_guards`'s problem
 *  shapes exactly. `categorical_case_collision_truncated` appears once,
 *  after up to `MAX_CATEGORICAL_COLLISIONS` `categorical_case_collision`
 *  entries for the same column, when that column had more collision groups
 *  than were reported — review finding #1: reported collisions are capped
 *  and truncation is always signalled, never silent. */
export type ImportCategoricalProblem =
  | { type: "categorical_level_cap"; column: string; level_count: number; cap: number }
  | { type: "categorical_case_collision"; column: string; labels: string[] }
  | {
      type: "categorical_case_collision_truncated";
      column: string;
      collision_count: number;
      cap: number;
    };

/** One rejected `ImportErrorBindingWire`, mirroring
 *  `quantized.io.import_error_bindings.DroppedErrorBinding.to_dict()`. */
export interface ImportErrorBindingProblem {
  column: number;
  target: number;
  /** WIDER than `ImportErrorBindingWire`'s union on purpose: a problem echoes
   *  back the value that was REJECTED, which for an `invalid_axis` /
   *  `invalid_side` / `malformed_entry` code is precisely a string outside
   *  the union (`"Y"`, `"plus"`, `""`). Narrowing these would make the type
   *  lie about the one case the field exists to describe. */
  axis: string;
  side: string;
  code: string;
  reason: string;
}

/** A saved, named `ImportSettingsWire` bound to a filename glob
 *  (`io.import_filters.ImportFilter`). */
export interface ImportFilterWire {
  name: string;
  glob: string;
  settings: ImportSettingsWire;
  updated: string;
}
