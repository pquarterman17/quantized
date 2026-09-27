// Saved transformation recipes (PRIMARY_SOFTWARE_AUDIT_PLAN P2.5, box 4) —
// WHAT A RECIPE EXPECTS OF THE DATASET IT IS APPLIED TO.
//
// A transformation recipe is an analysis template (lib/template.ts: a named,
// versioned list of recorded pipeline steps) that also declares its input:
// the recording input's column layout, which of those columns the steps
// actually read, their units, and the metadata fields they read. Pure.
//
// WHY A LAYOUT AND NOT A LIST OF NAMES. Recorded steps address columns by
// POSITION: an expression's letters (A = channel 0), a stack's `channels`, an
// unstack's key/category/value, a join's numeric key, a split's `col`, a fit's
// `yKey`/`xKey`. And a later step addresses columns of an EARLIER step's
// output, whose layout follows the input's. So applying a recipe to a dataset
// whose columns differ is done by building a working copy laid out like the
// recording input (lib/recipePreflight.ts's `conformData`) — every recorded
// index, in every later step, then means what it meant when recorded.
// Remapping the indices inside each step instead would only fix the steps
// that read the input directly, not the ones reading derived outputs.
//
// WHICH COLUMNS ARE REQUIRED. Only what the steps that read the INPUT itself
// reference: every enabled step up to and including the first step that
// derives a new dataset (later steps read that output). A whole-table op
// (transpose, append by position, dataset math) requires every column. The
// layout stops at the last required column; the target's other columns follow
// it unchanged in the working copy.
//
// THE EXAMPLE MAY ALREADY CARRY THE RECIPE'S OWN COLUMNS. Recording "add
// column d = A*2" leaves `d` on the recording dataset; read naively it would
// become an input the recipe needs. When the example's trailing computed
// columns are exactly the ones the recipe adds, in order, they are left out.

import { referencedColumns } from "./formula";
import { metaValue, isPresent, type MetaPath } from "./metadataKeys";
import type { PipelineStep } from "./pipeline";
import type { Dataset } from "./types";

export interface ExpectedColumn {
  name: string;
  unit: string;
  /** A step reads this column. Unrequired positions only keep the layout. */
  required: boolean;
}

export interface RecipeExpectations {
  /** The recording input's layout, channel 0 first, up to the last required. */
  columns: ExpectedColumn[];
  /** Metadata fields the steps read (a promoted factor's path). */
  metadata: MetaPath[];
  /** The dataset the expectations were read from (display only). */
  example?: string;
}

/** Ops that edit their dataset in place (lib/metadataRun.ts's IN_PLACE_OPS —
 *  repeated as two literals so this pure module stays light). */
const IN_PLACE = new Set(["promote", "metaclean"]);

/** A step that edits the dataset it runs on rather than deriving a new one. */
export function editsInPlace(step: PipelineStep): boolean {
  if (step.kind === "transform") return IN_PLACE.has(String(step.params.op));
  return step.kind === "expression" || step.kind === "correction" || step.kind === "reset";
}

/** A step that derives a new dataset (later steps continue on it). */
export function derivesOutput(step: PipelineStep): boolean {
  return step.kind === "transform" && !IN_PLACE.has(String(step.params.op));
}

/** The enabled steps that read the recipe's input: up to and including the
 *  first that derives a new dataset. */
export function inputSegment(steps: readonly PipelineStep[]): PipelineStep[] {
  const out: PipelineStep[] = [];
  for (const s of steps) {
    if (!s.enabled) continue;
    out.push(s);
    if (derivesOutput(s)) break;
  }
  return out;
}

/** 0-based channel index of a formula letter ("A" → 0, "AA" → 26), or null. */
export function letterIndex(name: string): number | null {
  if (!/^[A-Z]+$/.test(name)) return null;
  let n = 0;
  for (const ch of name) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const ints = (v: unknown): number[] =>
  (Array.isArray(v) ? v : [v]).filter((x): x is number => typeof x === "number" && Number.isInteger(x));

/** The input columns the steps read: `all`, or the channel indices. */
export function inputColumnRefs(steps: readonly PipelineStep[]): { all: boolean; cols: Set<number> } {
  const cols = new Set<number>();
  const add = (v: unknown) => ints(v).forEach((c) => c >= 0 && cols.add(c));
  for (const s of inputSegment(steps)) {
    const p = s.params;
    if (s.kind === "expression") {
      const { letters, valid } = referencedColumns(String(p.expr ?? ""));
      if (!valid) return { all: true, cols };
      for (const l of letters) add(letterIndex(l));
    } else if (s.kind === "fit") {
      // A legacy {model}-only step fits values[0] (executeSteps).
      add(typeof p.yKey === "number" ? p.yKey : 0);
      add(p.xKey);
      add((p.weight as { errKey?: unknown } | undefined)?.errKey); // a weighted fit's σ column
    } else if (derivesOutput(s)) {
      if (p.inputIsTarget === false) break; // reads a recorded dataset, not this one
      switch (String(p.op)) {
        case "transpose":
        case "algebra":
          return { all: true, cols };
        case "merge":
          if (p.match !== "name") return { all: true, cols };
          break;
        case "stack": add(p.channels); break;
        case "unstack": add([p.key, p.category, p.value]); break;
        case "join": add(p.leftKey); break; // a text key is a sidecar name, not a channel
        case "split": add(p.col); break;
        default: break; // resample reads every channel but needs none of them
      }
    }
  }
  return { all: false, cols };
}

/** The names of the columns the recipe's own in-place steps append, in order.
 *  Exported for lib/recipePreflight.ts's `conformData` (finding #1): an
 *  in-place step (`addFormula`, `promote`) always lands its new column after
 *  EVERY base column the dataset holds at that moment, so a working copy that
 *  also carries the target's own extra columns would shift that landing past
 *  the index a later recorded step addresses. */
export function addedColumnNames(steps: readonly PipelineStep[]): string[] {
  return inputSegment(steps).flatMap((s) =>
    s.kind === "expression" || (s.kind === "transform" && s.params.op === "promote") ? [String(s.params.name ?? "")] : [],
  );
}

/** The metadata paths the steps read (every enabled promote step). */
function metadataRefs(steps: readonly PipelineStep[]): MetaPath[] {
  const seen = new Set<string>();
  const out: MetaPath[] = [];
  for (const s of steps) {
    const path = s.params.path;
    if (!s.enabled || s.kind !== "transform" || s.params.op !== "promote" || !Array.isArray(path)) continue;
    const p = path.filter((k): k is string => typeof k === "string");
    const key = JSON.stringify(p);
    if (p.length && !seen.has(key)) {
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

/** Read a recipe's expectations off `example`, the dataset it was recorded
 *  on (or one laid out like it). */
export function deriveExpectations(steps: readonly PipelineStep[], example: Dataset): RecipeExpectations {
  const d = example.data;
  const added = addedColumnNames(steps);
  const formulas = (example.formulas ?? []).map((f) => f.name);
  const tail = formulas.slice(formulas.length - added.length);
  const own = added.length > 0 && tail.length === added.length && tail.every((n, i) => n === added[i]);
  const width = d.labels.length - (own ? added.length : 0);
  const refs = inputColumnRefs(steps);
  const inRange = [...refs.cols].filter((c) => c < width);
  const last = refs.all ? width - 1 : inRange.length ? Math.max(...inRange) : -1;
  const columns = d.labels.slice(0, last + 1).map((name, i) => ({
    name,
    unit: d.units[i] ?? "",
    required: refs.all || refs.cols.has(i),
  }));
  return { columns, metadata: metadataRefs(steps), example: example.name };
}

/** Validate an expectations block read from storage, a file or a `.dwk`
 *  (user-editable JSON): undefined when absent or malformed. */
export function sanitizeExpectations(v: unknown): RecipeExpectations | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.columns) || !Array.isArray(o.metadata)) return undefined;
  const columns: ExpectedColumn[] = [];
  for (const c of o.columns) {
    const r = (c ?? {}) as Record<string, unknown>;
    if (typeof r.name !== "string" || typeof r.unit !== "string" || typeof r.required !== "boolean") return undefined;
    columns.push({ name: r.name, unit: r.unit, required: r.required });
  }
  const metadata: MetaPath[] = [];
  for (const p of o.metadata) {
    if (!Array.isArray(p) || !p.length || !p.every((k) => typeof k === "string")) return undefined;
    metadata.push([...(p as string[])]);
  }
  return { columns, metadata, ...(typeof o.example === "string" ? { example: o.example } : {}) };
}

/** "M (emu), T (K)" — the required columns, for a one-line summary. */
export function expectationsText(e: RecipeExpectations | undefined): string {
  if (!e) return "no declared input";
  const cols = e.columns.filter((c) => c.required).map((c) => (c.unit ? `${c.name} (${c.unit})` : c.name));
  const meta = e.metadata.map((p) => p.join(" › "));
  const parts = [cols.length ? `columns ${cols.join(", ")}` : "no specific columns"];
  if (meta.length) parts.push(`metadata ${meta.join(", ")}`);
  return parts.join("; ");
}

/** The dataset a recording most likely ran on: the first deriving step's
 *  recorded input (when it was the pipeline target and is still loaded),
 *  else `fallback` (the active dataset). */
export function recordingInputId(
  steps: readonly PipelineStep[],
  loaded: ReadonlySet<string>,
  fallback: string | null,
): string | null {
  const first = inputSegment(steps).find(derivesOutput);
  const input = first?.params.inputIsTarget === false ? undefined : (first?.params.input as { id?: unknown } | undefined);
  return typeof input?.id === "string" && loaded.has(input.id) ? input.id : fallback;
}

/** Whether `ds` carries the metadata field at `path`. */
export function hasMetadata(ds: Dataset, path: MetaPath): boolean {
  return isPresent(metaValue(ds.data.metadata, path));
}
