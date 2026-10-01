// The Paste and Duplicate bodies of store/workbookTransfer.ts, moved verbatim
// so they load with the transfer core on first use instead of at startup
// (bundle diet slice 17, plans/BUNDLE_HEADROOM.md). The slice keeps the cheap
// steps that run BEFORE the core is needed (the clipboard read, the pending-
// worksheet resolve) and reports a load failure through its own `fail()`, so
// the order of every refusal is unchanged. See that module's header for the
// failure-safe contract both bodies keep: build fully, then one
// `recordHistory` and one `set()`.

import { plural } from "../lib/plural";
import {
  buildTransferPackage,
  parseTransferPackage,
  pasteTransferPackage,
  resolvePasteText,
  type PasteResult,
  type TransferExistingIds,
  type TransferIdGenerators,
} from "../lib/workbookTransfer";
import type { AppState } from "./useApp";
import { nextDatasetId } from "./idSeq";
import { nextWorkbookId } from "./workbookIds";
import { notifyMigrationWarnings, toast } from "./toasts";
import type { SliceGet, SliceSet } from "./workbookTransfer";

/** What the slice hands its bodies. `fail` and `figureId` are passed in, not
 *  imported: a static import of `store/workbookTransfer.ts` or
 *  `store/figureLifecycle.ts` from this lazy module made Rolldown split each
 *  into an eager chunk of its own (measured +1,181 B of boundary). */
export interface TransferCtx {
  set: SliceSet;
  get: SliceGet;
  fail: (get: SliceGet, msg: string) => void;
  figureId: () => string;
}

let _reportSeq = 0;
/** Own generator (not useApp.ts's private `nextReportId`, which is
 *  unexported — see workbookIds.ts's identical "own module, own counter"
 *  rationale). Distinct prefix so a pasted report id can never collide with
 *  one useApp.ts itself mints, even in theory. */
const nextTransferReportId = (): string => `xrep-${Date.now().toString(36)}-${++_reportSeq}`;

let _templateSeq = 0;
const nextTransferTemplateId = (): string => `xqpt-${Date.now().toString(36)}-${++_templateSeq}`;

function idGenerators(figureId: () => string): TransferIdGenerators {
  return {
    dataset: nextDatasetId,
    workbook: nextWorkbookId,
    figure: figureId,
    report: nextTransferReportId,
    template: nextTransferTemplateId,
  };
}

function existingIds(s: AppState): TransferExistingIds {
  return {
    datasetIds: new Set(s.datasets.map((d) => d.id)),
    datasetNames: new Set(s.datasets.map((d) => d.name)),
    workbookIds: new Set(s.workbooks.map((w) => w.id)),
    figureIds: new Set(s.editableFigures.map((f) => f.id)),
    reportIds: new Set(s.reports.map((r) => r.id)),
    templateIds: new Set(s.quickPlotTemplates.map((t) => t.id)),
  };
}

/** UX-002: `pasteTransferPackage` DROPS any lineage reference whose target is
 *  outside the copied package (`versionOf`, an external `derivedFrom`, a
 *  dangling `bgRef`) rather than leaving a dangling id — see
 *  lib/workbookTransfer.ts's header for why the drop itself is correct. The
 *  BUG was the silence: the count was computed and returned, and read by
 *  nothing. Both gestures below now name it, so a pasted worksheet that lost
 *  its "version 2 of ..." link says so instead of looking complete.
 *
 *  Only the COUNT is surfaced, deliberately. Preserving a dropped link as
 *  inert historical text (the source dataset's NAME, say) is a semantics call
 *  about what lineage means across a transfer boundary and is still an open
 *  owner decision (BUGS_AND_ISSUES.md UX-002, box 2) — inventing it here
 *  would be inventing it silently.
 *
 *  "reference", not "lineage link": `rewriteRef` counts `bgRef` alongside
 *  `derivedFrom`/`versionOf`, and a dropped BACKGROUND reference is not
 *  provenance — it is a subtraction input, so losing it changes the plotted
 *  data, not just the history. That is the more serious of the two, so it is
 *  named separately rather than folded into a generic count. */
function refNote(n: number, background: number): string {
  if (n <= 0) return "";
  const bg = background > 0 ? `, ${background} of them a background reference` : "";
  return ` — ${n} reference${plural(n)} to data outside the copy not carried${bg}`;
}

/** Report a COMPLETED transfer: one message, one status line, one toast — and
 *  `"info"` rather than `"ok"` whenever a reference was dropped, because a
 *  green check on a result that lost something reads as "clean". Paste and
 *  Duplicate differ only in their headline. */
function succeed(get: SliceGet, result: PasteResult, headline: string): void {
  const note = refNote(result.droppedExternalRefs, result.droppedBackgroundRefs);
  const msg = headline + note;
  get().setStatus(msg);
  toast(msg, note ? "info" : "ok");
}

/** Merge a paste result into the store's arrays in ONE `set()` — the "swap
 *  once" half of the failure-safe contract; `recordHistory` must already
 *  have been called by the caller, immediately before this. */
function applyPasteResult(set: SliceSet, result: PasteResult): void {
  set((s) => ({
    workbooks: [...s.workbooks, result.workbook],
    datasets: [...s.datasets, ...result.datasets],
    editableFigures: [...s.editableFigures, ...result.editableFigures],
    reports: [...s.reports, ...result.reports],
    quickPlotTemplates: [...s.quickPlotTemplates, ...result.quickPlotTemplates],
  }));
}

/** Paste's body, from the clipboard text already read. */
export async function pasteWorkbook(
  { set, get, fail, figureId }: TransferCtx,
  text: string,
  targetFolderId?: string,
): Promise<void> {
  const parsed = await resolvePasteText(text);
  if (!parsed.ok) {
    fail(get, `paste workbook: ${parsed.reason}`);
    return;
  }
  // Build fully BEFORE touching history/state (frozen-scope item 5) —
  // pasteTransferPackage is pure and cannot itself fail past this point.
  const result = pasteTransferPackage(parsed.pkg, existingIds(get()), idGenerators(figureId), targetFolderId);
  get().recordHistory(`paste workbook "${parsed.pkg.workbook.name}"`);
  applyPasteResult(set, result);
  const n = result.datasets.length;
  succeed(get, result, `pasted "${result.workbook.name}" (${n} worksheet${plural(n)})`);
  // BUG-010: a package built by an OLDER instance can carry a
  // FigureDocument version this build no longer understands
  // (parseTransferPackage skips it and records why) — the only place
  // that can be non-empty, since a same-session duplicate below always
  // round-trips already-current-version live data.
  notifyMigrationWarnings(parsed.migrationWarnings);
}

/** Duplicate's body, once every member is resolved. Returns the new
 *  workbook's id, or `null` on refusal. */
export function duplicateWorkbook(
  { set, get, fail, figureId }: TransferCtx,
  workbookId: string,
  name: string,
  folderId: string | undefined,
): string | null {
  const built = buildTransferPackage(workbookId, get());
  if (!built.ok) {
    fail(get, `duplicate "${name}" unavailable: ${built.reason}`);
    return null;
  }
  // Same core as Paste (frozen-scope item 6) — round-tripped through the
  // identical parse validation for one code path, not two.
  const parsed = parseTransferPackage(built.text);
  if (!parsed.ok) {
    // Unreachable in practice (buildTransferPackage's own output always
    // parses) — defensive, never silently duplicates something broken.
    fail(get, `duplicate "${name}" failed: ${parsed.reason}`);
    return null;
  }
  const raw = pasteTransferPackage(parsed.pkg, existingIds(get()), idGenerators(figureId), folderId);
  // Duplicate's one deliberate divergence from Paste: the workbook's own
  // display name gets the same "X copy" convention every other
  // Duplicate in this app uses (store/figureLifecycle.ts's `duplicateEditableFigure`)
  // — Paste keeps the source name verbatim (it's a DIFFERENT project's
  // workbook arriving, not a copy of one already here).
  const result = { ...raw, workbook: { ...raw.workbook, name: `${name} copy` } };
  get().recordHistory(`duplicate workbook "${name}"`);
  applyPasteResult(set, result);
  succeed(get, result, `duplicated "${name}" as "${result.workbook.name}"`);
  return result.workbook.id;
}
