// Pure helpers for the import wizard workshop (ORIGIN_GAP_PLAN #40). Kept
// separate from the state hook so the array-alignment / label-composition
// logic is unit-testable without React.

import { classifyErrorLabel, inferErrorBindingsFromLabels, type ErrorBinding } from "./errorRoles";
import type {
  ImportColumnRole,
  ImportFilterWire,
  ImportPreviewColumn,
  ImportPreviewResponse,
  ImportSettingsWire,
} from "./types";

/** Mirrors `quantized.io.import_preview.DATA_ROLES` exactly. */
export const IMPORT_COLUMN_ROLES: ImportColumnRole[] = [
  "x",
  "y",
  "error",
  "label",
  "ignore",
  "categorical",
];

/** `<Select>` options for a column's role. */
export const ROLE_OPTIONS: { value: ImportColumnRole; label: string }[] = [
  { value: "x", label: "x (axis)" },
  { value: "y", label: "y" },
  { value: "error", label: "error" },
  { value: "categorical", label: "categorical (text)" },
  { value: "label", label: "label" },
  { value: "ignore", label: "ignore" },
];

/** Named delimiter aliases the wizard offers — mirrors
 *  `import_preview._NAMED_DELIMS`'s user-facing subset (raw literal
 *  delimiters, e.g. a stray `;` typed by hand, still pass straight through
 *  server-side, so this list is a convenience, not an exhaustive contract). */
export const DELIMITER_OPTIONS: { value: string; label: string }[] = [
  { value: "auto", label: "auto-detect" },
  { value: "comma", label: "comma  ," },
  { value: "tab", label: "tab" },
  { value: "semicolon", label: "semicolon  ;" },
  { value: "pipe", label: "pipe  |" },
  { value: "whitespace", label: "whitespace" },
];

/** A fresh starting `ImportSettings` before any file is picked (unused by the
 *  wizard directly — `guess_settings` always supplies the real first value —
 *  but useful as a defensive fallback / test fixture). */
export const EMPTY_IMPORT_SETTINGS: ImportSettingsWire = {
  delimiter: "auto",
  header_line: null,
  units_line: null,
  label_line: null,
  data_start_line: 0,
  column_names: null,
  roles: null,
};

/** The filename's extension including the dot (`"run1.DAT"` -> `".DAT"`), or
 *  `""` if there isn't one. */
export function fileExtension(filename: string): string {
  const m = /\.[^.\\/]+$/.exec(filename);
  return m ? m[0] : "";
}

/** Default "save as filter" name: the filename without its extension. */
export function defaultFilterName(filename: string): string {
  const ext = fileExtension(filename);
  return ext ? filename.slice(0, -ext.length) : filename;
}

/** Default glob for "save as filter": every file sharing this extension. */
export function defaultGlob(filename: string): string {
  const ext = fileExtension(filename);
  return ext ? `*${ext}` : "*";
}

// These three all rebuild their array FROM the live preview's resolved
// `columns` (never from `settings.roles` / `settings.column_names` directly)
// so an edit to ONE column can't silently drop another column's already-
// resolved role/unit — `preview.columns[i]` is the true current value
// (backend-resolved: defaults applied, `units_line` already overlaid, etc.),
// while the raw settings arrays may be `null`, short, or missing the units
// a units_line row supplies. Always send a full, `columns.length`-long array.

/** Roles array (one per `columns` entry) with index `i` set to `role`. */
export function withRole(
  columns: ImportPreviewColumn[],
  index: number,
  role: ImportColumnRole,
): ImportColumnRole[] {
  return columns.map((c, i) => (i === index ? role : c.role));
}

/** `"Name (unit)"` (backend `_extract_units` syntax) or plain `"Name"` when
 *  `unit` is blank. Composing name+unit into one string is required because
 *  `ImportSettings` carries only `column_names` — there is no separate
 *  per-column unit field (see `io/import_preview.py::_parse_core`). */
export function composeColumnLabel(name: string, unit: string): string {
  const n = name.trim() || "Col";
  const u = unit.trim();
  return u ? `${n} (${u})` : n;
}

/** `column_names` array (one per `columns` entry) with index `i` renamed. */
export function withColumnName(
  columns: ImportPreviewColumn[],
  index: number,
  name: string,
): string[] {
  return columns.map((c, i) => composeColumnLabel(i === index ? name : c.name, c.unit));
}

/** `column_names` array (one per `columns` entry) with index `i` re-unit'd. */
export function withColumnUnit(
  columns: ImportPreviewColumn[],
  index: number,
  unit: string,
): string[] {
  return columns.map((c, i) => composeColumnLabel(c.name, i === index ? unit : c.unit));
}

/** Parse a "line index" text field: blank -> `null` (no such line), else the
 *  finite integer, else `null` (an in-progress edit like `"-"` doesn't crash). */
export function parseLineField(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

// ── P1.6: error-role suggestions (item 2) ────────────────────────────────────

/** One column that WILL become a DataStruct channel, in the exact FINAL
 *  order `io/import_preview.py::parse_import` produces it: `y`/`error`
 *  columns first (their original column order), then `categorical` columns
 *  appended after (P1.4's rule) -- `x`/`label`/`ignore` never become
 *  channels. `channel` is that final 0-based index -- the SAME number
 *  `Dataset.errorRoles`' `channel`/`target` mean once the dataset lands, so
 *  a suggestion computed here needs no translation after Import. */
export interface WizardChannel {
  channel: number;
  /** The raw preview column index this channel came from (`columns[i].index`). */
  sourceIndex: number;
  label: string;
}

export function finalChannelOrder(columns: readonly ImportPreviewColumn[]): WizardChannel[] {
  const numeric = columns.filter((c) => c.role === "y" || c.role === "error");
  const categorical = columns.filter((c) => c.role === "categorical");
  return [...numeric, ...categorical].map((c, channel) => ({
    channel,
    sourceIndex: c.index,
    label: c.name,
  }));
}

/** Mirrors `errorRoles.ts`'s private `norm` exactly (kept in sync by hand):
 *  needed here to independently re-derive WHICH inference rule fired for a
 *  binding without reaching into `inferErrorBindingsFromLabels`'s internals
 *  or changing that shared function. */
function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replace(/[\s_]+/g, "");
}

/** True when `labels[errorChannel]` matched via `inferErrorBindingsFromLabels`'
 *  RULE 1 (base-name match, e.g. `dR` -> `R`) or RULE 2 (explicit `x` prefix)
 *  -- a real NAME-driven signal. False means the binding (if any) can only
 *  have come from RULE 3 (nearest preceding column, pure position). */
function isNameDrivenMatch(labels: readonly string[], errorChannel: number): boolean {
  const info = classifyErrorLabel(labels[errorChannel]);
  if (!info) return false;
  if (info.axis === "x") return true; // rule 2
  if (!info.base) return false;
  const isErrorLabel = labels.map((l) => classifyErrorLabel(l) !== null);
  return labels.some((l, i) => !isErrorLabel[i] && normalizeLabel(l) === info.base); // rule 1
}

/** True when some OTHER, non-error channel sits AFTER `channel` in `order`
 *  -- the wizard's own (stricter) bar for "is a pure position-only pairing
 *  actually unambiguous", on top of `inferErrorBindingsFromLabels`' own bar
 *  (which only asks "is there anything valid preceding"). A following
 *  ERROR-role channel doesn't count -- it isn't itself a plausible target. */
function hasFollowingCandidate(
  order: readonly WizardChannel[],
  channel: number,
  errorChannels: ReadonlySet<number>,
): boolean {
  return order.some((c) => c.channel > channel && !errorChannels.has(c.channel));
}

/** Suggested error-role bindings for the CURRENT preview (P1.6 item 2): runs
 *  the SAME name-based inference the rest of the app uses
 *  (`errorRoles.inferErrorBindingsFromLabels`) against the final channel
 *  labels, so `channel`/`target` already mean what `Dataset.errorRoles`
 *  needs -- THEN (review round P1-1) demotes a MULTI-CANDIDATE, POSITION-
 *  ONLY (rule 3) pairing back to "no suggestion": rule 3 alone has no
 *  forward awareness at all, so it always binds to whatever precedes even
 *  when an equally plausible column also FOLLOWS the error column (e.g.
 *  `T1, "T err", T2` bound "T err" to T1 unconditionally, contradicting the
 *  "ambiguous -> ABSENT" claim below). A rule 1 (base-name) or rule 2
 *  (explicit x-prefix) match is NEVER demoted -- those are real name
 *  signals, not positional guesses. A rule-3 pairing with NOTHING plausible
 *  following (value columns only precede the error column) is still a
 *  single-candidate case and stays a real suggestion. This demotion is
 *  SURGICAL to this wizard-seeding layer -- `inferErrorBindingsFromLabels`
 *  itself is untouched and every other consumer keeps its existing,
 *  broader "any preceding column" bar.
 *
 *  Whatever survives: a column whose pairing is genuinely ambiguous is
 *  simply ABSENT from the result (never guessed) -- "no guess can silently
 *  attach error to the wrong signal": these are SUGGESTIONS the wizard
 *  pre-fills into an editable picker, never applied without the user
 *  seeing and confirming them (Import itself is that confirmation, same as
 *  every other wizard field). */
export function suggestErrorBindings(columns: readonly ImportPreviewColumn[]): ErrorBinding[] {
  const order = finalChannelOrder(columns);
  const labels = order.map((c) => c.label);
  const raw = inferErrorBindingsFromLabels(labels);
  const errorChannels = new Set(errorRoleChannels(columns).map((c) => c.channel));
  return raw.filter(
    (b) => isNameDrivenMatch(labels, b.channel) || !hasFollowingCandidate(order, b.channel, errorChannels),
  );
}

/** The channels sourced from an `error`-role column, in final-channel order —
 *  the ONLY rows the error-role editor shows (a `y` channel is never itself
 *  editable as an "error", only ever a TARGET). */
export function errorRoleChannels(columns: readonly ImportPreviewColumn[]): WizardChannel[] {
  const bySource = new Map(columns.map((c) => [c.index, c]));
  return finalChannelOrder(columns).filter((c) => bySource.get(c.sourceIndex)?.role === "error");
}

/** One error-role channel's editable binding. `target: null` means
 *  UNASSIGNED — the suggestion was ambiguous (or the user cleared it) and
 *  nothing is pre-filled; this is the state that makes "never silently
 *  attach" observable: an unassigned row contributes NOTHING to
 *  `confirmedErrorBindings` below. */
export interface WizardErrorRow {
  channel: number;
  label: string;
  target: number | null;
  axis: "x" | "y";
  side: ErrorBinding["side"];
}

/** Seed one `WizardErrorRow` per error-role channel: the inferred
 *  suggestion when `suggestErrorBindings` found one (unambiguous), else
 *  `target: null` (unassigned — never a guessed fallback). */
export function seedErrorRows(columns: readonly ImportPreviewColumn[]): WizardErrorRow[] {
  const suggested = suggestErrorBindings(columns);
  return errorRoleChannels(columns).map((ec) => {
    const s = suggested.find((b) => b.channel === ec.channel);
    return s
      ? { channel: ec.channel, label: ec.label, target: s.target, axis: s.axis, side: s.side }
      : { channel: ec.channel, label: ec.label, target: null, axis: "y" as const, side: "both" as const };
  });
}

/** Only rows the user has actually assigned (`target !== null`) become real
 *  `ErrorBinding`s for `Dataset.errorRoles` — an unassigned row is dropped
 *  silently (the column still imports fine as a plain, unbound channel),
 *  never defaulted to a guessed target. */
export function confirmedErrorBindings(rows: readonly WizardErrorRow[]): ErrorBinding[] {
  const out: ErrorBinding[] = [];
  for (const r of rows) {
    if (r.target !== null) out.push({ channel: r.channel, target: r.target, axis: r.axis, side: r.side });
  }
  return out;
}

/** `<Select>` options for one error row's TARGET picker: the x axis plus
 *  every OTHER channel (a column can't be its own error target). */
export function errorTargetOptions(
  columns: readonly ImportPreviewColumn[],
  forChannel: number,
): { value: number; label: string }[] {
  const options = [{ value: -1, label: "x axis" }];
  for (const c of finalChannelOrder(columns)) {
    if (c.channel !== forChannel) options.push({ value: c.channel, label: c.label });
  }
  return options;
}

// ── P1.6: saved-filter refusal-with-explanation (item 4) ─────────────────────
// Import mappings (saved filters, `ImportFilterWire`/`io.import_filters`) are
// their OWN object -- NOT a Quick Plot template (`store/quickPlotTemplates.ts`
// is a different feature entirely, keyed by technique + channel LABELS
// against a live `Dataset`). This mirrors ONLY the REFUSAL SHAPE/semantics
// (`quickPlotTemplates.resolveTemplate`'s `{ok:true} | {ok:false, unmatched,
// reason}`, all-or-nothing, every unmatched field named) -- no coupling.

export type ImportFilterResolution =
  | { ok: true }
  | { ok: false; unmatched: string[]; reason: string };

/** The name half of a `composeColumnLabel` result ("Temp (K)" -> "Temp"). */
function baseName(composed: string): string {
  return composed.replace(/\s*\([^()]*\)\s*$/, "").trim();
}

/** Split one raw line the same way the resolved delimiter would (a
 *  lightweight mirror of the backend's whitespace-mode special case; exact
 *  parity isn't required for this heuristic). */
function splitRawLine(row: string, delimiter: string): string[] {
  return delimiter === " " ? row.trim().split(/\s+/) : row.split(delimiter);
}

/** True when every non-blank cell of `row` parses as a finite number --
 *  i.e. the row looks like a DATA row, not a legend-label/header/units row.
 *  A blank row (nothing to judge) is NOT "fully numeric". */
function looksFullyNumeric(row: string, delimiter: string): boolean {
  const cells = splitRawLine(row, delimiter)
    .map((c) => c.trim())
    .filter((c) => c !== "");
  return cells.length > 0 && cells.every((c) => Number.isFinite(Number(c)));
}

/** Can `filter`'s saved settings be reapplied cleanly against `fresh` (a
 *  live re-preview of the CURRENT file under the filter's OWN settings) and
 *  `naturalDataStart` (an INDEPENDENT guess of where THIS file's data
 *  actually starts, from `guess_settings`/`importGuess` on its raw text,
 *  ignoring the candidate filter entirely)? Refuses the WHOLE apply (never
 *  a partial one -- the current preview stays exactly as it was) when:
 *
 *  - the saved column COUNT no longer matches (a shorter/longer
 *    `roles`/`column_names` array would otherwise silently truncate or pad
 *    server-side);
 *  - any saved column NAME no longer names the SAME position, named
 *    individually in the refusal;
 *  - LINE-POSITION SANITY (review round P1-2): a saved `header_line`/
 *    `units_line`/`label_line` lands AT OR PAST where THIS file's data
 *    actually starts -- that line is real DATA here, not a header/units/
 *    label row, so applying it would silently swallow a data row as
 *    metadata (the two-file probe: fileA's `label_line`/`data_start_line`
 *    reapplied to fileB, which lacks fileA's extra label row, consumed
 *    fileB's first real data row as the "label" instead of importing it);
 *  - or (the same failure mode from the other direction) the saved
 *    `label_line` row, read from THIS file, itself parses as fully numeric
 *    -- unambiguously data-shaped, not a legend-label row, even in the
 *    rare case the data-start heuristic alone didn't catch it.
 *
 *  A filter that never recorded names (a bare delimiter/line-position
 *  filter) has nothing to name-check and passes THAT check on count alone
 *  -- but still goes through the line-position checks above, since those
 *  don't depend on names at all. */
export function resolveImportFilter(
  filter: ImportFilterWire,
  fresh: ImportPreviewResponse,
  naturalDataStart: number,
): ImportFilterResolution {
  const freshColumns = fresh.columns;
  const savedNames = filter.settings.column_names;
  const savedRoles = filter.settings.roles;
  const savedCount = savedNames?.length ?? savedRoles?.length ?? null;
  if (savedCount !== null && savedCount !== freshColumns.length) {
    return {
      ok: false,
      unmatched: [],
      reason: `saved for ${savedCount} column${savedCount === 1 ? "" : "s"}, this file has ${freshColumns.length} column${freshColumns.length === 1 ? "" : "s"}`,
    };
  }

  const linePositions: [string, number | null][] = [
    ["header", filter.settings.header_line],
    ["units", filter.settings.units_line],
    ["label", filter.settings.label_line],
  ];
  for (const [label, line] of linePositions) {
    if (line !== null && line >= naturalDataStart) {
      return {
        ok: false,
        unmatched: [],
        reason: `saved ${label} line (line ${line}) appears to be data in this file (data starts at line ${naturalDataStart})`,
      };
    }
  }

  const labelLine = filter.settings.label_line;
  if (labelLine !== null && labelLine >= 0 && labelLine < fresh.raw_lines.length) {
    if (looksFullyNumeric(fresh.raw_lines[labelLine], fresh.delimiter)) {
      return {
        ok: false,
        unmatched: [],
        reason: `saved label line (line ${labelLine}) parses as numeric data in this file, not a legend-label row`,
      };
    }
  }

  if (!savedNames) return { ok: true };

  const unmatched: string[] = [];
  savedNames.forEach((saved, i) => {
    const savedBase = baseName(saved);
    const current = freshColumns[i]?.name ?? "";
    if (savedBase && current && savedBase !== current) {
      unmatched.push(`column ${i + 1} ("${savedBase}" → "${current}")`);
    }
  });
  if (unmatched.length > 0) {
    return {
      ok: false,
      unmatched,
      reason: `${unmatched.length} column${unmatched.length === 1 ? "" : "s"} no longer match: ${unmatched.join(", ")}`,
    };
  }
  return { ok: true };
}
