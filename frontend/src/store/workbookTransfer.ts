// Cross-instance workbook Copy/Paste/Duplicate (PR I, LIBRARY_WORKBOOK_UX_PLAN
// L0.23/L0.24) — the thin store orchestrator around lib/workbookTransfer.ts's
// pure build/parse/paste core. Composed into the ONE useApp store instance
// exactly like store/reimport.ts (see that file's header): owns no state of
// its own, calls get()/set() directly, one `recordHistory` per successful
// gesture.
//
// TRANSPORT RULING (frozen-scope item 2, "clipboard is the natural
// transport; if... unreliable, a file-based transport is acceptable —
// document the ruling"): this slice ships CLIPBOARD-TEXT ONLY, via the same
// `copyText`/`navigator.clipboard.readText()` pair every other clipboard
// feature in this app already uses (lib/clipboard.ts's `copyText`,
// components/Stage/worksheet/useWorksheetBlockOps.ts's `readText` paste).
// The package is plain JSON text carrying its own `format`/`version`
// envelope (lib/workbookTransfer.ts) — no separate marker prefix is added,
// because `parseTransferPackage` already length-guards BEFORE attempting
// `JSON.parse` (so pasting arbitrary non-Quantized clipboard text, however
// large, is cheap to reject) and its `format` field check IS the "compatible
// payload present" test a Paste command gates on (`canPasteWorkbook` below).
// A file-based fallback (a guarded, expiring temp package under the desktop
// bridge's write-consent discipline — the same shape `desktop_bridge.py`'s
// `save_file_dialog`/`write_project_file` pair already established) is
// EXPLICITLY DEFERRED, not built here: it is new filesystem-write authority,
// and CLAUDE.md's read-first section is unambiguous that any new authority
// like that must be backend-verifiable rather than caller-asserted — that
// needs its own careful, adversarially-reviewed contract PR (the same
// weight P1.7's `grant_source_paths` ruling got), which this slice's budget
// does not allow to do responsibly. Booked home: "PR I file-based transport
// fallback" as `desktop_bridge.py`'s next slice, triggered when a workbook
// is bounded-refused for size (`MAX_TRANSFER_PACKAGE_CHARS`) or when
// `copyText`/`readText` report unavailable — both cases already degrade
// HONESTLY today (a named refusal reason, never a silent truncation or a
// guessed success).
//
// FAILURE-SAFE CLEANUP (frozen-scope item 5): every failure path below
// (empty/oversize workbook, unparseable clipboard text, wrong format/
// version) returns BEFORE `recordHistory`/`set` is ever called — the
// destination is provably byte-identical on any refusal, because nothing
// mutates until `pasteTransferPackage` has ALREADY produced the complete
// replacement arrays ("build fully, swap once"). A successful paste is
// exactly one `recordHistory` call immediately followed by exactly one
// `set()` call touching every affected array together, so undo restores the
// pre-paste project in one step.

import { copyText } from "../lib/clipboard";
import {
  buildTransferPackage,
  parseTransferPackage,
  pasteTransferPackage,
  type TransferExistingIds,
  type TransferIdGenerators,
} from "../lib/workbookTransfer";
import type { AppState } from "./useApp";
import { nextDatasetId } from "./useApp";
import { nextWorkbookId } from "./workbookIds";
import { nextFigureId } from "./figureLifecycle";
import { toast } from "./toasts";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

let _reportSeq = 0;
/** Own generator (not useApp.ts's private `nextReportId`, which is
 *  unexported — see workbookIds.ts's identical "own module, own counter"
 *  rationale). Distinct prefix so a pasted report id can never collide with
 *  one useApp.ts itself mints, even in theory. */
const nextTransferReportId = (): string => `xrep-${Date.now().toString(36)}-${++_reportSeq}`;

let _templateSeq = 0;
const nextTransferTemplateId = (): string => `xqpt-${Date.now().toString(36)}-${++_templateSeq}`;

function idGenerators(): TransferIdGenerators {
  return {
    dataset: nextDatasetId,
    workbook: nextWorkbookId,
    figure: nextFigureId,
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

/** Merge a paste result into the store's arrays in ONE `set()` — the "swap
 *  once" half of the failure-safe contract; `recordHistory` must already
 *  have been called by the caller, immediately before this. */
function applyPasteResult(set: SliceSet, result: ReturnType<typeof pasteTransferPackage>): void {
  set((s) => ({
    workbooks: [...s.workbooks, result.workbook],
    datasets: [...s.datasets, ...result.datasets],
    editableFigures: [...s.editableFigures, ...result.editableFigures],
    reports: [...s.reports, ...result.reports],
    quickPlotTemplates: [...s.quickPlotTemplates, ...result.quickPlotTemplates],
  }));
}

export interface WorkbookTransferSlice {
  /** Copy — build a versioned package for `workbookId` and write it to the
   *  system clipboard as plain JSON text. Resolves any not-yet-loaded
   *  ("pending") member first (the same precondition `.dwk` save enforces).
   *  Reports the exact refusal reason on failure (too large, no worksheets,
   *  clipboard unavailable); never partially copies. */
  copyWorkbookToClipboard: (workbookId: string) => Promise<void>;
  /** Is there a compatible workbook package on the clipboard right now?
   *  `false` covers "no bridge", "not our format", and "clipboard read
   *  denied" alike — a UI Paste command gates on this rather than guessing. */
  canPasteWorkbook: () => Promise<boolean>;
  /** Paste — read the clipboard, validate the package, and land a fresh-id
   *  workbook + its members at `targetFolderId` (undefined = Library root).
   *  Leaves the project COMPLETELY untouched on any failure (bad/missing
   *  clipboard content, wrong format/version) — see this module's header.
   *  One history entry on success. */
  pasteWorkbookFromClipboard: (targetFolderId?: string) => Promise<void>;
  /** Duplicate — the same-project fast path (frozen-scope item 6): shares
   *  the identical build -> (JSON round trip) -> fresh-id-rewrite core as
   *  Copy/Paste, landing the duplicate in the SAME folder as the source
   *  workbook. Returns the new workbook's id, or `null` on refusal. */
  duplicateWorkbook: (workbookId: string) => Promise<string | null>;
}

export function createWorkbookTransferSlice(set: SliceSet, get: SliceGet): WorkbookTransferSlice {
  return {
    copyWorkbookToClipboard: async (workbookId) => {
      const workbook = get().workbooks.find((w) => w.id === workbookId);
      const name = workbook?.name ?? "workbook";
      const hasPending = get().datasets.some((d) => d.workbookId === workbookId && d.pending);
      if (hasPending) {
        get().setStatus(`resolving worksheets before copying "${name}"…`);
        try {
          await get().resolvePendingDatasets();
        } catch (e) {
          const msg = `copy "${name}" failed — couldn't load every worksheet: ${e instanceof Error ? e.message : "error"}`;
          get().setStatus(msg);
          toast(msg, "danger");
          return;
        }
      }
      const built = buildTransferPackage(workbookId, get());
      if (!built.ok) {
        get().setStatus(`copy "${name}" unavailable: ${built.reason}`);
        toast(`copy "${name}" unavailable: ${built.reason}`, "danger");
        return;
      }
      const wrote = await copyText(built.text);
      if (!wrote) {
        get().setStatus(`copy "${name}" failed: clipboard unavailable`);
        toast(`copy "${name}" failed: clipboard unavailable`, "danger");
        return;
      }
      get().setStatus(`copied "${name}" (${built.pkg.datasets.length} worksheet${built.pkg.datasets.length === 1 ? "" : "s"})`);
      toast(`copied "${name}"`, "ok");
    },

    canPasteWorkbook: async () => {
      try {
        const text = await navigator.clipboard?.readText();
        if (typeof text !== "string") return false;
        return parseTransferPackage(text).ok;
      } catch {
        return false;
      }
    },

    pasteWorkbookFromClipboard: async (targetFolderId) => {
      let text: string;
      try {
        const read = await navigator.clipboard?.readText();
        if (typeof read !== "string") {
          toast("paste workbook: clipboard unavailable", "danger");
          return;
        }
        text = read;
      } catch {
        toast("paste workbook: clipboard read denied", "danger");
        return;
      }
      const parsed = parseTransferPackage(text);
      if (!parsed.ok) {
        toast(`paste workbook: ${parsed.reason}`, "danger");
        return;
      }
      // Build fully BEFORE touching history/state (frozen-scope item 5) —
      // pasteTransferPackage is pure and cannot itself fail past this point.
      const result = pasteTransferPackage(parsed.pkg, existingIds(get()), idGenerators(), targetFolderId);
      get().recordHistory(`paste workbook "${parsed.pkg.workbook.name}"`);
      applyPasteResult(set, result);
      const n = result.datasets.length;
      const msg = `pasted "${result.workbook.name}" (${n} worksheet${n === 1 ? "" : "s"})`;
      get().setStatus(msg);
      toast(msg, "ok");
    },

    duplicateWorkbook: async (workbookId) => {
      const workbook = get().workbooks.find((w) => w.id === workbookId);
      const name = workbook?.name ?? "workbook";
      const hasPending = get().datasets.some((d) => d.workbookId === workbookId && d.pending);
      if (hasPending) {
        get().setStatus(`resolving worksheets before duplicating "${name}"…`);
        try {
          await get().resolvePendingDatasets();
        } catch (e) {
          const msg = `duplicate "${name}" failed — couldn't load every worksheet: ${e instanceof Error ? e.message : "error"}`;
          get().setStatus(msg);
          toast(msg, "danger");
          return null;
        }
      }
      const built = buildTransferPackage(workbookId, get());
      if (!built.ok) {
        get().setStatus(`duplicate "${name}" unavailable: ${built.reason}`);
        toast(`duplicate "${name}" unavailable: ${built.reason}`, "danger");
        return null;
      }
      // Same core as Paste (frozen-scope item 6) — round-tripped through the
      // identical parse validation for one code path, not two.
      const parsed = parseTransferPackage(built.text);
      if (!parsed.ok) {
        // Unreachable in practice (buildTransferPackage's own output always
        // parses) — defensive, never silently duplicates something broken.
        toast(`duplicate "${name}" failed: ${parsed.reason}`, "danger");
        return null;
      }
      const raw = pasteTransferPackage(parsed.pkg, existingIds(get()), idGenerators(), workbook?.folderId);
      // Duplicate's one deliberate divergence from Paste: the workbook's own
      // display name gets the same "X copy" convention every other
      // Duplicate in this app uses (store/figureLifecycle.ts's `duplicateEditableFigure`)
      // — Paste keeps the source name verbatim (it's a DIFFERENT project's
      // workbook arriving, not a copy of one already here).
      const result = { ...raw, workbook: { ...raw.workbook, name: `${name} copy` } };
      get().recordHistory(`duplicate workbook "${name}"`);
      applyPasteResult(set, result);
      const msg = `duplicated "${name}" as "${result.workbook.name}"`;
      get().setStatus(msg);
      toast(msg, "ok");
      return result.workbook.id;
    },
  };
}
