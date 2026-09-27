// Saved transformation recipes (P2.5 box 4) — BEFORE a recipe runs on a
// dataset: bind its expected columns to the target's (by name, rebindable),
// check everything the run would otherwise fail on or get silently wrong, and
// build the working copy laid out like the recording input. Pure.
//
// BINDING. Each expected column (lib/recipeExpect.ts) binds to one of the
// target's columns, to a blank column, or to nothing yet:
//   - by NAME first (trimmed, case-insensitive), each target column once;
//   - an UNREQUIRED position with no name match takes the target's column at
//     the same position when no name match claimed it, else a blank column
//     (the steps never read it — it only holds the layout);
//   - a REQUIRED column with no name match stays unbound: that is the
//     "missing column" refusal until the user binds it.
//
// PREFLIGHT refuses (nothing runs on that dataset) for an unbound or blank
// required column, a required metadata field the dataset lacks, a recorded
// second input (a transform's, or a correction's background) that is not in
// this workspace, a unit mismatch that was not acknowledged, a recipe with
// nothing to run or that would derive nothing (a fit-only analysis template —
// the file batch and the folder run are its paths), and a recipe that applies
// its own corrections to a dataset that already has some (the working copy
// holds the corrected values, so they would stack). It notes (never refuses) a
// step that acts on a recorded dataset rather than this one, a blank filler
// column, corrections already applied to the target, and fit steps (they run,
// but an apply keeps only the derived dataset, not a fit result).
//
// THE WORKING COPY (`conformData`) is the target's rows with the bound columns
// at the recorded positions, then every target column not bound, in order —
// UNLESS the recipe's own in-place steps append a column of their own
// (`addFormula`, `promote`), in which case those extra target columns are
// dropped instead (finding #1): an appended column always lands after EVERY
// base column present at that instant, so keeping them would push the
// appended column past the index a later recorded step addresses. Units and
// names stay the TARGET's own (a rebinding is recorded in the output's
// provenance, never written over the user's column); a blank column takes
// the expected name and unit. Channel-keyed tables (`cat_levels`,
// `level_order`) move with their columns; Origin's per-column name list is
// dropped when the order changed, since it is positional.

import { addedColumnNames, derivesOutput, hasMetadata, inputSegment, editsInPlace, type ExpectedColumn, type RecipeExpectations } from "./recipeExpect";
import type { ErrorBinding } from "./errorRoles";
import type { PipelineStep } from "./pipeline";
import type { ColumnFilter, DataStruct, Dataset } from "./types";

/** A target column index, a blank column, or unbound (null). */
export type Binding = number | "blank" | null;

export type PreflightKind =
  | "missing-column"
  | "blank-required"
  | "unit-mismatch"
  | "missing-metadata"
  | "missing-reference"
  | "no-steps"
  | "no-output"
  | "corrections-conflict"
  | "fit-not-kept"
  | "recorded-input"
  | "blank-column"
  | "corrections";

export interface PreflightIssue {
  kind: PreflightKind;
  text: string;
  /** True: the recipe will not run on this dataset. */
  blocking: boolean;
}

export interface Preflight {
  issues: PreflightIssue[];
  blocked: boolean;
  /** A unit mismatch is present (blocking unless acknowledged). */
  unitMismatch: boolean;
}

const norm = (s: string): string => s.trim().toLowerCase();
const colText = (c: { name: string; unit: string }): string => (c.unit ? `“${c.name}” (${c.unit})` : `“${c.name}”`);

/** The default binding of every expected column against `data` (module doc). */
export function defaultBindings(columns: readonly ExpectedColumn[], data: DataStruct): Binding[] {
  const claimed = new Set<number>();
  const out: Binding[] = columns.map((c) => {
    const j = data.labels.findIndex((l, k) => !claimed.has(k) && norm(l) === norm(c.name));
    if (j < 0) return null;
    claimed.add(j);
    return j;
  });
  return out.map((b, i) => {
    if (b !== null || columns[i].required) return b;
    if (i < data.labels.length && !claimed.has(i)) {
      claimed.add(i);
      return i;
    }
    return "blank";
  });
}

/** A binding still valid for `data` (a stale index — the target changed —
 *  reads as unbound). */
function bound(b: Binding | undefined, data: DataStruct): Binding {
  if (typeof b === "number") return b >= 0 && b < data.labels.length ? b : null;
  return b ?? null;
}

/** Runnable steps: what `executeSteps` actually executes. */
export function runnableSteps(steps: readonly PipelineStep[]): PipelineStep[] {
  return steps.filter((s) => s.enabled && s.kind !== "ui" && s.kind !== "import");
}

interface Ref {
  id: string;
  name: string;
}

const refOf = (v: unknown): Ref | null => {
  const r = (v ?? {}) as Record<string, unknown>;
  return typeof r.id === "string" ? { id: r.id, name: typeof r.name === "string" ? r.name : r.id } : null;
};

/** Recorded dataset references a replay resolves in the workspace (not ones
 *  an earlier step of the recipe creates — those follow the replay). */
function externalRefs(steps: readonly PipelineStep[]): { step: PipelineStep; ref: Ref; isInput: boolean }[] {
  const produced = new Set<string>();
  const out: { step: PipelineStep; ref: Ref; isInput: boolean }[] = [];
  for (const s of steps) {
    const p = s.params;
    // A correction's reference background (`bg: {datasetId}`, executeSteps).
    const bg = s.enabled && s.kind === "correction" ? (p.bg as { datasetId?: unknown } | undefined)?.datasetId : undefined;
    if (typeof bg === "string") out.push({ step: s, ref: { id: bg, name: "its background dataset" }, isInput: false });
    if (!s.enabled || s.kind !== "transform") continue;
    const withRefs = (Array.isArray(p.with) ? p.with : p.with === undefined ? [] : [p.with]).map(refOf);
    for (const r of withRefs) if (r && !produced.has(r.id)) out.push({ step: s, ref: r, isInput: false });
    const input = p.inputIsTarget === false ? refOf(p.input) : null;
    if (input && !produced.has(input.id)) out.push({ step: s, ref: input, isInput: true });
    if (Array.isArray(p.outputs)) for (const o of p.outputs) {
      const r = refOf(o);
      if (r) produced.add(r.id);
    }
  }
  return out;
}

/** Check one dataset against a recipe. `workspaceIds`: every dataset id
 *  currently loaded. */
export function preflightRecipe(
  recipe: { steps: readonly PipelineStep[]; expects?: RecipeExpectations },
  ds: Dataset,
  bindings: readonly Binding[],
  workspaceIds: ReadonlySet<string>,
  ackUnits: boolean,
): Preflight {
  const issues: PreflightIssue[] = [];
  const push = (kind: PreflightKind, text: string, blocking: boolean) => issues.push({ kind, text, blocking });
  const d = ds.data;
  const runnable = runnableSteps(recipe.steps);
  if (!runnable.length) push("no-steps", "the recipe has no steps to run", true);
  else if (!runnable.some((s) => derivesOutput(s) || editsInPlace(s))) {
    push("no-output", "the recipe derives no dataset (a fit-only template: use Batch… or the folder's template run)", true);
  } else if (runnable.some((s) => s.kind === "fit")) {
    push("fit-not-kept", "its fit steps run, but only the derived dataset is kept, not a fit result", false);
  }
  let unitMismatch = false;
  (recipe.expects?.columns ?? []).forEach((c, i) => {
    const b = bound(bindings[i], d);
    if (b === null) {
      push("missing-column", `no column ${colText(c)} — bind one of this dataset's columns to it`, c.required);
    } else if (b === "blank") {
      if (c.required) push("blank-required", `${colText(c)} is bound to a blank column, but a step reads it`, true);
      else push("blank-column", `${colText(c)} is left blank (no step reads it)`, false);
    } else {
      const unit = (d.units[b] ?? "").trim();
      if (c.required && c.unit.trim() && unit && unit !== c.unit.trim()) {
        unitMismatch = true;
        push("unit-mismatch", `“${d.labels[b]}” is in ${unit}; the recipe was recorded with ${colText(c)}`, !ackUnits);
      }
    }
  });
  for (const path of recipe.expects?.metadata ?? []) {
    if (!hasMetadata(ds, path)) push("missing-metadata", `no metadata “${path.join(" › ")}”`, true);
  }
  for (const { step, ref, isInput } of externalRefs(recipe.steps)) {
    if (!workspaceIds.has(ref.id)) {
      push("missing-reference", `“${step.label}” needs “${ref.name}”, which is not in this workspace`, true);
    } else if (isInput) {
      push("recorded-input", `“${step.label}” runs on the recorded dataset “${ref.name}”, not on this one`, false);
    }
  }
  if (ds.corrections) {
    // The working copy holds the CORRECTED values (not `raw`), so a recipe
    // correction would stack on the dataset's own, and a reset undo nothing.
    const corrects = inputSegment(recipe.steps).some((s) => s.kind === "correction" || s.kind === "reset");
    if (corrects) push("corrections-conflict", "this dataset has corrections applied and the recipe applies its own — reset them first", true);
    else push("corrections", "corrections are applied — the recipe runs on the corrected values", false);
  }
  return { issues, blocked: issues.some((x) => x.blocking), unitMismatch };
}

/** True when the working copy would be the target's own layout. */
export function isIdentityBinding(bindings: readonly Binding[]): boolean {
  return bindings.every((b, i) => b === i);
}

/** Whether applying needs a working copy rather than running on the target
 *  itself: a rebinding, or a step that would edit the target in place. */
export function needsWorkingCopy(steps: readonly PipelineStep[], bindings: readonly Binding[]): boolean {
  return !isIdentityBinding(bindings) || inputSegment(steps).some(editsInPlace);
}

export interface Conformed {
  data: DataStruct;
  /** Old channel index → its index in the copy (first occurrence). */
  indexOf: (old: number) => number | null;
}

/** The working copy's data (module doc). `steps`: the recipe's own steps
 *  (finding #1) — when its in-place steps (`addFormula`, `promote`) append
 *  their own columns, each one lands after EVERY base column the dataset
 *  holds at that instant, not at some remembered index. Keeping the target's
 *  own extra columns in the working copy would inflate that base-column
 *  count and shift the appended column past the index a LATER recorded step
 *  addresses (e.g. a stack recorded as `channels: [1, 2]` where 2 is the
 *  recipe's own appended column) — so those extra columns are dropped
 *  instead: nothing recorded reads them, and they never survive into a
 *  recipe that derives a new dataset anyway. Omitted (or when the recipe
 *  appends nothing), the target's extra columns still follow the recorded
 *  layout unchanged, as before. */
export function conformData(
  src: DataStruct,
  columns: readonly ExpectedColumn[],
  bindings: readonly Binding[],
  steps: readonly PipelineStep[] = [],
): Conformed {
  const order: (number | null)[] = columns.map((_, i) => {
    const b = bound(bindings[i], src);
    return typeof b === "number" ? b : null;
  });
  const used = new Set(order);
  if (addedColumnNames(steps).length === 0) {
    for (let j = 0; j < src.labels.length; j++) if (!used.has(j)) order.push(j);
  }
  const first = new Map<number, number>();
  order.forEach((j, i) => j !== null && !first.has(j) && first.set(j, i));
  const identity = order.length === src.labels.length && order.every((j, i) => j === i);
  const moved = <T,>(table: Record<number, T[]> | undefined): Record<number, T[]> | undefined => {
    if (!table) return undefined;
    const out: Record<number, T[]> = {};
    order.forEach((j, i) => {
      if (j !== null && table[j]) out[i] = [...table[j]];
    });
    return Object.keys(out).length ? out : undefined;
  };
  const metadata = { ...src.metadata };
  if (!identity) delete metadata.origin_column_names;
  const { cat_levels: _c, level_order: _l, ...rest } = src;
  const cat = moved(src.cat_levels);
  const lvl = moved(src.level_order);
  const data: DataStruct = {
    ...rest,
    time: [...src.time],
    values: src.values.map((row) => order.map((j) => (j === null ? Number.NaN : (row[j] ?? Number.NaN)))),
    labels: order.map((j, i) => (j === null ? columns[i].name : src.labels[j])),
    units: order.map((j, i) => (j === null ? columns[i].unit : (src.units[j] ?? ""))),
    metadata,
    ...(cat ? { cat_levels: cat } : {}),
    ...(lvl ? { level_order: lvl } : {}),
  };
  return { data, indexOf: (old) => first.get(old) ?? null };
}

/** The target's error-column roles carried onto the working copy (both ends
 *  renumbered; the x axis, -1, stays), so a correction still treats its error
 *  columns as errors. A role whose column is not in the copy is dropped. */
export function conformErrorRoles(roles: readonly ErrorBinding[] | undefined, c: Conformed): ErrorBinding[] | undefined {
  if (!roles) return undefined;
  return roles.flatMap((r) => {
    const channel = c.indexOf(r.channel);
    const target = r.target < 0 ? r.target : c.indexOf(r.target);
    return channel === null || target === null ? [] : [{ ...r, channel, target }];
  });
}

/** The target's row filter carried onto the working copy (columns renumbered;
 *  a predicate on a column the copy lacks cannot happen — every target column
 *  is kept — but is dropped rather than left pointing elsewhere). */
export function conformFilter(filter: readonly ColumnFilter[] | undefined, c: Conformed): ColumnFilter[] | undefined {
  if (!filter?.length) return undefined;
  const out = filter.flatMap((f) => {
    const col = c.indexOf(f.col);
    return col === null ? [] : [{ ...f, col, ...(f.values ? { values: [...f.values] } : {}) }];
  });
  return out.length ? out : undefined;
}
