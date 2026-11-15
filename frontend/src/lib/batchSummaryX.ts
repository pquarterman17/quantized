// The X of a batch summary worksheet (curve-fit batch, peak-model batch,
// analysis-template batch): the input's position (1, 2, ...), or a physical
// parameter of each input, so a fitted tau, Hc or peak centre plots against
// temperature or field directly (Origin's batch summaries carry the file's
// info variables and user parameters). Pure.
//
// SOURCES, all existing readers: a metadata field (`metaValue` +
// `parseQuantity`, as batch integration's trend does: "300 K" is 300 with
// unit K), a user-parameter row (`metadata.label_rows`, `userParamRows`; the
// number is `firstNumber`'s, as the gradient's "Number in legend"), or the
// first number in the input's name (`firstNumber`).
//
// FAIL CLOSED. An input with no value for the chosen source gets a BLANK X
// (NaN), is listed in `missing` with the reason (the caller reports it), and
// is never given a guessed value: not its position, not another field's.
// Sorting by X is the user's choice (`sort`); blank-X rows go last, and the
// sort is stable so equal X keep their input order.

import { firstNumber } from "./firstNumber";
import { parseQuantity } from "./metadataCleanup";
import { isPresent, keysAcross, metaValue, pathLabel, type MetaPath } from "./metadataKeys";
import { userParamRows } from "./userParams";

export type SummaryXSource =
  | { kind: "index" }
  | { kind: "name" }
  | { kind: "meta"; path: MetaPath }
  | { kind: "param"; name: string };

export interface SummaryXChoice {
  source: SummaryXSource;
  /** Order the summary rows by X (off: the inputs' own order). */
  sort: boolean;
}

export const INDEX_X: SummaryXChoice = { source: { kind: "index" }, sort: false };

/** What a summary needs to know about one input. */
export interface SummaryXInput {
  name: string;
  metadata?: Record<string, unknown>;
  labels?: readonly string[];
}

export interface SummaryXResult {
  /** The X per OUTPUT row (NaN = blank). */
  x: number[];
  /** `order[k]` is the input index that output row `k` shows. */
  order: number[];
  xName: string;
  xUnit: string;
  /** "name: why" for every input left blank. */
  missing: string[];
  /** How the X was chosen, for the summary's provenance. */
  how: string;
}

type Read = { n: number; unit: string } | { why: string };

function readMeta(i: SummaryXInput, path: MetaPath): Read {
  if (path.length === 0) return { why: "no metadata field is named" };
  const v = metaValue(i.metadata, path);
  if (!isPresent(v)) return { why: `no ${pathLabel(path)}` };
  const q = parseQuantity(v);
  return "error" in q ? { why: `${pathLabel(path)} "${String(v)}" ${q.error}` } : q;
}

function readName(i: SummaryXInput): Read {
  const n = firstNumber(i.name);
  return n === null ? { why: "no number in its name" } : { n, unit: "" };
}

function readParam(i: SummaryXInput, name: string): Read {
  if (!name.trim()) return { why: "no parameter is named" };
  const row = userParamRows({ metadata: i.metadata ?? {}, labels: i.labels }).find((r) => r.name === name);
  const cells = (row?.cells ?? []).map((c) => c.trim()).filter(Boolean);
  if (cells.length === 0) return { why: `no value for parameter "${name}"` };
  const reads: ({ n: number; unit: string } | null)[] = cells.map((c) => {
    const n = firstNumber(c);
    if (n === null) return null;
    const q = parseQuantity(c);
    return { n, unit: "unit" in q ? q.unit : "" };
  });
  const bad = reads.indexOf(null);
  if (bad >= 0) return { why: `parameter "${name}" is not a number ("${cells[bad]}")` };
  const first = reads[0]!;
  // One summary row, several channels: the value must not depend on which.
  if (reads.some((r) => r!.n !== first.n)) return { why: `parameter "${name}" differs between columns` };
  return first;
}

function labelOf(s: SummaryXSource): string {
  if (s.kind === "index") return "Input";
  if (s.kind === "name") return "Number in name";
  return s.kind === "meta" ? pathLabel(s.path) : s.name;
}

/** The summary X for `inputs` (one per summary row), per `choice`. */
export function summaryX(inputs: readonly SummaryXInput[], choice: SummaryXChoice): SummaryXResult {
  const s = choice.source;
  const missing: string[] = [];
  let xs: number[];
  let xUnit = "";
  if (s.kind === "index") {
    xs = inputs.map((_, k) => k + 1);
  } else {
    const reads = inputs.map((i) => (s.kind === "meta" ? readMeta(i, s.path) : s.kind === "name" ? readName(i) : readParam(i, s.name)));
    // Values must share one unit: the most common one is the column's, and a
    // row in another unit is left blank (never converted by guess).
    const units = reads.flatMap((r) => ("n" in r && r.unit ? [r.unit] : []));
    const votes = (u: string) => units.filter((x) => x === u).length;
    xUnit = units.reduce((best, u) => (votes(u) > votes(best) ? u : best), units[0] ?? "");
    xs = reads.map((r, k) => {
      if ("why" in r) {
        missing.push(`${inputs[k]!.name}: ${r.why}`);
        return Number.NaN;
      }
      if (r.unit && r.unit !== xUnit) {
        missing.push(`${inputs[k]!.name}: unit ${r.unit} differs from ${xUnit}`);
        return Number.NaN;
      }
      return r.n;
    });
  }
  const order = inputs.map((_, k) => k);
  if (choice.sort) {
    const key = (k: number) => (Number.isFinite(xs[k]!) ? xs[k]! : Infinity);
    order.sort((a, b) => (key(a) === key(b) ? a - b : key(a) < key(b) ? -1 : 1));
  }
  const how = s.kind === "index" ? "input order" : s.kind === "name" ? "first number in the name" : s.kind === "meta" ? `metadata ${pathLabel(s.path)}` : `parameter ${s.name}`;
  return {
    x: order.map((k) => xs[k]!), order, xName: labelOf(s), xUnit, missing,
    how: `${how}${choice.sort ? ", sorted by X" : ""}`,
  };
}

/** The numeric metadata fields at least one input carries (for a picker). */
export function numericMetaFields(inputs: readonly { id: string; data: { metadata: Record<string, unknown> } }[]): { path: MetaPath; label: string }[] {
  return keysAcross(inputs)
    .filter((f) => inputs.some((d) => {
      const v = metaValue(d.data.metadata, f.path);
      return isPresent(v) && !("error" in parseQuantity(v));
    }))
    .map((f) => ({ path: f.path, label: f.label }));
}

/** The user-parameter names any input carries, in first-seen order. */
export function paramNamesOf(inputs: readonly { data: { metadata: Record<string, unknown>; labels: readonly string[] } }[]): string[] {
  const out: string[] = [];
  for (const d of inputs) for (const r of userParamRows(d.data)) if (!out.includes(r.name)) out.push(r.name);
  return out;
}

/** The part of a summary worksheet's metadata that records the X choice. */
export function summaryXMeta(r: SummaryXResult): Record<string, unknown> {
  return {
    x_column_name: r.xName,
    x_column_unit: r.xUnit,
    summaryX: { how: r.how, missing: r.missing },
  };
}

/** `items` in the result's output order. */
export function inOrder<T>(items: readonly T[], r: SummaryXResult): T[] {
  return r.order.map((k) => items[k]!);
}

/** One line for the status bar: where X came from and which rows are blank. */
export function summaryXNote(r: SummaryXResult): string {
  if (r.how.startsWith("input order") && r.missing.length === 0) return "";
  const blank = r.missing.length ? `; ${r.missing.length} left blank (${r.missing.join("; ")})` : "";
  return `X = ${r.xName}${r.xUnit ? ` (${r.xUnit})` : ""}${blank}`;
}

// ── typed form (a batch whose inputs are not loaded when the X is chosen) ──

export const X_FROM_OPTIONS = ["Input order", "Number in the name", "Metadata field", "Parameter row"];

/** The three ParamDialog fields that choose a summary X (lib/params shape). */
export function xParamFields(): { key: string; label: string; type: "select" | "text" | "boolean"; default: string | boolean; options?: string[]; hint?: string; placeholder?: string }[] {
  return [
    { key: "xFrom", label: "Summary X from", type: "select", default: X_FROM_OPTIONS[0]!, options: X_FROM_OPTIONS },
    { key: "xName", label: "Field or parameter name", type: "text", default: "", placeholder: "e.g. Temperature",
      hint: "for Metadata field / Parameter row; an input without it is left blank" },
    { key: "xSort", label: "Sort rows by X", type: "boolean", default: false },
  ];
}

/** The choice the `xParamFields` answers describe. */
export function xChoiceFromParams(v: Record<string, number | string | boolean>): SummaryXChoice {
  const from = String(v["xFrom"] ?? "");
  const name = String(v["xName"] ?? "").trim();
  const source: SummaryXSource = from === X_FROM_OPTIONS[1] ? { kind: "name" }
    : from === X_FROM_OPTIONS[2] ? { kind: "meta", path: name.split("›").map((p) => p.trim()).filter(Boolean) }
    : from === X_FROM_OPTIONS[3] ? { kind: "param", name }
    : { kind: "index" };
  return { source, sort: v["xSort"] === true };
}
