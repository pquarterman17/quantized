// Named ranges (ROW_RANGE_CONTRACT section 5, slice R4a): a name for a block of
// one worksheet, which a later slice's `rng("Name")` formula, a plot window and
// an analysis input resolve live. THIS module is the model only: the type, the
// rules for a legal name and scope, and the pure remaps that keep the block
// pointing at the same cells when columns and rows move. Nothing here reads the
// store; `store/namedRanges.ts` owns the actions and `lib/workspace.ts` the
// file. Every consumer resolves a range BY ID, never by name, so a rename never
// breaks one, and an id that is absent (a deleted range) is an error for the
// consumer, which is how a delete "cuts" its dependants without re-binding them
// to a later range of the same name.
//
// The block lives on ONE sheet (`target.datasetId`). The scope says where the NAME
// is visible: one sheet, or every sheet of one workbook. This slice keeps the two
// consistent, failing closed where the contract is silent: a sheet-scoped name's
// sheet IS the block's sheet, and a workbook-scoped name's block sits on a sheet
// of that workbook. Names are unique, case-insensitively, within a workbook and
// all its sheets (a standalone sheet is its own group): no shadowing.
//
// Columns are channel indices (-1 is X) and follow every insert, delete and move
// through `remapNamedRangeColumns`. Rows are POSITIONS, as `excludedRows` are, and
// follow insert and delete through lib/rowRange. A range that loses every column,
// or every row, is KEPT and reported broken, never widened, because others depend
// on it by id.

import { remapChannel, type ColumnShift } from "./channelRemap";
import { channelLetter } from "./formula";
import { contiguousRowRange, rowRangeLabel, rowRangeRefusal, shiftRangeForDelete, shiftRangeForInsert, type RowRange } from "./rowRange";
import type { Dataset } from "./types";
import type { WorkbookNode } from "./workbooks";

export type NamedRangeScope = { kind: "sheet"; datasetId: string } | { kind: "workbook"; workbookId: string };

export interface NamedRange {
  /** "nr1:<base36>", never reused. */
  id: string;
  /** 1-64 characters, no quotes or control characters, unique case-insensitively within its workbook. */
  name: string;
  scope: NamedRangeScope;
  target: {
    datasetId: string;
    /** Channel indices (-1 is X), in the order they were selected. Empty = every column was deleted: broken. */
    cols: number[];
    /** Positions on the raw sheet; null = every row. A range whose rows were all deleted carries `was`. */
    rows: RowRange | null;
  };
  /** The sheet's rows were replaced (re-import, trim, re-derive), so `rows` lost its meaning (section 5.4). */
  rowsStale?: true;
}

export const MAX_NAME_LENGTH = 64;
/** Far above any real project; a hand-edited file past it is cut at load. */
export const MAX_NAMED_RANGES = 5000;

/** Why `name` cannot name a range (already trimmed), or null. */
export function namedRangeNameRefusal(name: string): string | null {
  if (name.length === 0) return "give the range a name";
  if (name.length > MAX_NAME_LENGTH) return `a range name is at most ${MAX_NAME_LENGTH} characters`;
  if (/["'\u0000-\u001f\u007f]/.test(name)) return "a range name cannot contain quotes or control characters";
  return null;
}

/** A fresh id that is neither in `taken` nor ever minted twice in a session. */
export function newNamedRangeId(taken: ReadonlySet<string>): string {
  for (;;) {
    const id = `nr1:${Math.floor(Math.random() * 36 ** 7).toString(36)}${Date.now().toString(36)}`;
    if (!taken.has(id)) return id;
  }
}

/** The group within which names must be unique: a workbook (the workbook scope itself, and every sheet in it) or, for
 *  a sheet that sits in no workbook, that sheet alone. */
export function nameGroup(scope: NamedRangeScope, datasets: readonly Pick<Dataset, "id" | "workbookId">[]): string {
  if (scope.kind === "workbook") return `wb:${scope.workbookId}`;
  const workbookId = datasets.find((d) => d.id === scope.datasetId)?.workbookId;
  return workbookId ? `wb:${workbookId}` : `sheet:${scope.datasetId}`;
}

/** The range that already holds `name` within `scope`'s group (`ignoreId` skips the range being renamed), or undefined. */
export function nameClash(
  ranges: readonly NamedRange[],
  name: string,
  scope: NamedRangeScope,
  datasets: readonly Pick<Dataset, "id" | "workbookId">[],
  ignoreId?: string,
): NamedRange | undefined {
  const group = nameGroup(scope, datasets);
  const lower = name.toLowerCase();
  return ranges.find((r) => r.id !== ignoreId && r.name.toLowerCase() === lower && nameGroup(r.scope, datasets) === group);
}

/** Why `target` and `scope` do not describe a block this model can hold, or null. Against the live `datasets`. */
export function targetRefusal(
  scope: NamedRangeScope,
  target: NamedRange["target"],
  datasets: readonly Pick<Dataset, "id" | "workbookId" | "name" | "data" | "pending">[],
  workbooks: readonly Pick<WorkbookNode, "id">[],
): string | null {
  const ds = datasets.find((d) => d.id === target.datasetId);
  if (!ds) return "the worksheet no longer exists";
  if (scope.kind === "sheet" && scope.datasetId !== target.datasetId) return "a sheet-scoped name must name a block on its own sheet";
  if (scope.kind === "workbook") {
    if (!workbooks.some((w) => w.id === scope.workbookId)) return "the workbook no longer exists";
    if (ds.workbookId !== scope.workbookId) return "a workbook-scoped name must name a block on a sheet of that workbook";
  }
  if (target.cols.length === 0) return "select at least one column";
  const width = ds.data.labels.length;
  const bad = target.cols.find((c) => !Number.isInteger(c) || c < -1 || c >= width);
  if (bad !== undefined) return `column ${bad + 1} is not on the worksheet`;
  if (new Set(target.cols).size !== target.cols.length) return "a column is selected twice";
  // A pending (lazy) book's preview is not the sheet: its row count is not known yet.
  if (target.rows && ds.pending == null) return rowRangeRefusal(target.rows, ds.data.time.length);
  return null;
}

/** A block from a worksheet selection: the selected columns and the one contiguous block of rows, or why not. */
export function blockFromSelection(
  selectedRows: Iterable<number>,
  selectedCols: Iterable<number>,
): { cols: number[]; rows: RowRange } | { reason: string } {
  const cols = [...new Set(selectedCols)].sort((a, b) => a - b);
  if (cols.length === 0) return { reason: "select the columns first" };
  const block = contiguousRowRange(selectedRows);
  return "range" in block ? { cols, rows: { from: block.range.from, to: block.range.to } } : { reason: block.reason };
}

/** "Run 2 B:C rows 21-44": what a range covers, for the dependants dialog and the manager. */
export function describeNamedRange(range: NamedRange, datasets: readonly Pick<Dataset, "id" | "name" | "data">[]): string {
  const ds = datasets.find((d) => d.id === range.target.datasetId);
  const cols = range.target.cols.map((c) => (c < 0 ? "X" : channelLetter(c)));
  const colText = cols.length === 0 ? "no columns" : cols.length === 1 ? cols[0] : `${cols[0]}:${cols[cols.length - 1]}`;
  const rows = range.target.rows ? (range.target.rows.was !== undefined ? `${range.target.rows.was} (deleted)` : rowRangeLabel(range.target.rows)) : "every row";
  return `${ds?.name ?? "a deleted worksheet"} ${colText} ${rows}`;
}

/** Why a consumer must refuse this range right now, or null when it can be read. */
export function namedRangeIssue(range: NamedRange, datasets: readonly Pick<Dataset, "id" | "name" | "data" | "pending">[]): string | null {
  const ds = datasets.find((d) => d.id === range.target.datasetId);
  if (!ds) return `named range ${range.name}: its worksheet was deleted`;
  if (range.target.cols.length === 0) return `named range ${range.name}: every column of the block was deleted`;
  if (range.rowsStale) return `named range ${range.name}: its worksheet's rows were replaced; open Named Ranges to keep ${range.target.rows ? rowRangeLabel(range.target.rows) : "every row"} or remove the row limit`;
  const rows = range.target.rows;
  if (rows && ds.pending == null) {
    const refusal = rowRangeRefusal(rows, ds.data.time.length);
    if (refusal) return `named range ${range.name}: ${refusal}`;
  }
  return null;
}

// ---- column and row remaps (each returns the SAME array when nothing changed) ----

/** The ranges after a column shift of dataset `datasetId`: each block column follows its column, a deleted one drops out
 *  (a block that loses all of them is kept, with `cols: []`, and reported broken). */
export function remapNamedRangeColumns(ranges: NamedRange[], datasetId: string, shift: ColumnShift): NamedRange[] {
  if (!ranges.some((r) => r.target.datasetId === datasetId)) return ranges;
  let changed = false;
  const next = ranges.map((r) => {
    if (r.target.datasetId !== datasetId) return r;
    const cols = r.target.cols.flatMap((c) => {
      const m = remapChannel(c, shift);
      return m === null ? [] : [m];
    });
    if (cols.length === r.target.cols.length && cols.every((c, i) => c === r.target.cols[i])) return r;
    changed = true;
    return { ...r, target: { ...r.target, cols } };
  });
  return changed ? next : ranges;
}

function mapRows(ranges: NamedRange[], datasetId: string, shift: (rows: RowRange) => RowRange): NamedRange[] {
  let changed = false;
  const next = ranges.map((r) => {
    const rows = r.target.rows;
    // A stale range's positions have no meaning to shift (section 5.4); an unlimited one has none to shift.
    if (r.target.datasetId !== datasetId || !rows || r.rowsStale) return r;
    const moved = shift(rows);
    if (moved === rows || (moved.from === rows.from && moved.to === rows.to && moved.was === rows.was)) return r;
    changed = true;
    return { ...r, target: { ...r.target, rows: moved } };
  });
  return changed ? next : ranges;
}

/** After inserting `count` rows at `at` (the same rule an exclusion mark follows). */
export function shiftNamedRangesForInsert(ranges: NamedRange[], datasetId: string, at: number, count: number): NamedRange[] {
  return mapRows(ranges, datasetId, (rows) => shiftRangeForInsert(rows, at, count));
}

/** After deleting `deleted`: a range with no surviving row is kept and carries `was`. */
export function shiftNamedRangesForDelete(ranges: NamedRange[], datasetId: string, deleted: ReadonlySet<number>): NamedRange[] {
  return mapRows(ranges, datasetId, (rows) => shiftRangeForDelete(rows, deleted));
}

/** The sheet's rows were replaced outside an explicit insert or delete: every row-limited range on it is stale.
 *  `whole` (its columns were replaced too, a column-changing re-import) flags the unlimited ones as well, because their
 *  column indices no longer name the same columns. */
export function markNamedRangesRowsStale(ranges: NamedRange[], datasetId: string, whole = false): NamedRange[] {
  const hit = (r: NamedRange): boolean => r.target.datasetId === datasetId && (whole || r.target.rows !== null) && !r.rowsStale;
  return ranges.some(hit) ? ranges.map((r) => (hit(r) ? { ...r, rowsStale: true as const } : r)) : ranges;
}

// ---- Append Project ----

/** An appended project's ranges, carried through the same id tables as its worksheets and workbooks. A range whose
 *  block or workbook did not come along is dropped and counted. The clash rule: an incoming name that is already taken
 *  within its workbook gets " (2)", " (3)" ... (as an appended worksheet's name does), never replaces or merges with
 *  the existing range, and is counted. `after` is the merged dataset list (final ids and workbook ids). */
export function appendNamedRanges(
  existing: readonly NamedRange[],
  incoming: readonly NamedRange[] | undefined,
  datasetIds: ReadonlyMap<string, string>,
  workbookIds: ReadonlyMap<string, string>,
  after: readonly Pick<Dataset, "id" | "workbookId">[],
): { ranges: NamedRange[]; dropped: number; renamed: number } {
  const ranges: NamedRange[] = [];
  const taken = new Set(existing.map((r) => r.id));
  let dropped = 0;
  let renamed = 0;
  for (const r of incoming ?? []) {
    const datasetId = datasetIds.get(r.target.datasetId);
    const scope: NamedRangeScope | null =
      r.scope.kind === "sheet"
        ? (datasetIds.has(r.scope.datasetId) ? { kind: "sheet", datasetId: datasetIds.get(r.scope.datasetId)! } : null)
        : (workbookIds.has(r.scope.workbookId) ? { kind: "workbook", workbookId: workbookIds.get(r.scope.workbookId)! } : null);
    if (!datasetId || !scope) {
      dropped++;
      continue;
    }
    const id = taken.has(r.id) ? newNamedRangeId(taken) : r.id;
    taken.add(id);
    const all = [...existing, ...ranges];
    let name = r.name;
    for (let n = 2; nameClash(all, name, scope, after); n++) name = `${r.name} (${n})`.slice(-MAX_NAME_LENGTH);
    if (name !== r.name) renamed++;
    ranges.push({ ...r, id, name, scope, target: { ...r.target, datasetId } });
  }
  return { ranges, dropped, renamed };
}

// ---- the file ----

const intOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);

function sanitizeRows(v: unknown): RowRange | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v !== "object") return undefined;
  const { from, to, was } = v as Record<string, unknown>;
  const f = intOrNull(from);
  const t = intOrNull(to);
  if (f === null || t === null || f < 0) return undefined;
  if (typeof was === "string") return { from: f, to: t, was: was.slice(0, 64) };
  return t >= f ? { from: f, to: t } : undefined;
}

/** The `.dwk` `namedRanges` list, read defensively: a malformed entry, one that names a worksheet or workbook this file
 *  does not hold, or a name already taken within its workbook is DROPPED and counted (never repaired by guessing), so
 *  `warn` can say so. Never throws. */
export function sanitizeNamedRanges(
  raw: unknown,
  datasets: readonly Pick<Dataset, "id" | "workbookId" | "name" | "data" | "pending">[],
  workbooks: readonly Pick<WorkbookNode, "id">[],
  warn?: (message: string) => void,
): NamedRange[] {
  if (!Array.isArray(raw)) return [];
  const out: NamedRange[] = [];
  const ids = new Set<string>();
  let dropped = 0;
  for (const item of raw.slice(0, MAX_NAMED_RANGES)) {
    const range = readRange(item);
    const bad =
      !range ||
      ids.has(range.id) ||
      namedRangeNameRefusal(range.name) !== null ||
      // Rows are checked against the live sheet only when they are not a deleted-away range or stale: a sheet shorter
      // than the stored rows is a broken range to report, not a malformed one to drop.
      targetRefusalStructural(range, datasets, workbooks) !== null ||
      nameClash(out, range.name, range.scope, datasets) !== undefined;
    if (bad) {
      dropped++;
      continue;
    }
    ids.add(range!.id);
    out.push(range!);
  }
  dropped += Math.max(0, raw.length - MAX_NAMED_RANGES);
  if (dropped) warn?.(`${dropped} named range${dropped === 1 ? " was" : "s were"} unreadable and not loaded.`);
  return out;
}

function readRange(item: unknown): NamedRange | null {
  if (typeof item !== "object" || item === null) return null;
  const o = item as Record<string, unknown>;
  const scope = o.scope as Record<string, unknown> | undefined;
  const target = o.target as Record<string, unknown> | undefined;
  if (typeof o.id !== "string" || !o.id || typeof o.name !== "string" || !scope || !target) return null;
  let s: NamedRangeScope;
  if (scope.kind === "sheet" && typeof scope.datasetId === "string") s = { kind: "sheet", datasetId: scope.datasetId };
  else if (scope.kind === "workbook" && typeof scope.workbookId === "string") s = { kind: "workbook", workbookId: scope.workbookId };
  else return null;
  const rows = sanitizeRows(target.rows);
  const cols = Array.isArray(target.cols) ? target.cols.map(intOrNull) : null;
  if (typeof target.datasetId !== "string" || rows === undefined || !cols || cols.some((c) => c === null)) return null;
  return {
    id: o.id,
    name: o.name,
    scope: s,
    target: { datasetId: target.datasetId, cols: cols as number[], rows },
    ...(o.rowsStale === true ? { rowsStale: true as const } : {}),
  };
}

/** `targetRefusal` without the live-size checks (columns past the width, rows past the end): at load a block that has
 *  outgrown its sheet is reported by `namedRangeIssue`, not dropped. Only structure and scope are enforced. */
function targetRefusalStructural(
  range: NamedRange,
  datasets: readonly Pick<Dataset, "id" | "workbookId">[],
  workbooks: readonly Pick<WorkbookNode, "id">[],
): string | null {
  const { scope, target } = range;
  const ds = datasets.find((d) => d.id === target.datasetId);
  if (!ds) return "no worksheet";
  if (scope.kind === "sheet" && scope.datasetId !== target.datasetId) return "scope";
  if (scope.kind === "workbook" && (!workbooks.some((w) => w.id === scope.workbookId) || ds.workbookId !== scope.workbookId)) return "scope";
  if (target.cols.some((c) => c < -1) || new Set(target.cols).size !== target.cols.length) return "cols";
  return null;
}
