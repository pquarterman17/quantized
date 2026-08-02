// File-menu command registry entries (import/export/workspace/preferences) —
// split out of appCommands.ts (that module's own store-size ratchet,
// architecture.test.ts's STORE_PINS, had zero headroom). appCommands.ts
// stays the thin aggregator. It owns file/workspace commands plus figure
// build/export entries that are intentionally filed under Plot.

import { askConfirm } from "../components/overlays/ConfirmDialog";
import {
  exportConsolidated,
  exportHdf5,
  exportOrigin,
  exportXrdCsv,
  originComStatus,
  sendToOrigin,
} from "../lib/api";
import { makeDemoDataset } from "../lib/demo";
import { loadSampleDataset } from "../lib/sampleDataset";
import { clearAutosave } from "../lib/autosave";
import { exportActive, type StoreGet } from "../lib/exportActive";
import { runExportFigureCommand } from "../lib/exportFigureCommand";
import { runExportSpatialPageCommand } from "../lib/exportPageCommand";
import { chooseAndImport } from "../lib/importEntry";
import { IMPORT_ACCEPT, openFilePicker } from "../lib/openFilePicker";
import { importOriginTemplateFiles, TEMPLATE_ACCEPT } from "../lib/originTemplate";
import { currentViewport, parseWorkspaceFile } from "../lib/parseWorkspaceFile";
import type { LoadedWorkspace } from "../lib/workspace";
import type { Action } from "../store/commands";
import { ALREADY_RUNNING_MSG, isImportRunning, useImportBatch } from "../store/importDatasets";
import { withOp } from "../store/pendingOps";
import { toast } from "../store/toasts";
import { stageWorkspaceRestore } from "../store/windowHydration";

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

let demoCounter = 0;
let sampleCounter = 0;

/** `loadWorkspace` + the P3.4 slice 4 staging call that must immediately
 *  follow it (see `stageWorkspaceRestore`'s doc) — shared by open-workspace's
 *  two branches (empty library, and the confirmed-replace path) so the
 *  three-statement sequence isn't duplicated. */
function replaceWorkspace(s: StoreGet, ws: LoadedWorkspace): void {
  s().recordHistory("open workspace");
  s().loadWorkspace(ws);
  stageWorkspaceRestore(s().plotWindows, s().focusedWindowId);
}

/** Shared Open/Append-workspace flow (the only difference between the two
 *  File commands): pick a .dwk, parse it, and hand the result to `dispatch`
 *  (`loadWorkspace` or `appendWorkspace`).
 *
 *  P3.4 slice 3: the picker's `onchange` callback fires the moment a file is
 *  chosen — well before any parsing starts — so the `withOp` busy state is
 *  registered HERE, inside the callback, not around the `openFilePicker`
 *  call itself (which would show "Opening…" while the OS file dialog is
 *  merely sitting open and the user hasn't picked anything yet). The parse
 *  itself runs off the main thread via `parseWorkspaceFile` (a module Worker
 *  when available, the prior synchronous path as a fallback) — see that
 *  module's doc comment for why the two paths can't diverge. */
function openWorkspaceCommand(
  s: StoreGet,
  verb: string,
  dispatch: (ws: LoadedWorkspace) => void,
): () => void {
  const label = verb === "open" ? "Opening workspace…" : "Appending workspace…";
  return () =>
    openFilePicker((files) => {
      const file = files[0];
      if (!file) return;
      void withOp(label, () => parseWorkspaceFile(file, currentViewport()))
        .then(dispatch)
        .catch((e: unknown) =>
          s().setStatus(`${verb} failed: ${e instanceof Error ? e.message : "error"}`),
        );
    }, ".dwk,.json");
}

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
      // like every other one in this list.
      run: () => s().saveWorkspaceToFile(),
    },
    {
      id: "open-workspace",
      group: "File",
      label: "Open workspace (.dwk)…",
      description: "Replace the current session with a previously saved Quantized workspace.",
      // `loadWorkspace` REPLACES the entire library (datasets, folders,
      // reports, figure docs, saved specs, macro steps, windows) -- clearAll's
      // own comment calls it "loadWorkspace's replace-everything reset". The
      // strictly LESS destructive "Remove all…" above both confirms and
      // records undo; this path did neither, and the 800ms autosave debounce
      // then overwrote the discarded session's autosave record too.
      //
      // The guard lives HERE, not inside `loadWorkspace`, because that action
      // has two legitimate non-interactive callers: `clearAll` (already
      // confirmed at its own call site) and the startup autosave restore
      // (useWorkspaceAutosave), which must never prompt.
      // P3.4 slice 4: `replaceWorkspace` stages every restored window except
      // the active/linked ones behind a placeholder until its drain turn,
      // instead of all mounting — and each creating a live uPlot instance —
      // in one commit.
      run: openWorkspaceCommand(s, "open", (ws) => {
        const n = s().datasets.length;
        if (n === 0) return replaceWorkspace(s, ws);
        void askConfirm(
          "Replace the current workspace?",
          `Opening this file discards the ${n} dataset${n === 1 ? "" : "s"} currently ` +
            `loaded, plus every folder, report and saved figure. Save your work first ` +
            `if you need it.`,
          "Replace",
          true,
        ).then((ok) => ok && replaceWorkspace(s, ws));
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
      run: openWorkspaceCommand(s, "append", (ws) => s().appendWorkspace(ws)),
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
      run: () =>
        exportActive(s, (stem, ds) => exportXrdCsv({ dataset: ds.data, filename: stem })),
    },
    {
      id: "export-hdf5",
      group: "File",
      label: "Export HDF5…",
      description: "Export the active dataset and available raw/corrected forms to HDF5.",
      run: () =>
        exportActive(s, (stem, ds) =>
          exportHdf5(
            ds.raw
              ? { dataset: ds.raw, corrected: ds.data, filename: stem }
              : { dataset: ds.data, filename: stem },
          ),
        ),
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
        if (s().beginFigurePublicationEdit()) return;
        s().setStatus("opened Publication Preview without an editable plot document");
        s().setFigureBuilderOpen(true);
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
      run: () => runExportFigureCommand(s),
    },
    {
      id: "export-origin",
      group: "File",
      label: "Export Origin (.ogs)…",
      description: "Export data and current plot settings as an Origin script plus accompanying data.",
      run: () =>
        exportActive(s, (stem, ds) =>
          exportOrigin({
            dataset: ds.data,
            filename: stem,
            log_x: s().xScale === "log", // Origin's own axis type is boolean-only
            log_y: s().yScale === "log",
            // Current plot state -> an Origin GRAPH, not just the workbook (item 26).
            graph: {
              y_keys: s().yKeys,
              x_key: s().xKey,
              x_log: s().xScale === "log",
              y_log: s().yScale === "log",
              x_lim: s().xLim,
              y_lim: s().yLim,
              y2_keys: s().y2Keys ?? [],
            },
          }),
        ),
    },
    {
      id: "send-to-origin",
      group: "File",
      label: "Send to Origin (COM)…",
      description: "Send selected datasets directly to a running Origin session on supported Windows systems.",
      run: async () => {
        // Selected datasets when a multi-selection exists, else the active one.
        const all = s().datasets;
        const sel = all.filter((d) => s().selectedIds.includes(d.id));
        const targets = sel.length > 0 ? sel : all.filter((d) => d.id === s().activeId);
        if (targets.length === 0) {
          s().setStatus("no dataset to send");
          toast("no dataset to send", "danger");
          return;
        }
        try {
          const { available } = await originComStatus();
          if (!available) {
            const msg =
              "Origin COM unavailable (needs Windows + QZ_ORIGIN_COM=1 + a running Origin) — use Export Origin (.ogs) instead";
            s().setStatus(msg);
            toast(msg, "danger");
            return;
          }
          // #38 deferred edge: a multi-selection can include datasets never
          // activated/rendered — resolve every target's full data first
          // (bounded concurrency) rather than silently sending previews.
          const resolved = await s().resolveDatasets(targets.map((d) => d.id));
          const r = await sendToOrigin({
            datasets: resolved.map((d) => ({
              dataset: d.data,
              name: d.name.replace(/\.[^.]+$/, ""),
            })),
          });
          const msg = `sent to Origin: ${r.books.join(", ")}`;
          s().setStatus(msg);
          toast(msg, "ok");
        } catch (e: unknown) {
          const msg = `send failed: ${e instanceof Error ? e.message : "error"}`;
          s().setStatus(msg);
          toast(msg, "danger");
        }
      },
    },
    {
      id: "export-consolidated",
      group: "File",
      label: "Export consolidated CSV…",
      description: "Combine every loaded dataset into one consolidated CSV export.",
      run: async () => {
        const all = s().datasets;
        if (all.length === 0) {
          s().setStatus("no datasets to consolidate");
          return;
        }
        try {
          // #38 deferred edge: consolidate touches EVERY loaded dataset,
          // including ones never activated/rendered — resolve them all
          // first (bounded concurrency) rather than silently exporting
          // previews.
          const resolved = await s().resolveDatasets(all.map((d) => d.id));
          await exportConsolidated({
            datasets: resolved.map((d) => ({ dataset: d.data, name: d.name })),
          });
        } catch (e: unknown) {
          s().setStatus(`export failed: ${e instanceof Error ? e.message : "error"}`);
        }
      },
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
      // P3.4 slice 2: NOT `void`-prefixed (unlike the other command bodies
      // in this file that intentionally fire-and-forget) — this returns the
      // promise so the runAction chokepoint (CommandPalette/MenuBar) can
      // observe it and register the in-flight signal. Behavior is
      // unchanged: the async export still runs identically either way.
      run: () => runExportSpatialPageCommand(s),
    },
  ];
}
