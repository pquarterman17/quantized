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
import { IMPORT_ACCEPT, openFilePicker } from "../lib/openFilePicker";
import { importOriginTemplateFiles, TEMPLATE_ACCEPT } from "../lib/originTemplate";
import { parseWorkspace, type LoadedWorkspace } from "../lib/workspace";
import type { Action } from "../store/commands";
import { toast } from "../store/toasts";

let demoCounter = 0;
let sampleCounter = 0;

/** Shared Open/Append-workspace flow (the only difference between the two
 *  File commands): pick a .dwk, parse it, and hand the result to `dispatch`
 *  (`loadWorkspace` or `appendWorkspace`). */
function openWorkspaceCommand(
  s: StoreGet,
  verb: string,
  dispatch: (ws: LoadedWorkspace) => void,
): () => void {
  return () =>
    openFilePicker((files) => {
      const file = files[0];
      if (!file) return;
      file
        .text()
        .then((text) => dispatch(parseWorkspace(text)))
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
      shortcut: "⌘O",
      run: () => openFilePicker((files) => void s().importFiles(files)),
    },
    {
      id: "import-append",
      group: "File",
      label: "Import & append as one dataset…",
      keywords: "combine concatenate merge multi-file append",
      run: () => openFilePicker((files) => void s().importFilesAppended(files), IMPORT_ACCEPT),
    },
    {
      id: "import-wizard",
      group: "File",
      label: "Import wizard (guided preview + saved filters)…",
      keywords: "guess preview parse delimiter header units filter messy",
      run: () => s().setImportWizardOpen(true),
    },
    {
      id: "import-origin-template",
      group: "File",
      label: "Import Origin template (.otp/.otpu)…",
      keywords: "otp otpu origin graph template style preset",
      run: () => openFilePicker((files) => void importOriginTemplateFiles(files), TEMPLATE_ACCEPT),
    },
    {
      id: "demo",
      group: "File",
      label: "Add demo dataset",
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
      // Resolving pending lazy books (#38) before serializing lives in the
      // store (saveWorkspaceToFile) — not here, so this stays a thin command
      // like every other one in this list.
      run: () => s().saveWorkspaceToFile(),
    },
    {
      id: "open-workspace",
      group: "File",
      label: "Open workspace (.dwk)…",
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
      run: openWorkspaceCommand(s, "open", (ws) => {
        const n = s().datasets.length;
        if (n === 0) {
          s().recordHistory("open workspace");
          s().loadWorkspace(ws);
          return;
        }
        void askConfirm(
          "Replace the current workspace?",
          `Opening this file discards the ${n} dataset${n === 1 ? "" : "s"} currently ` +
            `loaded, plus every folder, report and saved figure. Save your work first ` +
            `if you need it.`,
          "Replace",
          true,
        ).then((ok) => {
          if (!ok) return;
          s().recordHistory("open workspace");
          s().loadWorkspace(ws);
        });
      }),
    },
    {
      id: "append-workspace",
      group: "File",
      label: "Append workspace (.dwk)…",
      keywords: "merge combine import project origin append second library",
      run: openWorkspaceCommand(s, "append", (ws) => s().appendWorkspace(ws)),
    },
    {
      id: "clear-autosave",
      group: "File",
      label: "Clear autosaved workspace…",
      run: () => {
        clearAutosave();
        s().setStatus("autosaved workspace cleared (current library unchanged)");
      },
    },
    {
      id: "remove-all",
      group: "File",
      label: "Remove all…",
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
      run: () =>
        exportActive(s, (stem, ds) => exportXrdCsv({ dataset: ds.data, filename: stem })),
    },
    {
      id: "export-hdf5",
      group: "File",
      label: "Export HDF5…",
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
      label: "Figure builder (live preview)…",
      run: () => s().setFigureBuilderOpen(true),
    },
    {
      id: "figure-page",
      group: "Plot",
      section: "Build & export",
      label: "Figure page (multi-panel)…",
      run: () => s().setFigurePageOpen(true),
    },
    {
      id: "export-figure",
      group: "Plot",
      section: "Build & export",
      label: "Export figure…",
      // Body lives in lib/exportFigureCommand (store-size ratchet offset for
      // MAIN_PLAN #16's Append workspace command — see that file's doc).
      run: () => runExportFigureCommand(s),
    },
    {
      id: "export-origin",
      group: "File",
      label: "Export Origin (.ogs)…",
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
      shortcut: "⌘,",
      run: () => s().setPrefsOpen(true),
    },
    {
      id: "export-page",
      group: "File",
      label: "Export page… (spatial, true page coords)",
      keywords: "origin multi-panel page rect true coordinates #54",
      run: () => void runExportSpatialPageCommand(s),
    },
  ];
}
