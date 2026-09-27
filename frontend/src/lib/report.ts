// Report sheets (#36) — the frontend half of the calc/report.py schema. A
// report is plain JSON (title + source refs + sections of typed blocks); the
// backend emits it (/api/report/emit), this module types + validates it, the
// store holds ReportEntry wrappers, and the viewer renders it. Pure (no React /
// store imports) so the sanitizers unit-test standalone, mirroring lib/dataset.

import type { FigureSpec } from "./api/figures";
import { decodeDataStruct, isWireCellArray, type WireDataStruct } from "./nonFiniteCells";

/** One fitted-parameter row (rendered as value ± error [unit]). */
export interface ReportParam {
  name: string;
  value: number | null;
  error?: number;
  unit?: string;
}

export type ReportCell = string | number | null;

export interface ReportTextBlock {
  type: "text";
  text: string;
}
export interface ReportTableBlock {
  type: "table";
  columns: string[];
  rows: ReportCell[][];
  caption?: string;
}
export interface ReportParamsBlock {
  type: "params";
  params: ReportParam[];
  caption?: string;
}
export interface ReportFigureBlock {
  type: "figure";
  name: string;
  image?: { mime: string; data: string };
  caption?: string;
  /** Detached `/api/export/figure` request. Report export re-renders this
   *  snapshot through the canonical figure renderer; it is deliberately not
   *  a live pointer to an editable figure that may change later. */
  spec?: FigureSpec;
}
export type ReportBlock =
  | ReportTextBlock
  | ReportTableBlock
  | ReportParamsBlock
  | ReportFigureBlock;

export interface ReportSection {
  title: string;
  blocks: ReportBlock[];
}

export interface ReportSourceRef {
  kind: string;
  id: string;
  name?: string;
}

/** The #36 schema (mirrors calc/report.py's ReportSheet.to_dict()). */
export interface ReportSheet {
  title: string;
  sections: ReportSection[];
  source_refs?: ReportSourceRef[];
  created?: string | null;
  meta?: Record<string, unknown>;
}

/** A report living in the workspace library: named, optionally tied back to
 *  the dataset it was computed from (cleared if that dataset is removed). */
export interface ReportEntry {
  id: string;
  name: string;
  datasetId: string | null;
  report: ReportSheet;
}

/** Decode BUG-017's persisted numeric-cell sentinels inside an embedded
 * figure request. Dataset parsing normally owns this boundary, but report
 * specs carry their own detached DataStruct and therefore need the same
 * treatment here on workspace reopen. A malformed spec remains present so
 * the report exporter can show its named placeholder/warning. */
function decodeFigureSpec(block: ReportFigureBlock): ReportFigureBlock {
  const spec = block.spec as unknown as Record<string, unknown> | undefined;
  const raw = spec?.dataset as Record<string, unknown> | undefined;
  if (
    !spec || !raw ||
    !isWireCellArray(raw.time) ||
    !Array.isArray(raw.values) || !raw.values.every(isWireCellArray) ||
    !Array.isArray(raw.labels) || !raw.labels.every((value) => typeof value === "string") ||
    !Array.isArray(raw.units) || !raw.units.every((value) => typeof value === "string") ||
    typeof raw.metadata !== "object" || raw.metadata === null
  ) return block;
  const dataset = decodeDataStruct(raw as unknown as WireDataStruct);
  return Object.is(dataset, raw) ? block : { ...block, spec: { ...block.spec!, dataset } };
}

function decodeReportFigureSpecs(report: ReportSheet): ReportSheet {
  let changed = false;
  const sections = report.sections.map((section) => {
    let sectionChanged = false;
    const blocks = section.blocks.map((block) => {
      if (block.type !== "figure" || block.spec === undefined) return block;
      const decoded = decodeFigureSpec(block);
      if (decoded !== block) sectionChanged = true;
      return decoded;
    });
    if (sectionChanged) changed = true;
    return sectionChanged ? { ...section, blocks } : section;
  });
  return changed ? { ...report, sections } : report;
}

// ── Structural validation (mirrors calc/report.validate_report) ────────────
const isCell = (v: unknown): v is ReportCell =>
  v === null || typeof v === "string" || typeof v === "number";

function isBlock(v: unknown): v is ReportBlock {
  if (typeof v !== "object" || v === null) return false;
  const b = v as Record<string, unknown>;
  switch (b.type) {
    case "text":
      return typeof b.text === "string";
    case "table":
      return (
        Array.isArray(b.columns) &&
        b.columns.every((c) => typeof c === "string") &&
        Array.isArray(b.rows) &&
        b.rows.every(
          (r) =>
            Array.isArray(r) &&
            r.length === (b.columns as unknown[]).length &&
            r.every(isCell),
        )
      );
    case "params":
      return (
        Array.isArray(b.params) &&
        b.params.every(
          (p) =>
            typeof p === "object" &&
            p !== null &&
            typeof (p as Record<string, unknown>).name === "string" &&
            isCell((p as Record<string, unknown>).value),
        )
      );
    case "figure":
      return (
        typeof b.name === "string" &&
        (b.spec === undefined || (typeof b.spec === "object" && b.spec !== null && !Array.isArray(b.spec)))
      );
    default:
      return false;
  }
}

/** Structural check that `v` is a well-formed report sheet. */
export function isReportSheet(v: unknown): v is ReportSheet {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.title !== "string") return false;
  if (!Array.isArray(o.sections)) return false;
  return o.sections.every((sec) => {
    if (typeof sec !== "object" || sec === null) return false;
    const s = sec as Record<string, unknown>;
    return (
      typeof s.title === "string" &&
      Array.isArray(s.blocks) &&
      s.blocks.every(isBlock)
    );
  });
}

/** Validate persisted report entries from a .dwk (drops malformed ones; clamps
 *  the dataset back-reference to ids that survived load, like Origin figures). */
export function sanitizeReports(v: unknown, dsIds: ReadonlySet<string>): ReportEntry[] {
  if (!Array.isArray(v)) return [];
  const out: ReportEntry[] = [];
  for (const e of v) {
    if (typeof e !== "object" || e === null) continue;
    const o = e as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.name !== "string") continue;
    if (!isReportSheet(o.report)) continue;
    const datasetId =
      typeof o.datasetId === "string" && dsIds.has(o.datasetId) ? o.datasetId : null;
    out.push({ id: o.id, name: o.name, datasetId, report: decodeReportFigureSpecs(o.report) });
  }
  return out;
}

/** Null a removed dataset out of the entries' back-references (keep the
 *  reports themselves — they are computed artifacts, not views). */
export function pruneReportRefs(
  reports: ReportEntry[],
  removedIds: ReadonlySet<string>,
): ReportEntry[] {
  return reports.map((r) =>
    r.datasetId && removedIds.has(r.datasetId) ? { ...r, datasetId: null } : r,
  );
}
