// The report-sheet and figure-document lifecycle, extracted from
// store/useApp.ts (audit P4.1 — "decompose high-risk frontend god-modules,
// characterization tests first"; store-size ratchet, MAIN_PLAN #2). The SECOND
// domain to leave that file, after store/plotViewSettings.ts — read its header
// first: `useApp` spreads `createReportsFigureDocsSlice(set, get)` into the ONE
// store instance, so every existing `useApp((s) => s.figureDocs)` selector and
// `useApp.getState().addReport(...)` call keeps working. This file is a code
// boundary, not a second store.
//
// WHAT THIS MODULE OWNS: every action that writes the two library-document
// collections — the report sheets (#36) `reports`/`openReportId` (add, remove,
// rename, open) and the legacy publication-preview figure documents (#12)
// `figureDocs`/`figureDocSeed` (add, remove, rename, duplicate, open as a
// draft, open by id, open in a new window, clear the seed).
//
// WHAT IT DOES NOT OWN, deliberately:
//   - the FIELDS themselves. They stay declared (and initialized) on
//     `AppState` in store/useApp.ts. "Owns" here means this module holds
//     every ACTION that edits them one at a time; bulk paths write them
//     wholesale and stay outside the cluster on purpose (2026-09-17 review
//     finding F4: an earlier version of this note claimed the fields were
//     "touched by nothing else outside loadWorkspace's bulk hydrate", which
//     is false) — `loadWorkspace`'s `.dwk` hydrate, store/trash.ts's delete
//     delegates, store/trashRestore.ts's restore-from-trash,
//     store/workbookTransfer.ts's workbook import, and
//     store/historySnapshot.ts's undo/redo restore. Same shape as
//     store/plotViewSettings.ts and store/corrections.ts, which write shared
//     fields without owning them.
//   - the CANONICAL editable figures (`editableFigures`, `FigureDocument`).
//     Those are a different collection with their own slice,
//     store/figureLifecycle.ts; a `FigureDoc` here is the legacy Publication
//     Preview model. `openFigureDraft` only READS that slice's
//     `figurePublicationSession` to refuse while a session is open.
//   - what happens to a removed document. Both deletes delegate to
//     store/trash.ts's `removeReportWithTrash`/`removeFigureDocWithTrash`,
//     which own the trash entry, its byte estimate and its restore rule.
//   - the `.dwk` round-trip of either collection (store/workspaceIO.ts) and
//     the report VIEWER (components/, which only calls `setOpenReport`).
//
// WHAT IT MUST NOT IMPORT: nothing from `../components`, and no React —
// architecture.test.ts's "store/ layering guard" enforces the components/ half
// for this file specifically (only reimport.ts, reimportAllRun.ts and
// originFigureApply.ts are grandfathered, and this is not one of them); the
// React half is convention, not test-enforced. It must also not import a VALUE
// from ./useApp: `AppState` is imported as a TYPE only, so the runtime import
// graph stays one-directional (useApp -> here), which is why the `rep-`/`figd-`
// id sequence it mints from lives in the leaf module ./idSeq rather than in
// useApp.ts where it used to sit.
//
// Characterization tests: store/reportsFigureDocs.characterization.test.ts
// pins every action below — the fields written (and, against a poisoned
// snapshot, the ones NOT written), that none of the twelve pushes an undo
// entry, the single macro step, what reaches the trash, and an edge case each.
// They were written and run GREEN against the pre-extraction code in
// useApp.ts, and pass BYTE-UNCHANGED against this module.

import { docRenderable, type FigureDoc } from "../lib/figuredoc";
import { lit } from "../lib/macro";
import { dedupeWindowTitle, displayedWindowTitle } from "../lib/plotview";
import type { ReportEntry, ReportSheet } from "../lib/report";
import { plotIntentStageTab } from "../lib/stagetab";
import { nextFigureDocId, nextReportId } from "./idSeq";
import { toast } from "./toasts";
import { removeFigureDocWithTrash, removeReportWithTrash } from "./trash";
import type { AppState } from "./useApp";
import { withWindowDocumentErrors } from "./windowDocuments";

export interface ReportsFigureDocsSlice {
  // Report sheets (#36): add opens the viewer on the new report.
  addReport: (name: string, report: ReportSheet, datasetId?: string | null) => void;
  removeReport: (id: string) => void;
  renameReport: (id: string, name: string) => void;
  setOpenReport: (id: string | null) => void;
  // Figure documents (#12).
  addFigureDoc: (doc: FigureDoc) => void;
  removeFigureDoc: (id: string) => void;
  renameFigureDoc: (id: string, name: string) => void;
  duplicateFigureDoc: (id: string) => void;
  /** Open an ephemeral or saved FigureDoc without adding it to the library. */
  openFigureDraft: (doc: FigureDoc) => void;
  openFigureDoc: (id: string) => void;
  // Item 9's figure-doc half: opens a NEW window bound to the doc's dataset
  // and applies its channel/scale/label config (xKey/yKeys/log flags/titles)
  // onto it. Live docs with a resolved dataset only — a frozen doc's data
  // snapshot isn't a live `Dataset` a window can bind to (that's Tier 3 item
  // 11's "snapshot-as-window" kind); a no-op otherwise.
  openFigureDocInWindow: (id: string) => void;
  clearFigureDocSeed: () => void;
}

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

export function createReportsFigureDocsSlice(set: SliceSet, get: SliceGet): ReportsFigureDocsSlice {
  return {
    // Report sheets (#36). Adding opens the viewer on the new report so the
    // producing workshop's "→ Report" lands somewhere visible immediately.
    addReport: (name, report, datasetId) =>
      set((s) => {
        const entry: ReportEntry = {
          id: nextReportId(),
          name,
          datasetId: datasetId ?? null,
          report,
        };
        return {
          reports: [...s.reports, entry],
          openReportId: entry.id,
          status: `report "${name}" created`,
        };
      }),
    removeReport: (id) => removeReportWithTrash(get, set, id),
    renameReport: (id, name) =>
      set((s) => ({
        reports: s.reports.map((r) => (r.id === id ? { ...r, name } : r)),
      })),
    setOpenReport: (openReportId) => set({ openReportId }),
    // ── Figure documents (#12) ──────────────────────────────────────────────
    addFigureDoc: (doc) => set((s) => ({
      figureDocs: [...s.figureDocs, doc], status: `figure "${doc.name}" saved`,
    })),
    removeFigureDoc: (id) => removeFigureDocWithTrash(get, set, id),
    renameFigureDoc: (id, name) => set((s) => ({
        figureDocs: s.figureDocs.map((f) => (f.id === id ? { ...f, name } : f)),
    })),
    duplicateFigureDoc: (id) =>
      set((s) => {
        const src = s.figureDocs.find((f) => f.id === id);
        if (!src) return {};
        const copy: FigureDoc = {
          ...src,
          id: nextFigureDocId(),
          name: `${src.name} copy`,
        };
        return { figureDocs: [...s.figureDocs, copy] };
    }),
    openFigureDraft: (doc) => {
      if (get().figurePublicationSession) { toast("finish or cancel the current Publication Preview first", "danger"); set({ status: "finish or cancel the current Publication Preview first" }); return; } if (!doc || !docRenderable(doc, new Set(get().datasets.map((dataset) => dataset.id)))) return;
      if (doc.live && doc.datasetId) get().setActive(doc.datasetId);
      set({ figureDocSeed: doc, figureBuilderOpen: true });
    },
    openFigureDoc: (id) => {
      const doc = get().figureDocs.find((f) => f.id === id);
      if (doc) get().openFigureDraft(doc);
    },
    // Item 9's figure-doc half: a live doc only (a frozen doc's snapshot isn't
    // a live `Dataset` a window can bind to — that gap is Tier 3 item 11's
    // "snapshot-as-window"). Creates + focuses a new window bound to the doc's
    // dataset, then applies the config's channel/scale/label fields — NOT its
    // `seriesStyles` (a `FigureConfig` carries the EXPORT style shape,
    // `ExportSeriesStyle[]`, which has no inverse back to the live
    // `Record<number,SeriesStyle>`; the window opens with default series styling.
    openFigureDocInWindow: (id) => {
      const doc = get().figureDocs.find((f) => f.id === id);
      if (!doc || !doc.live || !doc.datasetId) return;
      const s = get();
      if (!s.datasets.some((dataset) => dataset.id === doc.datasetId)) return;
      const title = dedupeWindowTitle(
        doc.name,
        s.plotWindows.map((w) => displayedWindowTitle(w, s.datasets)),
      );
      const winId = s.createWindow(doc.datasetId, undefined, title);
      s.focusWindow(winId);
      const c = doc.config;
      const targetDs = s.datasets.find((d) => d.id === doc.datasetId);
      set((current) => ({
        // Plot-intent (item 1): "open in new window" always means look at the
        // plot, so surface it regardless of which tab was showing.
        ...(targetDs ? { stageTab: plotIntentStageTab(targetDs) } : {}),
        xKey: c.xKey,
        yKeys: c.yKeys,
        // P1.5: a legacy FigureDoc's own grouping (Graph Builder's
        // plotSpecToFigureDoc is the only producer) now carries over into the
        // opened window's live groupKey too, same as xKey/yKeys just above --
        // previously this whole binding was silently dropped on "open in window".
        groupKey: c.groupCol ?? null,
        xScale: c.xScale,
        yScale: c.yScale,
        plotTitle: c.title,
        xAxisLabel: c.xLabel,
        yAxisLabel: c.yLabel,
        // Item 3: the doc's own error bindings, if any (else createWindow's dataset-seeded errorRoles stand).
        ...(c.errors ? withWindowDocumentErrors(current.plotWindows, winId, c.errors) : {}),
      }));
      get().recordMacro(`Open figure "${doc.name}" in new window`, `qz.openFigureDocInWindow(${lit(id)})`);
    },
    clearFigureDocSeed: () => set({ figureDocSeed: null }),
  };
}
