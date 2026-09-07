// Error-role SUGGESTIONS for the Import Wizard (P1.6 item 2) — which error
// column describes which signal, proposed from column names before the user
// has assigned anything.
//
// Extracted from lib/importwizard.ts (which hit its 500-line ceiling) —
// re-exported from there, so every existing import path still works.
//
// This is the TypeScript half of a CROSS-LANGUAGE PAIR: the Python port in
// `quantized.io.error_binding_suggestions` must agree with it case for case,
// pinned by tests/fixtures/error_labels/suggestion_parity_corpus.json (see
// errorSuggestionParityFixture.gen.test.ts). A change here without the same
// change there reddens both suites — deliberately.

import { flatNorm } from "./errorLabelCandidates";
import { classifyErrorLabelInLabels } from "./errorLabelClassify";
import { inferErrorBindingsFromLabels, type ErrorBinding } from "./errorRoles";
import type { ImportColumnRole, ImportPreviewColumn } from "./types";

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
    // P1-5 DEFECT 2: classify against the EFFECTIVE name (post-label_line
    // override, `preview_import`'s `effective_name`) -- the name the
    // dataset will actually carry once imported -- falling back to the raw
    // header `name` when the field is absent (older/mocked previews).
    label: c.effective_name ?? c.name,
  }));
}

/** True when `labels[errorChannel]` matched via `inferErrorBindingsFromLabels`'
 *  RULE 1 (base-name match, e.g. `dR` -> `R`) or RULE 2 (explicit `x` prefix)
 *  -- a real NAME-driven signal. False means the binding (if any) can only
 *  have come from RULE 3 (nearest preceding column, pure position).
 *
 *  This re-derives WHICH rule fired without reaching into
 *  `inferErrorBindingsFromLabels`'s internals, so it MUST make the same
 *  three decisions the same way it does, or it mislabels a real rule-1
 *  match as positional and `suggestErrorBindings` then drops a suggestion
 *  it promised never to demote. Two things kept that in step (both were
 *  wrong before -- see the independent-review test in importwizard.test.ts):
 *
 *  1. The CLASSIFIER. `inferErrorBindingsFromLabels` decides with the
 *     evidence-gated `classifyErrorLabelInLabels`; this used the
 *     context-free `classifyErrorLabel`, whose own header says it is
 *     "deliberately NOT used for pairing-target-exclusion decisions" --
 *     and `isErrorLabel` below is exactly such a decision, since it picks
 *     which columns are eligible to BE a base. The lax wrapper returns the
 *     top-ranked candidate regardless of evidence, so a provisional-only
 *     label ("Serr": a glued "err" at the edge with no sibling "S") counted
 *     as an error column here but not there, and got wrongly struck off as
 *     a base.
 *  2. The NORMALIZER. `flatNorm` (the same function `errorRoles.ts` compares
 *     with) rather than a hand-synced local copy that had to be kept
 *     identical by discipline alone. */
function isNameDrivenMatch(labels: readonly string[], errorChannel: number): boolean {
  const info = classifyErrorLabelInLabels(labels, errorChannel);
  if (!info) return false;
  if (info.axis === "x") return true; // rule 2
  if (!info.base) return false;
  const isErrorLabel = labels.map((_, i) => classifyErrorLabelInLabels(labels, i) !== null);
  return labels.some((l, i) => !isErrorLabel[i] && flatNorm(l) === info.base); // rule 1
}

/** True when some OTHER, non-error, non-categorical channel sits AFTER
 *  `channel` in `order` -- the wizard's own (stricter) bar for "is a pure
 *  position-only pairing actually unambiguous", on top of
 *  `inferErrorBindingsFromLabels`' own bar (which only asks "is there
 *  anything valid preceding"). A following ERROR-role channel doesn't
 *  count -- it isn't itself a plausible target. Neither does a following
 *  CATEGORICAL (text) channel: `finalChannelOrder` places every categorical
 *  column after every numeric one (P1.4's rule), so a categorical channel
 *  can only ever be a text label a plot legend uses, never something error
 *  bars could sensibly attach to -- treating it as a plausible target
 *  wrongly demoted an otherwise-unambiguous rule-3 pairing to "no
 *  suggestion" whenever a categorical column happened to trail the file. */
function hasFollowingCandidate(
  order: readonly WizardChannel[],
  channel: number,
  errorChannels: ReadonlySet<number>,
  categoricalChannels: ReadonlySet<number>,
): boolean {
  return order.some(
    (c) => c.channel > channel && !errorChannels.has(c.channel) && !categoricalChannels.has(c.channel),
  );
}

/** The channels sourced from a `categorical`-role column, in final-channel
 *  order -- mirrors `errorRoleChannels` below, but for the OTHER role that
 *  is never a plausible error target. */
function categoricalRoleChannels(columns: readonly ImportPreviewColumn[]): WizardChannel[] {
  const bySource = new Map(columns.map((c) => [c.index, c]));
  return finalChannelOrder(columns).filter((c) => bySource.get(c.sourceIndex)?.role === "categorical");
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
  const categoricalChannels = new Set(categoricalRoleChannels(columns).map((c) => c.channel));
  // The x column is NOT a channel (`finalChannelOrder` keeps only y/error/
  // categorical), so its NAME is invisible to `inferErrorBindingsFromLabels`'
  // base-name matching. Without this, `H, M, H_err` with `H` as x had no `H`
  // to match, fell through to rule 3 (nearest preceding value column), and
  // suggested binding H's error to `M` -- a real, silently wrong pairing.
  // A base-name match against the x column's own name resolves to the x axis
  // (`target: -1`) and is a NAME signal, so it is never demoted.
  const xLabel = columns.find((c) => c.role === "x");
  const xBase = xLabel ? flatNorm(xLabel.effective_name ?? xLabel.name) : null;
  const byChannel = new Map(raw.map((b) => [b.channel, b]));
  const out: ErrorBinding[] = [];
  for (const c of order) {
    if (isNameDrivenMatch(labels, c.channel)) {
      const b = byChannel.get(c.channel);
      if (b) out.push(b);
      continue;
    }
    const info = classifyErrorLabelInLabels(labels, c.channel);
    if (info === null) continue;
    if (info.base && xBase && info.base === xBase) {
      out.push({ channel: c.channel, target: -1, axis: "x", side: info.side });
      continue;
    }
    const b = byChannel.get(c.channel);
    if (b && !hasFollowingCandidate(order, c.channel, errorChannels, categoricalChannels)) {
      out.push(b);
    }
  }
  // A suggestion's TARGET must be able to become a real `y` channel, or `-1`
  // (the x axis). `inferErrorBindingsFromLabels` has no notion of role, so its
  // base-name rule can land a target on a `categorical` column (`Cat_err` ->
  // `Cat`) — the backend's `valid_error_bindings` then rejects it as
  // `target_not_y_role`, so suggesting it only ever wastes the user's click.
  const yChannels = new Set(
    order.filter((c) => bySourceRole(columns, c.sourceIndex) === "y").map((c) => c.channel),
  );
  return out.filter((b) => b.target === -1 || yChannels.has(b.target));
}

function bySourceRole(
  columns: readonly ImportPreviewColumn[],
  sourceIndex: number,
): ImportColumnRole | undefined {
  return columns.find((c) => c.index === sourceIndex)?.role;
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
