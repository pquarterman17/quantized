// Report sheets (#36) — the frontend half of the calc/report.py schema. A
// report is plain JSON (title + source refs + sections of typed blocks); the
// backend emits it (/api/report/emit), this module types + validates it, the
// store holds ReportEntry wrappers, and the viewer renders it. Pure (no React /
// store imports) so the sanitizers unit-test standalone, mirroring lib/dataset.

import { decodeWireRow } from "./nonFiniteCells";

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
  /** P3.6: the exact `POST /api/export/figure` body for this figure (built by
   *  `lib/figureSpecStage.buildStageFigureSpec`, the SAME builder "Export
   *  figure…" uses). `/api/report/export` renders it through that route's own
   *  renderer and embeds the result; a block without it is a reference-only
   *  figure (`[figure: …]`). Opaque here on purpose — the backend validates
   *  it, and a bad one degrades to a named placeholder + export warning. */
  spec?: Record<string, unknown>;
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
      return typeof b.name === "string";
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

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** P3.6 migration guard: a figure block's `spec` (added after reports first
 *  persisted) must be a plain object. A malformed one is DROPPED — the block
 *  survives as a reference-only figure and `warn` names it — rather than
 *  failing `isReportSheet` and losing the whole report. Returns `report`
 *  itself (same identity) when nothing needed stripping; never mutates it. */
function stripBadFigureSpecs(report: unknown, warn: (block: string) => void): unknown {
  if (!isPlainObject(report) || !Array.isArray(report.sections)) return report;
  let changed = false;
  const sections = report.sections.map((sec: unknown) => {
    if (!isPlainObject(sec) || !Array.isArray(sec.blocks)) return sec;
    let secChanged = false;
    const blocks = sec.blocks.map((b: unknown) => {
      if (!isPlainObject(b) || b.type !== "figure" || !("spec" in b) || isPlainObject(b.spec)) return b;
      secChanged = true;
      warn(typeof b.name === "string" ? b.name : "?");
      const rest: Record<string, unknown> = { ...b };
      delete rest.spec;
      return rest;
    });
    if (!secChanged) return sec;
    changed = true;
    return { ...sec, blocks };
  });
  return changed ? { ...report, sections } : report;
}

/** Decode BUG-017's persisted numeric-cell sentinels inside an embedded
 *  figure spec's dataset. `workspaceSerialize.ts`'s `encodePersistedCells`
 *  replacer walks the WHOLE `.dwk` document on save, so a report figure
 *  block's detached `spec.dataset` gets the same NaN/±Infinity/-0 -> string
 *  sentinel treatment as any other DataStruct; this is the matching decode
 *  on reopen. `spec` stays opaque otherwise — only its `dataset` sub-object
 *  is inspected, and only when it looks like one at all (has a `dataset`
 *  key); a spec with none is left alone, no warning.
 *
 *  Finding #5 (P3.6 review round 2): `time` and `values` are decoded
 *  INDEPENDENTLY of `labels`/`units`/`metadata` now — the old code gated the
 *  whole decode on the WHOLE dataset's shape being valid, so a bad label or
 *  unit left "NaN"/"Infinity"/… sentinel STRINGS sitting in `time`/`values`
 *  with no warning at all (silently wrong plotted numbers). A malformed cell
 *  in `time`/`values` itself is still left as-is either way (never partially
 *  decoded — see `decodeWireRow`): a cell this module has never been able to
 *  interpret (a `null`, or anything else outside the WireCell contract) is
 *  exactly the ambiguous case `lib/nonFiniteCells.ts`'s own header says this
 *  layer never guesses at, so it is treated the SAME as before this fix —
 *  opaque, untouched, no warning — UNLESS at least one cell WAS a real
 *  sentinel string that got decoded (`changed` below): only THAT combination
 *  (something genuinely non-finite got fixed, but the dataset around it is
 *  still not a fully well-formed `DataStruct`) is the bug this finding
 *  targets, and only then does `warn` (naming this block) fire — nothing
 *  changes for a spec whose `dataset` field never carried a sentinel in the
 *  first place, matching this function's long-standing "opaque unless
 *  confidently ours" contract. Returns `block` itself when nothing needed
 *  decoding, preserving the identity contract `stripBadFigureSpecs`/
 *  `sanitizeReports` rely on. */
function decodeFigureSpec(block: ReportFigureBlock, warn: (block: string) => void): ReportFigureBlock {
  const spec = block.spec;
  const raw = spec?.dataset as Record<string, unknown> | undefined;
  if (!spec || !raw) return block;

  const time = decodeWireRow(raw.time);
  let valuesOk = Array.isArray(raw.values);
  let valuesChanged = false;
  const values = valuesOk
    ? (raw.values as unknown[]).map((row) => {
        const r = decodeWireRow(row);
        if (!r.ok) valuesOk = false;
        if (r.changed) valuesChanged = true;
        return r.value;
      })
    : raw.values;

  const changed = time.changed || valuesChanged;
  const ok =
    time.ok && valuesOk &&
    Array.isArray(raw.labels) && raw.labels.every((v) => typeof v === "string") &&
    Array.isArray(raw.units) && raw.units.every((v) => typeof v === "string") &&
    typeof raw.metadata === "object" && raw.metadata !== null;
  if (changed && !ok) warn(block.name);

  if (!changed) return block;
  return { ...block, spec: { ...spec, dataset: { ...raw, time: time.value, values } } };
}

/** Apply {@link decodeFigureSpec} to every figure block in `report`, naming
 *  `reportName` and the figure in `warnings` (the loader's migrationWarnings
 *  — the same sink `sanitizeReports` already uses for `stripBadFigureSpecs`)
 *  whenever one comes back malformed. Returns `report` itself when nothing
 *  changed, preserving the identity contract `stripBadFigureSpecs` already
 *  relies on (a report with no work to do round-trips through
 *  `sanitizeReports` as the SAME object). */
function decodeReportFigureSpecs(report: ReportSheet, reportName: string, warnings?: string[]): ReportSheet {
  let changed = false;
  const sections = report.sections.map((section) => {
    let sectionChanged = false;
    const blocks = section.blocks.map((block) => {
      if (block.type !== "figure" || block.spec === undefined) return block;
      const decoded = decodeFigureSpec(block, (name) =>
        warnings?.push(`report "${reportName}": figure "${name}" has a malformed embedded dataset`),
      );
      if (decoded !== block) sectionChanged = true;
      return decoded;
    });
    if (sectionChanged) changed = true;
    return sectionChanged ? { ...section, blocks } : section;
  });
  return changed ? { ...report, sections } : report;
}

/** Validate persisted report entries from a .dwk (drops malformed ones; clamps
 *  the dataset back-reference to ids that survived load, like Origin figures).
 *  A malformed figure `spec` is stripped, not fatal — see
 *  `stripBadFigureSpecs`; `warnings` (the loader's migrationWarnings) names
 *  each one so the user is told a figure lost its embedded render, and names
 *  each well-identified entry (string id + name) whose sheet was dropped. */
export function sanitizeReports(
  v: unknown,
  dsIds: ReadonlySet<string>,
  warnings?: string[],
): ReportEntry[] {
  if (!Array.isArray(v)) return [];
  const out: ReportEntry[] = [];
  for (const e of v) {
    if (typeof e !== "object" || e === null) continue;
    const o = e as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.name !== "string") continue;
    // Strip warnings are held until the report is known to SURVIVE: a report
    // dropped below gets one "dropped" warning instead, never a claim that
    // one of its figures "is now a reference only" in a report that is gone.
    const stripped: string[] = [];
    const report = stripBadFigureSpecs(o.report, (block) => stripped.push(block));
    if (!isReportSheet(report)) {
      warnings?.push(`report "${o.name}" could not be read and was dropped`);
      continue;
    }
    for (const block of stripped) {
      warnings?.push(`report "${o.name}": figure "${block}" had an unreadable render spec and is now a reference only`);
    }
    const datasetId =
      typeof o.datasetId === "string" && dsIds.has(o.datasetId) ? o.datasetId : null;
    out.push({ id: o.id, name: o.name, datasetId, report: decodeReportFigureSpecs(report, o.name, warnings) });
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
