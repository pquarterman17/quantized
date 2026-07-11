// The curated command registry — every File/Edit/View/Data/Analyze/Plot/Help
// action consumed by the MenuBar and the ⌘K palette. Extracted VERBATIM from
// App.tsx (MAIN_PLAN #1, component-ceiling ratchet): App builds the list once
// (store setters are stable) and hands it to both surfaces; dynamically
// published commands (e.g. windows/useWindowCommands) still go through
// store/commands, never this list. Tests that assert "command X is
// registered" scan THIS module's source (see TextFormatHelp.test.tsx).

import { askConfirm } from "./components/overlays/ConfirmDialog";
import { askParams } from "./components/overlays/ParamDialog";
import {
  exportConsolidated,
  exportHdf5,
  exportOrigin,
  exportXrdCsv,
  originComStatus,
  sendToOrigin,
} from "./lib/api";
import { makeDemoDataset } from "./lib/demo";
import { loadSampleDataset } from "./lib/sampleDataset";
import { clearAutosave } from "./lib/autosave";
import { exportActive, type StoreGet } from "./lib/exportActive";
import { runExportFigureCommand } from "./lib/exportFigureCommand";
import { IMPORT_ACCEPT, openFilePicker } from "./lib/openFilePicker";
import { importOriginTemplateFiles, TEMPLATE_ACCEPT } from "./lib/originTemplate";
import { cycleAxisScale, cycleTickMode } from "./lib/plotview";
import { parseWorkspace, type LoadedWorkspace } from "./lib/workspace";
import type { Action } from "./store/commands";
import { toast } from "./store/toasts";

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

/** Build the curated palette actions against the live store handle
 *  (`useApp.getState`) — store setters are stable, so callers build once. */
export function buildAppActions(s: StoreGet): Action[] {
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
      run: openWorkspaceCommand(s, "open", (ws) => s().loadWorkspace(ws)),
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
      id: "theme",
      group: "View",
      label: "Toggle theme",
      run: () => s().setTheme(s().theme === "dark" ? "light" : "dark"),
    },
    {
      id: "yLog", // MAIN #12: cycles linear -> log -> reciprocal -> linear
      group: "Plot",
      label: "Cycle Y axis scale (linear/log/reciprocal)",
      run: () => s().setYScale(cycleAxisScale(s().yScale)),
    },
    {
      id: "yTickFormat", // MAIN #20: cycles auto -> fixed -> sci -> eng -> auto
      group: "Plot",
      label: "Cycle Y tick format (auto/fixed/sci/eng)",
      run: () => s().setYFmt({ ...s().yFmt, mode: cycleTickMode(s().yFmt.mode) }),
    },
    {
      id: "density",
      group: "View",
      label: "Cycle density",
      run: () => {
        const order = ["compact", "regular", "comfy"] as const;
        s().setDensity(order[(order.indexOf(s().density) + 1) % order.length]);
      },
    },
    {
      id: "accent",
      group: "View",
      label: "Cycle accent color",
      run: () => {
        const order = ["violet", "teal", "ocean", "amber", "rose"] as const;
        s().setAccent(order[(order.indexOf(s().accent) + 1) % order.length]);
      },
    },
    {
      id: "left",
      group: "View",
      label: "Toggle library panel",
      shortcut: "⌘[",
      run: () => s().toggleLeft(),
    },
    {
      id: "right",
      group: "View",
      label: "Toggle inspector panel",
      shortcut: "⌘]",
      run: () => s().toggleRight(),
    },
    { id: "curvefit", group: "Analyze", label: "Curve fit…", run: () => s().setCurveFitOpen(true) },
    {
      id: "hysteresis",
      group: "Analyze",
      label: "Hysteresis analysis…",
      run: () => s().setHysteresisOpen(true),
    },
    {
      id: "magtools",
      group: "Analyze",
      label: "Magnetometry (background · units)…",
      run: () => s().setMagToolsOpen(true),
    },
    {
      id: "peaks",
      group: "Analyze",
      label: "Find peaks…",
      run: () => s().setPeaksOpen(true),
    },
    {
      id: "reflectivity",
      group: "Analyze",
      label: "Reflectivity model…",
      run: () => s().setReflectivityOpen(true),
    },
    {
      id: "reflview",
      group: "Analyze",
      label: "Reflectometry view (data + model + SLD)…",
      run: () => s().setReflViewOpen(true),
    },
    {
      id: "baseline",
      group: "Analyze",
      label: "Baseline / background…",
      run: () => s().setBaselineOpen(true),
    },
    {
      id: "calculators",
      group: "Analyze",
      label: "DiraCulator — materials calculators…",
      keywords:
        "diraculator calculator units constants semiconductor superconductor magnetic crystal sld optics thermal vacuum electrical electrochemistry diffusion substrates thinfilm periodic table elements xray",
      run: () => s().setCalculatorsOpen(true),
    },
    {
      id: "rsm",
      group: "Analyze",
      label: "RSM analysis (strain · relaxation)…",
      run: () => s().setRsmOpen(true),
    },
    {
      id: "digitizer",
      group: "Analyze",
      label: "Graph digitizer (trace a curve from an image)…",
      run: () => s().setDigitizerOpen(true),
    },
    // Reductions (MAIN_PLAN #11): one ToolWindow, pre-set to the picked method.
    { id: "reductions-wh", group: "Analyze", label: "Williamson-Hall…", run: () => s().openReductions("williamson-hall") },
    { id: "reductions-fft", group: "Analyze", label: "Film thickness (FFT)…", run: () => s().openReductions("fft-thickness") },
    { id: "reductions-reflfft", group: "Analyze", label: "Reflectivity FFT…", run: () => s().openReductions("reflectivity-fft") },
    {
      id: "dataset-math",
      group: "Data",
      label: "Dataset math (combine two datasets)…",
      run: () => s().setDatasetMathOpen(true),
    },
    {
      id: "tabulate",
      group: "Data",
      label: "Tabulate (group summary stats by column)…",
      run: () => s().setTabulateOpen(true),
    },
    {
      id: "distribution",
      group: "Analyze",
      label: "Distribution (histogram + normality of a column)…",
      run: () => s().setDistributionOpen(true),
    },
    {
      id: "stats-chooser",
      group: "Analyze",
      label: "Test chooser (which stats test? + run it)…",
      run: () => s().setStatsChooserOpen(true),
    },
    {
      id: "graph-builder",
      group: "Analyze",
      label: "Graph Builder (drag columns into X/Y/Group wells)…",
      keywords: "plot spec scatter line box violin bar mark morph drop zone well facet",
      run: () => s().setGraphBuilderOpen(true),
    },
    {
      id: "peak-wizard",
      group: "Analyze",
      label: "Peak Analyzer (baseline → find → fit → report wizard)…",
      run: () => s().setPeakWizardOpen(true),
    },
    {
      id: "pipeline",
      group: "Data",
      label: "Pipeline (edit + re-run recorded steps)…",
      run: () => s().setPipelineOpen(true),
    },
    {
      id: "recalc-now",
      group: "Data",
      label: "Recalculate now (run stale corrections + fits)",
      run: () => void s().recalcNow(),
    },
    {
      id: "recalc-mode",
      group: "Data",
      label: "Recalc mode (cycle auto → manual → off)",
      run: () => {
        const order = ["auto", "manual", "off"] as const;
        const cur = s().recalcMode;
        const next = order[(order.indexOf(cur) + 1) % order.length];
        s().setRecalcMode(next);
        s().setStatus(`recalc mode: ${next}`);
      },
    },
    {
      id: "data-filter",
      group: "Data",
      label: "Data filter (live per-column row filter)…",
      run: () => s().setDataFilterOpen(true),
    },
    {
      id: "column-switcher",
      group: "View",
      label: "Column switcher (flip through channels)…",
      run: () => s().setColumnSwitcherOpen(true),
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
      group: "File",
      label: "Figure builder (live preview)…",
      run: () => s().setFigureBuilderOpen(true),
    },
    {
      id: "figure-page",
      group: "File",
      label: "Figure page (multi-panel)…",
      run: () => s().setFigurePageOpen(true),
    },
    {
      id: "waterfall",
      group: "Plot",
      label: "Waterfall (stack datasets)…",
      run: () => s().setWaterfallOpen(true),
    },
    {
      id: "export-figure",
      group: "File",
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
      id: "worksheet",
      group: "View",
      label: "Show worksheet",
      run: () => s().setStageTab("worksheet"),
    },
    {
      id: "plot",
      group: "View",
      label: "Show plot",
      run: () => s().setStageTab("plot"),
    },
    {
      id: "preferences",
      group: "File",
      label: "Preferences…",
      shortcut: "⌘,",
      run: () => s().setPrefsOpen(true),
    },
    // ── Edit ──
    {
      id: "palette",
      group: "Edit",
      label: "Command palette…",
      shortcut: "⌘K",
      run: () => s().setCmdk(true),
    },
    {
      id: "paste-data",
      group: "Edit",
      label: "Paste data",
      shortcut: "⌘V",
      keywords: "clipboard import tsv csv table",
      run: () => void s().pasteDataFromClipboard(),
    },
    // ── Data ──
    {
      id: "merge",
      group: "Data",
      label: "Merge selected datasets",
      run: () => s().mergeSelected(),
    },
    { id: "duplicate", group: "Data", label: "Duplicate active dataset", run: () => { const id = s().activeId; if (id) s().duplicateDataset(id); } },
    { id: "reimport", group: "Data", label: "Re-import active dataset", run: () => { const id = s().activeId; if (id) void s().reimportDataset(id); } },
    // ── Plot ──
    {
      id: "autoscale",
      group: "Plot",
      label: "Autoscale / reset view",
      shortcut: "A",
      run: () => {
        s().setXLim(null);
        s().setYLim(null);
      },
    },
    {
      id: "xLog", // see the "yLog" command above — same cycle, X axis
      group: "Plot",
      label: "Cycle X axis scale (linear/log/reciprocal)",
      run: () => s().setXScale(cycleAxisScale(s().xScale)),
    },
    {
      id: "xTickFormat", // see the "yTickFormat" command above — same cycle, X axis
      group: "Plot",
      label: "Cycle X tick format (auto/fixed/sci/eng)",
      run: () => s().setXFmt({ ...s().xFmt, mode: cycleTickMode(s().xFmt.mode) }),
    },
    {
      id: "grid",
      group: "Plot",
      label: "Toggle grid lines",
      run: () => s().setShowGrid(!s().showGrid),
    },
    {
      id: "legend",
      group: "Plot",
      label: "Toggle legend",
      run: () => s().setShowLegend(!s().showLegend),
    },
    {
      id: "stacked",
      group: "Plot",
      label: "Toggle stacked layout",
      run: () => s().setStackMode(!s().stackMode),
    },
    {
      id: "statMode",
      group: "Plot",
      label: "Toggle statistics view (box / violin / Q-Q / histogram)",
      run: () => s().setStatMode(!s().statMode),
    },
    {
      id: "facet-by-column",
      group: "Plot",
      label: "Facet by column…",
      run: async () => {
        const ds = s().datasets.find((d) => d.id === s().activeId);
        if (!ds) {
          toast("no active dataset", "danger");
          return;
        }
        if (ds.data.labels.length === 0) {
          toast("active dataset has no columns to facet by", "danger");
          return;
        }
        // Disambiguate duplicate labels (real instrument imports can repeat
        // a column name) so the reverse `indexOf` lookup below always maps
        // the picked option back to the SAME channel the user saw.
        const raw = ds.data.labels.map((lab, i) => lab || `Column ${i + 1}`);
        const counts = new Map<string, number>();
        for (const lab of raw) counts.set(lab, (counts.get(lab) ?? 0) + 1);
        const options = raw.map((lab, i) => (counts.get(lab)! > 1 ? `${lab} (col ${i + 1})` : lab));
        const params = await askParams("Facet by column", [
          {
            key: "column",
            label: "Column",
            type: "select",
            default: options[0],
            options,
            hint: "One small-multiples panel per distinct level, sharing the x-axis",
          },
        ]);
        if (!params) return;
        const col = options.indexOf(String(params.column));
        if (col < 0) return;
        s().facetByColumn(ds.id, col);
      },
    },
    {
      id: "break-x-axis",
      group: "Plot",
      label: "Break x-axis at gaps…",
      run: async () => {
        const ds = s().datasets.find((d) => d.id === s().activeId);
        if (!ds) {
          toast("no active dataset", "danger");
          return;
        }
        const params = await askParams("Break x-axis at gaps", [
          {
            key: "gapFactor",
            label: "Gap factor",
            type: "number",
            default: 4,
            hint: "A gap at least this many times the median x-spacing becomes a break",
          },
        ]);
        if (!params) return;
        s().breakAtGaps(ds.id, undefined, Number(params.gapFactor));
      },
    },
    {
      id: "shortcuts",
      group: "Help",
      label: "Keyboard shortcuts",
      shortcut: "?",
      run: () => s().setShortcutsOpen(true),
    },
    // GOTO #11: the rich-text label micro-syntax reference (Help menu + ⌘K).
    { id: "text-format-help", group: "Help", label: "Text formatting", run: () => s().setTextFormatHelpOpen(true) },
  ];
}
