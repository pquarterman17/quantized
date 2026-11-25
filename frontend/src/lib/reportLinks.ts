// Linked report blocks (GAP_AUDIT_9 G19, provisional - owner to confirm).
//
// A report block is a SNAPSHOT by default (and every report saved before this
// existed is one). A block may opt IN to a link to the object its content was
// pulled from, by stable id (`ReportBlock.link`, lib/report.ts):
//   table / params -> a saved analysis-result table (lib/analysisResult tables)
//   figure         -> an editable figure document (lib/reportLinkFigure.ts)
//
// This module is the pure model: reading a link, the link state, and the
// table/params pull. It reuses the result lifecycle's own freshness authority
// (`snapshotResultState`: current / out-of-date / pending / source-missing)
// rather than judging staleness a second way, and FAILS CLOSED: a source whose
// own inputs changed ("stale") is never pulled (its numbers are the old ones;
// run the analysis again first), and a missing source keeps the last snapshot.
// Linked report blocks are reached only from the lazy report viewer, so none
// of this is on the eager bundle. No React, no store.

import type { AnalysisResult, AnalysisResultTable } from "./analysisResult";
import { isSnapshotResult, snapshotResultState } from "./analysisResultFreshness";
import type { ReportBlock, ReportBlockLink, ReportParam } from "./report";
import type { Dataset } from "./types";

/** What a block's link says about its content right now.
 *  - snapshot: no (valid) link: the default.
 *  - current: the block shows what the source holds.
 *  - behind: the source is current and holds newer content: Refresh pulls it.
 *  - stale: the source's own inputs changed after it was computed; there is
 *    nothing newer to pull until it is run again. Refresh is refused.
 *  - missing: the source (or its table) is gone; the last snapshot stays. */
export type LinkState =
  | { kind: "snapshot" }
  | { kind: "current" }
  | { kind: "behind"; reason: string }
  | { kind: "stale"; reason: string }
  | { kind: "missing"; reason: string };

export interface LinkContext {
  results: readonly AnalysisResult[];
  datasets: readonly Dataset[];
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The block's link, or null for a snapshot. A malformed link, or one that
 *  does not fit the block's type, reads as NO link (the block stays a
 *  snapshot) rather than failing the report. */
export function readBlockLink(block: ReportBlock): ReportBlockLink | null {
  const raw: unknown = (block as { link?: unknown }).link;
  if (!isObj(raw) || typeof raw.id !== "string" || raw.id === "") return null;
  const name = typeof raw.name === "string" ? { name: raw.name } : {};
  if (raw.kind === "result" && (block.type === "table" || block.type === "params")) {
    if (typeof raw.table !== "number" || !Number.isInteger(raw.table) || raw.table < 0) return null;
    return { kind: "result", id: raw.id, table: raw.table, ...(typeof raw.title === "string" ? { title: raw.title } : {}), ...name };
  }
  if (raw.kind === "figure" && block.type === "figure" && typeof raw.pulled === "string") {
    return { kind: "figure", id: raw.id, pulled: raw.pulled, ...name };
  }
  return null;
}

/** The block without its link (a snapshot again; content untouched). */
export function unlinkedBlock<B extends ReportBlock>(block: B): B {
  const { link: _drop, ...rest } = block as B & { link?: unknown };
  return rest as B;
}

/** Results whose tables a report block can link: the saved-table snapshot
 *  results (no linked worksheet), the same set "Send to report" accepts. */
export function linkableResults(results: readonly AnalysisResult[]): AnalysisResult[] {
  return results.filter((r) => !!r.tables?.length && r.outputs.length === 0 && isSnapshotResult(r));
}

/** The linked table in `result`: by saved title first (an index shifts when a
 *  recompute changes the table set), else by index when no title was saved. */
export function resolveResultTable(
  result: AnalysisResult,
  link: Extract<ReportBlockLink, { kind: "result" }>,
): AnalysisResultTable | null {
  const tables = result.tables ?? [];
  if (link.title) return tables.find((t) => t.title === link.title) ?? null;
  return tables[link.table] ?? null;
}

const lower = (s: string) => s.trim().toLowerCase();
const NAME_COLS = ["term", "parameter", "name"];
const VALUE_COLS = ["estimate", "value"];
const ERROR_COLS = ["se", "std error", "std. error", "stderr", "error", "std err"];

/** A result table read as fitted parameters (name, value, optional error), or
 *  a reason it cannot be (a params block needs a name column and an
 *  estimate/value column; fail closed rather than guess). A `level` column
 *  that varies prefixes each name so grouped fits stay distinguishable. */
export function paramsFromTable(table: AnalysisResultTable): ReportParam[] | string {
  const cols = table.columns.map(lower);
  const find = (names: readonly string[]) => cols.findIndex((c) => names.includes(c));
  const nameAt = find(NAME_COLS);
  const valueAt = find(VALUE_COLS);
  if (nameAt < 0 || valueAt < 0) {
    return "this table has no parameter-name and estimate/value columns, so it cannot be a parameter block";
  }
  const errorAt = find(ERROR_COLS);
  const unitAt = cols.indexOf("unit");
  const levelAt = cols.indexOf("level");
  const levels = new Set(levelAt >= 0 ? table.rows.map((r) => String(r[levelAt] ?? "")) : []);
  const prefix = levels.size > 1;
  return table.rows.map((row) => {
    const base = String(row[nameAt] ?? "");
    const value = row[valueAt];
    const error = errorAt >= 0 ? row[errorAt] : undefined;
    const unit = unitAt >= 0 ? row[unitAt] : undefined;
    return {
      name: prefix ? `${String(row[levelAt] ?? "")}: ${base}` : base,
      value: typeof value === "number" ? value : null,
      ...(typeof error === "number" ? { error } : {}),
      ...(typeof unit === "string" && unit ? { unit } : {}),
    };
  });
}

/** The fields a table/params block takes from `table`, or an error reason. */
function pulledFields(
  block: ReportBlock,
  table: AnalysisResultTable,
): { columns: string[]; rows: AnalysisResultTable["rows"] } | { params: ReportParam[] } | { error: string } {
  if (block.type === "table") return { columns: [...table.columns], rows: table.rows.map((r) => [...r]) };
  const params = paramsFromTable(table);
  return typeof params === "string" ? { error: params } : { params };
}

function sameContent(block: ReportBlock, fields: ReturnType<typeof pulledFields>): boolean {
  if ("error" in fields) return false;
  if (block.type === "table" && "columns" in fields) {
    return JSON.stringify([block.columns, block.rows]) === JSON.stringify([fields.columns, fields.rows]);
  }
  if (block.type === "params" && "params" in fields) {
    return JSON.stringify(block.params) === JSON.stringify(fields.params);
  }
  return false;
}

const STALE_REASON: Record<"out-of-date" | "pending" | "source-missing", string> = {
  "out-of-date": "its source data changed after it was computed; run the analysis again, then refresh",
  "pending": "its source worksheet is not fully loaded; load it, then refresh",
  "source-missing": "its source worksheet is gone",
};

/** The state of a table/params block's link against the live results. */
export function resultLinkState(
  block: ReportBlock,
  link: Extract<ReportBlockLink, { kind: "result" }>,
  ctx: LinkContext,
): LinkState {
  const result = ctx.results.find((r) => r.id === link.id);
  if (!result) return { kind: "missing", reason: `the source result${link.name ? ` "${link.name}"` : ""} was deleted` };
  const table = resolveResultTable(result, link);
  if (!table) return { kind: "missing", reason: `the source result no longer has the table${link.title ? ` "${link.title}"` : ""}` };
  const fields = pulledFields(block, table);
  if ("error" in fields) return { kind: "missing", reason: fields.error };
  const state = snapshotResultState(result, ctx.datasets);
  if (state !== "current") return { kind: "stale", reason: STALE_REASON[state] };
  return sameContent(block, fields)
    ? { kind: "current" }
    : { kind: "behind", reason: "the source result was recomputed since this block was pulled" };
}

/** Link a table/params block to `result`'s table `tableIndex` (the block's
 *  content is left as it is; the state then says whether it matches). Refuses
 *  a table a params block cannot read. */
export function linkBlockToResult(
  block: ReportBlock,
  result: AnalysisResult,
  tableIndex: number,
): { block: ReportBlock } | { error: string } {
  const table = result.tables?.[tableIndex];
  if (block.type !== "table" && block.type !== "params") return { error: "only table, parameter and figure blocks can be linked" };
  if (!table) return { error: "that result table is unavailable" };
  const fields = pulledFields(block, table);
  if ("error" in fields) return { error: fields.error };
  const link: ReportBlockLink = {
    kind: "result", id: result.id, table: tableIndex, name: result.name,
    ...(table.title ? { title: table.title } : {}),
  };
  return { block: { ...block, link } as ReportBlock };
}

/** Pull the current result table into a linked table/params block. Fails
 *  closed: only a `behind` block changes; `stale`/`missing` keep the snapshot
 *  and say why; `current` is returned as is. */
export function refreshResultBlock(
  block: ReportBlock,
  ctx: LinkContext,
): { block: ReportBlock; changed: boolean } | { kept: string } {
  const link = readBlockLink(block);
  if (!link || link.kind !== "result") return { block, changed: false };
  const state = resultLinkState(block, link, ctx);
  if (state.kind === "current" || state.kind === "snapshot") return { block, changed: false };
  if (state.kind !== "behind") return { kept: state.reason };
  const table = resolveResultTable(ctx.results.find((r) => r.id === link.id)!, link)!;
  const fields = pulledFields(block, table);
  if ("error" in fields) return { kept: fields.error };
  return { block: { ...block, ...fields } as ReportBlock, changed: true };
}

/** A short label for messages: the block's caption, else its type. */
export function blockLabel(block: ReportBlock, index: number): string {
  if (block.type === "figure") return `figure "${block.name}"`;
  if (block.type === "text") return `block ${index + 1}`;
  return block.caption ? `"${block.caption}"` : `${block.type} block ${index + 1}`;
}
