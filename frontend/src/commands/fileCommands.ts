// File-menu command registry entries (import/export/workspace/preferences) —
// split out of appCommands.ts (that module's own store-size ratchet,
// architecture.test.ts's STORE_PINS, had zero headroom). appCommands.ts
// stays the thin aggregator. It owns file/workspace commands plus figure
// build/export entries that are intentionally filed under Plot.

import { askConfirm } from "../components/overlays/ConfirmDialog";
import { exportConsolidated, exportHdf5, exportOrigin, exportXrdCsv, originComStatus, sendToOrigin } from "../lib/api";
import { makeDemoDataset } from "../lib/demo";
import { loadSampleDataset } from "../lib/sampleDataset";
import { clearAutosave } from "../lib/autosave";
import type { StoreGet } from "../lib/exportActive";
import { createFigureDocument } from "../lib/figureDocument";
import { chooseAndImport } from "../lib/importEntry";
import { IMPORT_ACCEPT, openFilePicker } from "../lib/openFilePicker";
import { openWorkspaceCommand } from "../lib/openWorkspaceCommand";
import {
  hasWorkspaceContent,
  recordNativeOpen,
  replaceConfirmMessage,
  replaceWorkspace,
  replaceWorkspaceSafely,
} from "../lib/openWorkspaceReplace";
import { importOriginTemplateFiles, TEMPLATE_ACCEPT } from "../lib/originTemplate";
import { snapshotView } from "../lib/plotview";
import type { Action } from "../store/commands";
import { ALREADY_RUNNING_MSG, isImportRunning, useImportBatch } from "../store/importDatasets";
import { withOp } from "../store/pendingOps";
import { toast } from "../store/toasts";

// P3.4 slice 1, 2026-07-26 audit gap #1: the double-import guard. The real
// chokepoint lives in store/importDatasets.ts's `runImport` (covers ⌘O, the
// Library toolbar button, drag-drop, and Recent-files — every entry point
// that calls importFiles/importPaths, however it got there). These two
// commands get an EXTRA pre-flight check so clicking "Import…" while a batch
// runs doesn't even pop a file dialog first; "import-append" additionally
// needs the guard applied here because `importFilesAppended` lives in
// useApp.ts (out of bounds for this slice — see importDatasets.ts's own
// comment on the same guard).
function rejectIfImportRunning(): boolean {
  if (!isImportRunning()) return false;
  toast(ALREADY_RUNNING_MSG, "danger");
  return true;
}

/** Wrap a dynamic `import()` in a pendingOp (F5, 2026-09-13 adversarial
 *  review of d6e67fb7's P3.4 export-cancel commit): every `void`-prefixed
 *  export command body below is a bare `void import(...).then((m) =>
 *  m.runX(...))` with no `.catch` — a failed chunk load (offline right
 *  after a deploy, a stale cached HTML referencing a since-rotated hash) is
 *  a completely silent no-op PLUS an unhandled-rejection console warning,
 *  and for export-csv/export-hdf5 specifically a REGRESSION: before this
 *  file's bodies were moved behind a dynamic import, the export logic ran
 *  inline, so any failure was always caught by exportActive's own try/catch.
 *  The import step itself is new, and it sits OUTSIDE that try/catch.
 *
 *  This closes both gaps: `withOp` gives the click-to-chunk-loaded window
 *  (previously invisible) a busy indicator, and the `.catch` below toasts a
 *  load failure instead of leaving it unhandled. It wraps ONLY the import —
 *  by the time `load()` resolves, `endOp` has already fired (withOp's own
 *  `finally`), so the loaded module's own body (exportActive.ts's callers
 *  register their OWN pendingOp) never overlaps this one. Rethrows on
 *  failure so the caller's own `.then(...)` is skipped — the caller must
 *  still handle THAT rejection, with `.then(onRun, onLoadFailure)` (see
 *  `onLoadFailure` below and any call site); a success from the module's own
 *  body never reaches this catch, so it can't double-toast a failure
 *  exportActive already reported through its own status/toast. */
// 2026-09-14: now shared beyond this module — `commands/dataCommands.ts`
// (worksheet reshapes) and `commands/plotCommands.ts` (Page setup) wrap their
// own chunk-deferred `run` bodies in it, for the identical reason. It stays
// here rather than moving to a neutral module because both importers are
// already eagerly reachable through `appCommands.ts`, so the import moves no
// chunk boundary (measured), and moving an exported helper that
// `fileCommands.test.ts` pins directly would be churn with no benefit.
// N3 (2026-09-13 round-2 review): `label` is the pendingOps busy text
// ("Loading CSV export…"), already gerund-shaped — appending "failed to
// load" to it read as "Loading CSV export failed to load", doubling "load".
export function runLazy<M>(label: string, load: () => Promise<M>): Promise<M> {
  return withOp(label, load).catch((e: unknown) => {
    const what = label.replace(/^Loading\s+/, "").replace(/…$/, "");
    const msg = `Could not load the ${what}: ${e instanceof Error ? e.message : "error"}`;
    toast(msg, "danger");
    throw e;
  });
}

/** The ONLY rejection a chunk-deferred command body may swallow: the chunk
 *  load, which `runLazy` has already toasted.
 *
 *  Pass it as the SECOND argument of `.then(onRun, onLoadFailure)`, never as a
 *  trailing `.catch(() => {})`. A trailing `.catch` sits after `.then`, so it
 *  also swallows whatever the LOADED HANDLER throws — measured 2026-09-15 on
 *  the transpose seam: a handler that threw produced no toast, no status and
 *  no console error. With the two-argument form that throw reaches neither
 *  this function nor `runLazy`'s catch, and surfaces as an unhandled
 *  rejection — CONSOLE ONLY: `runAction` (`store/commands.ts`) never wraps
 *  these (each seam's `run` is `() => void runLazy(…)`, so `result` is not
 *  thenable) and `frontend/src` installs no `unhandledrejection` listener, so
 *  no toast, no status, no `pendingOps` entry. Scoped 2026-09-15 (review
 *  round 2, finding 4): that restores what 6 of the 7 seams did before
 *  lazification — the five exports and Page setup already rejected
 *  asynchronously — but the reshape seam (`dataCommands.ts`) threw
 *  SYNCHRONOUSLY out of `run()` as a loud React event-handler error, louder
 *  than this. Making it loud again is UX-003's call, not this helper's. */
export const onLoadFailure = (): void => {
  /* runLazy already toasted the load failure */
};

let demoCounter = 0;
let sampleCounter = 0;

// replaceWorkspace/replaceWorkspaceSafely/hasWorkspaceContent/
// replaceConfirmMessage — the "open workspace" replace-and-confirm helpers
// shared by both open commands below — live in lib/openWorkspaceReplace.ts
// (this module's own size ratchet, RSM_CUTS_PLAN #20's general ceiling).
// `openWorkspaceCommand` itself — the shared pick/native-open + parse flow
// both "open-workspace"/"open-workspace-safe" and "append-workspace" call
// below — lives in lib/openWorkspaceCommand.ts for the identical reason
// (P1.1 C3's native-open wiring pushed this module over the ceiling; see
// that file's header for the extraction note).

/** Build the File-group curated palette actions against the live store
 *  handle (`useApp.getState`) — store setters are stable, so callers build
 *  once. */
export function buildFileCommands(s: StoreGet): Action[] {
  return [
    {
      id: "import",
      group: "File",
      label: "Import data…",
      description: "Open one or more supported data files as datasets.",
      shortcut: "⌘O",
      run: () => {
        if (rejectIfImportRunning()) return;
        void chooseAndImport(s());
      },
    },
    {
      id: "import-append",
      group: "File",
      label: "Import & append as one dataset…",
      description: "Import multiple compatible files and concatenate them into one dataset.",
      keywords: "combine concatenate merge multi-file append",
      run: () => {
        if (rejectIfImportRunning()) return;
        openFilePicker((files) => {
          if (files.length === 0) return;
          // importFilesAppended lives in useApp.ts (this slice's off-limits
          // file), so its busy state is set/cleared HERE rather than inside
          // the action itself — see the guard comment above. withOp gives it
          // the same StatusBar presence importFiles/importPaths get (no
          // cancel: the underlying upload loop has no AbortController, since
          // adding one means touching useApp.ts).
          useImportBatch.setState({ running: true });
          void withOp(`Importing ${files.length} files to append…`, () =>
            s().importFilesAppended(files),
          )
            .catch(() => {
              /* importFilesAppended already reports its own status/toast */
            })
            .finally(() => useImportBatch.setState({ running: false }));
        }, IMPORT_ACCEPT);
      },
    },
    {
      id: "import-wizard",
      group: "File",
      label: "Import wizard (guided preview + saved filters)…",
      description: "Preview and configure messy or unfamiliar files, then save the import settings for reuse.",
      keywords: "guess preview parse delimiter header units filter messy",
      run: () => s().setImportWizardOpen(true),
    },
    {
      id: "import-origin-template",
      group: "File",
      label: "Import Origin template (.otp/.otpu)…",
      description: "Import plot styling and layout from an Origin graph template.",
      keywords: "otp otpu origin graph template style preset",
      run: () => openFilePicker((files) => void importOriginTemplateFiles(files), TEMPLATE_ACCEPT),
    },
    {
      id: "demo",
      group: "File",
      label: "Add demo dataset",
      description: "Add a generated demonstration dataset for quickly trying plots and analysis.",
      run: () =>
        s().addDataset({
          id: `demo-${++demoCounter}`,
          name: `demo-${demoCounter}.dat`,
          data: makeDemoDataset(),
        }),
    },
    {
      id: "load-sample",
      group: "File",
      label: "Load sample dataset (bundled)",
      description: "Load the bundled sample data for a guided first workflow without finding a file.",
      keywords: "demo example first-run VSM hysteresis try this",
      run: () => {
        void loadSampleDataset().then(({ data, name, offline }) => {
          s().addDataset({ id: `sample-${++sampleCounter}`, name, data });
          const msg = offline
            ? "sample endpoint unavailable — added offline demo instead"
            : `loaded sample dataset (${name})`;
          s().setStatus(msg);
          toast(msg, offline ? "info" : "ok");
        });
      },
    },
    {
      id: "save-workspace",
      group: "File",
      label: "Save workspace (.dwk)…",
      description: "Save datasets, folders, figures, results, and settings as a Quantized workspace.",
      // Resolving pending lazy books (#38) before serializing lives in the
      // store (saveWorkspaceToFile) — not here, so this stays a thin command
      // like every other one in this list. Always prompts (native Save As
      // dialog, or a browser download) — never reuses a known project path.
      // P1.2 originally renamed this to "...as (.dwk)…" to disambiguate from
      // a sibling quick-save command (⌘S); that command was later removed
      // for bundle-size reasons (AppOverlays.tsx's eager budget), leaving
      // the "as" with nothing left to disambiguate FROM — reverted back to
      // the original label, which is also the exact-text locator
      // e2e/specs/quick-figure-lifecycle.spec.ts drives to trigger a real
      // browser download (pinned by commands/fileCommands.test.ts).
      run: () => s().saveWorkspaceToFile(),
    },
    {
      id: "pack-project",
      group: "File",
      label: "Pack Project…",
      description: "Create a portable, self-contained copy of the open project and its source files.",
      keywords: "pack project portable bundle copy sources",
      // Body lives in lazily-imported commands/packProjectCommands.ts (that
      // module's own doc comment) — keeps the desktop-shell check,
      // usePackProjectPanel, and store/packProject.ts off the eager bundle.
      run: () => import("./packProjectCommands").then((m) => m.runPackProject()),
    },
    {
      id: "open-workspace",
      group: "File",
      label: "Open workspace (.dwk)…",
      description: "Replace the current session with a previously saved Quantized workspace.",
      // `loadWorkspace` REPLACES the entire library — confirm + undo-record
      // here (not inside `loadWorkspace`, which also has two legitimate
      // non-interactive callers: `clearAll`, and the startup autosave
      // restore, which must never prompt). P3.4 slice 4: `replaceWorkspace`
      // stages every restored window except the active/linked ones behind a
      // placeholder until its drain turn, instead of mounting all at once.
      run: openWorkspaceCommand(s, "open", (ws, native) => {
        if (!hasWorkspaceContent(s)) return replaceWorkspace(s, ws, native);
        void askConfirm("Replace the current workspace?", replaceConfirmMessage(s().datasets.length), "Replace", true).then(
          (ok) => ok && replaceWorkspace(s, ws, native),
        );
      }),
    },
    {
      id: "open-workspace-safe",
      group: "File",
      label: "Open without layout…",
      description: "Replace the current session with a saved workspace, skipping its saved window layout.",
      keywords: "safe recovery layout skip windows corrupted crash",
      // Same replace-and-confirm flow as "open-workspace" above, via
      // replaceWorkspaceSafely (skipLayout: true).
      run: openWorkspaceCommand(s, "open", (ws, native) => {
        if (!hasWorkspaceContent(s)) return replaceWorkspaceSafely(s, ws, native);
        const extra = " The saved window layout will be skipped — everything opens in one default window.";
        void askConfirm(
          "Replace the current workspace?",
          replaceConfirmMessage(s().datasets.length, extra),
          "Replace",
          true,
        ).then((ok) => ok && replaceWorkspaceSafely(s, ws, native));
      }),
    },
    {
      id: "append-workspace",
      group: "File",
      label: "Append workspace (.dwk)…",
      description: "Merge another saved workspace into the current library without replacing it.",
      keywords: "merge combine import project origin append second library",
      // P3.4 slice 4: no stageWorkspaceRestore call here — appendWorkspace
      // only merges `datasets` (store/useApp.ts), never `plotWindows`, so an
      // append can't trigger the multi-window mount storm loadWorkspace can.
      //
      // DEFECT A fix (2026-08-21): append never gates on a confirm (unlike
      // open/open-safe — see the comment on that guard above), so recording
      // the Recent Projects entry right here, at the actual merge, can never
      // over-record; it just can't share openWorkspaceReplace.ts's
      // `replaceWorkspace` chokepoint (append doesn't call it) so it gets
      // its own push at its own commit point instead.
      run: openWorkspaceCommand(s, "append", (ws, native) => {
        s().appendWorkspace(ws);
        recordNativeOpen(native);
      }),
    },
    {
      id: "clear-autosave",
      group: "File",
      label: "Clear autosaved workspace…",
      description: "Delete the recovery snapshot while leaving the currently open workspace unchanged.",
      run: () => {
        void clearAutosave();
        s().setStatus("autosaved workspace cleared (current library unchanged)");
      },
    },
    {
      id: "remove-all",
      group: "File",
      label: "Remove all…",
      description: "Permanently clear every dataset, folder, report, and imported figure from the session.",
      run: () => {
        const n = s().datasets.length;
        if (n === 0) {
          s().setStatus("library is already empty");
          return;
        }
        void askConfirm(
          "Remove everything?",
          `This removes all ${n} dataset${n === 1 ? "" : "s"}, plus every folder and ` +
            `imported figure. This can't be undone.`,
          "Remove all",
          true,
        ).then((ok) => {
          if (!ok) return;
          s().clearAll();
          toast("removed all datasets", "ok");
        });
      },
    },
    {
      id: "export-csv",
      group: "File",
      label: "Export XRD CSV…",
      description: "Export the active dataset as a diffraction-friendly CSV file.",
      // Body lives in lazily-imported commands/fileCommandsLazy.ts (bundle-
      // size ratchet — P3.4 safe-cancel-for-export pushed lib/exportActive.ts
      // itself out of the eager path; see that file's own doc comment).
      // `void`-prefixed: exportActive registers its OWN cancellable pendingOp
      // now, so letting runAction's generic wrap ALSO register this promise
      // under the action's label would show two competing busy entries.
      // runLazy (F5) — see that function's own doc — covers the import step
      // itself, which sits outside exportActive's own error handling.
      run: () =>
        // TWO-argument `.then` throughout: a throw from the loaded handler is
        // deliberately NOT swallowed here — see `onLoadFailure`.
        void runLazy("Loading CSV export…", () => import("./fileCommandsLazy"))
          .then((m) => m.runExportXrdCsv(s, exportXrdCsv), onLoadFailure),
    },
    {
      id: "export-hdf5",
      group: "File",
      label: "Export HDF5…",
      description: "Export the active dataset and available raw/corrected forms to HDF5.",
      // Body lives in lazily-imported commands/fileCommandsLazy.ts — see
      // "export-csv" above (same `void`-prefix + runLazy reasoning).
      run: () =>
        void runLazy("Loading HDF5 export…", () => import("./fileCommandsLazy"))
          .then((m) => m.runExportHdf5(s, exportHdf5), onLoadFailure),
    },
    {
      id: "figure-builder",
      group: "Plot",
      section: "Build & export",
      label: "Publication preview…",
      description: "Preview or export the focused figure at publication size; Apply updates that figure without changing its data.",
      // Legacy names stay searchable — the F0.1 rename must not orphan
      // "figure builder" muscle memory in the palette or Help.
      keywords: "figure builder live preview publication",
      run: () => {
        if (s().figurePublicationSession) {
          s().setStatus("finish or cancel the current Publication Preview before opening another");
          return;
        }
        if (s().beginFigurePublicationEdit()) return;
        // F2.1e: no focused plot window. With no active dataset either, this
        // degrades exactly as before -- the legacy FigureBuilderView opens
        // with nothing to show ("Select a dataset to preview a figure.").
        // With an active dataset, open the SAME detached canonical session
        // Graph Builder's openInFigureBuilder uses
        // (beginDetachedFigurePublicationEdit), synthesized from the active
        // dataset + the live on-screen view (snapshotView mirrors channels,
        // scales, styles, decor) rather than the old legacy-mode preview --
        // so Apply now creates a new editable figure instead of being a dead
        // end.
        const state = s();
        const active = state.datasets.find((dataset) => dataset.id === state.activeId);
        if (!active) {
          s().setStatus("no plot window is focused — previewing the active dataset; Apply is unavailable in this mode");
          s().setFigureBuilderOpen(true);
          return;
        }
        const draft = createFigureDocument({
          id: `figure-preview-${active.id}`,
          name: active.name,
          datasetId: active.id,
          view: snapshotView(state),
        });
        if (s().beginDetachedFigurePublicationEdit(draft)) {
          s().setStatus(
            `no plot window is focused — previewing "${active.name}"; Apply will save it as a new editable figure`,
          );
        }
      },
    },
    {
      id: "figure-page",
      group: "Plot",
      section: "Build & export",
      label: "Multi-panel export…",
      description: "Temporarily compose multiple plots into an aligned publication page, then export it.",
      // Legacy names stay searchable — the F0.4 rename must not orphan
      // "figure page" muscle memory in the palette or Help.
      keywords: "figure page multi panel composite",
      run: () => s().setFigurePageOpen(true),
    },
    {
      id: "export-figure",
      group: "Plot",
      section: "Build & export",
      label: "Export figure…",
      description: "Export the current plot or composed page to a publication-ready image or vector file.",
      // Body lives in lib/exportFigureCommand (store-size ratchet offset for
      // MAIN_PLAN #16's Append workspace command — see that file's doc).
      // Bundle: click-only — dynamic import keeps lib/exportFigureCommand
      // (and the figureSpec transport builder behind it) off the eager path.
      // runLazy (F5) — see that function's own doc.
      run: () =>
        void runLazy("Loading figure export…", () => import("../lib/exportFigureCommand"))
          .then((m) => m.runExportFigureCommand(s), onLoadFailure),
    },
    {
      id: "export-origin",
      group: "File",
      label: "Export Origin (.ogs)…",
      description: "Export data and current plot settings as an Origin script plus accompanying data.",
      // Body lives in lazily-imported commands/fileCommandsLazy.ts (bundle-
      // size ratchet — see that file's own doc comment on WHY the api.ts
      // calls stay imported here, eagerly, and are passed in as arguments
      // rather than re-imported by the lazy module). `void`-prefixed since
      // P3.4: runExportOrigin routes through exportActive, which now
      // registers its own cancellable pendingOp — see "export-csv" above.
      // runLazy (F5) — see that function's own doc.
      run: () =>
        void runLazy("Loading Origin export…", () => import("./fileCommandsLazy"))
          .then((m) => m.runExportOrigin(s, exportOrigin), onLoadFailure),
    },
    {
      id: "send-to-origin",
      group: "File",
      label: "Send to Origin (COM)…",
      description: "Send selected datasets directly to a running Origin session on supported Windows systems.",
      // Body lives in lazily-imported commands/fileCommandsLazy.ts (bundle-
      // size ratchet — see that file's own doc comment): a Windows-only,
      // feature-flagged COM path most sessions never touch has no business
      // sitting in the eager entry chunk.
      run: () => import("./fileCommandsLazy").then((m) => m.runSendToOrigin(s, originComStatus, sendToOrigin)),
    },
    {
      id: "export-consolidated",
      group: "File",
      label: "Export consolidated CSV…",
      description: "Combine every loaded dataset into one consolidated CSV export.",
      // Body lives in lazily-imported commands/fileCommandsLazy.ts (bundle-
      // size ratchet — see that file's own doc comment).
      run: () => import("./fileCommandsLazy").then((m) => m.runExportConsolidated(s, exportConsolidated)),
    },
    {
      id: "preferences",
      group: "File",
      label: "Preferences…",
      description: "Configure application appearance, behavior, and persistent user preferences.",
      shortcut: "⌘,",
      run: () => s().setPrefsOpen(true),
    },
    {
      id: "export-page",
      group: "File",
      label: "Export page… (spatial, true page coords)",
      description: "Export an imported multi-panel page using its original spatial page coordinates.",
      keywords: "origin multi-panel page rect true coordinates #54",
      // Body lives in lazily-imported lib/exportPageCommand.ts (bundle-size
      // ratchet — P3.4 safe-cancel-for-export's own pendingOps/AbortController
      // wiring pushed this off fileCommands.ts's eager import list; see that
      // file's own header). `void`-prefixed like every other export body in
      // this file that registers its OWN pendingOps entry (exportActive.ts's
      // callers do the same) — the command body now provides its own
      // cancellable "Exporting page…" op directly, so letting runAction's
      // generic wrap ALSO register this promise under the action's label
      // would show two competing busy entries for one export. runLazy (F5)
      // — see that function's own doc.
      run: () =>
        void runLazy("Loading page export…", () => import("../lib/exportPageCommand"))
          .then((m) => m.runExportSpatialPageCommand(s), onLoadFailure),
    },
  ];
}
