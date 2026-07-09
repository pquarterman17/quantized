// Desktop shell: TitleBar / MenuBar / (Library · Stage · Inspector) / StatusBar
// CSS grid (qzk-app), plus the platform overlays (command palette, parameter
// dialog, tooltips) and the global ⌘K keymap.

import { useEffect, useMemo } from "react";

import Inspector from "./components/Inspector/Inspector";
import Library from "./components/Library/Library";
import MenuBar from "./components/Shell/MenuBar";
import StatusBar from "./components/Shell/StatusBar";
import TitleBar from "./components/Shell/TitleBar";
import Stage from "./components/Stage/Stage";
import CommandPalette, { type Action } from "./components/overlays/CommandPalette";
import ConfirmDialog, { askConfirm } from "./components/overlays/ConfirmDialog";
import ParamDialog, { askParams } from "./components/overlays/ParamDialog";
import PreferencesDialog from "./components/overlays/PreferencesDialog";
import ShortcutsDialog from "./components/overlays/ShortcutsDialog";
import Toaster from "./components/overlays/Toaster";
import TooltipLayer from "./components/overlays/TooltipLayer";
import BaselinePanel from "./components/workshops/baseline/BaselinePanel";
import CalculatorsPanel from "./components/workshops/calculators/CalculatorsPanel";
import DatasetMathPanel from "./components/workshops/datasetmath/DatasetMathPanel";
import TabulatePanel from "./components/workshops/tabulate/TabulatePanel";
import DistributionPanel from "./components/workshops/distribution/DistributionPanel";
import ReportPanel from "./components/workshops/report/ReportPanel";
import StatsChooserPanel from "./components/workshops/statschooser/StatsChooserPanel";
import PeakWizardPanel from "./components/workshops/peakwizard/PeakWizardPanel";
import ImportWizardPanel from "./components/workshops/importwizard/ImportWizardPanel";
import PipelinePanel from "./components/workshops/pipeline/PipelinePanel";
import DataFilterPanel from "./components/workshops/datafilter/DataFilterPanel";
import ColumnSwitcher from "./components/workshops/switcher/ColumnSwitcher";
import FigureBuilderView from "./components/workshops/figurebuilder/FigureBuilderView";
import GraphBuilderPanel from "./components/workshops/graphbuilder/GraphBuilderPanel";
import CurveFitPanel from "./components/workshops/curvefit/CurveFitPanel";
import HysteresisPanel from "./components/workshops/hysteresis/HysteresisPanel";
import MagToolsPanel from "./components/workshops/magtools/MagToolsPanel";
import PeaksPanel from "./components/workshops/peaks/PeaksPanel";
import ReflectivityPanel from "./components/workshops/reflectivity/ReflectivityPanel";
import RsmPanel from "./components/workshops/rsm/RsmPanel";
import DigitizerView from "./components/workshops/digitizer/DigitizerView";
import WaterfallView from "./components/workshops/waterfall/WaterfallView";
import ReflView from "./components/workshops/reflview/ReflView";
import {
  exportConsolidated,
  exportFigure,
  exportHdf5,
  exportOrigin,
  exportXrdCsv,
  health,
  originComStatus,
  sendToOrigin,
} from "./lib/api";
import { makeDemoDataset } from "./lib/demo";
import { loadSampleDataset } from "./lib/sampleDataset";
import { clearAutosave } from "./lib/autosave";
import { useWorkspaceAutosave } from "./useWorkspaceAutosave";
import { buildExportStyles } from "./lib/exportStyles";
import { exportActive } from "./lib/exportActive";
import { IMPORT_ACCEPT, openFilePicker } from "./lib/openFilePicker";
import { toolForKey } from "./lib/plotToolKeys";
import { parseWorkspace } from "./lib/workspace";
import { toast } from "./store/toasts";
import { useApp } from "./store/useApp";

let demoCounter = 0;
let sampleCounter = 0;

export default function App() {
  const leftCollapsed = useApp((s) => s.leftCollapsed);
  const rightCollapsed = useApp((s) => s.rightCollapsed);
  const curveFitOpen = useApp((s) => s.curveFitOpen);
  const hysteresisOpen = useApp((s) => s.hysteresisOpen);
  const peaksOpen = useApp((s) => s.peaksOpen);
  const reflectivityOpen = useApp((s) => s.reflectivityOpen);
  const baselineOpen = useApp((s) => s.baselineOpen);
  const calculatorsOpen = useApp((s) => s.calculatorsOpen);
  const rsmOpen = useApp((s) => s.rsmOpen);
  const digitizerOpen = useApp((s) => s.digitizerOpen);
  const magToolsOpen = useApp((s) => s.magToolsOpen);
  const datasetMathOpen = useApp((s) => s.datasetMathOpen);
  const tabulateOpen = useApp((s) => s.tabulateOpen);
  const distributionOpen = useApp((s) => s.distributionOpen);
  const dataFilterOpen = useApp((s) => s.dataFilterOpen);
  const columnSwitcherOpen = useApp((s) => s.columnSwitcherOpen);
  const figureBuilderOpen = useApp((s) => s.figureBuilderOpen);
  const graphBuilderOpen = useApp((s) => s.graphBuilderOpen);
  const waterfallOpen = useApp((s) => s.waterfallOpen);
  const reflViewOpen = useApp((s) => s.reflViewOpen);
  const openReportId = useApp((s) => s.openReportId);
  const statsChooserOpen = useApp((s) => s.statsChooserOpen);
  const peakWizardOpen = useApp((s) => s.peakWizardOpen);
  const importWizardOpen = useApp((s) => s.importWizardOpen);
  const pipelineOpen = useApp((s) => s.pipelineOpen);
  const setStatus = useApp((s) => s.setStatus);
  const setCmdk = useApp((s) => s.setCmdk);

  useEffect(() => {
    health()
      .then(() => setStatus("backend ready"))
      .catch(() => setStatus("offline — demo mode"));
  }, [setStatus]);

  // Restore the autosaved library on startup + debounce-save workspace changes
  // (extracted — component-ceiling ratchet).
  useWorkspaceAutosave();

  // ── trap browser back/forward (mouse back button, ⌫ in old browsers) ──
  // The app is a single-page view with no in-app navigation, so a "back"
  // gesture unloads / "reloads" it (losing transient UI state). Push a
  // sentinel history entry and re-push on every popstate so back/forward
  // can't leave the app. Harmless in the desktop (pywebview) shell.
  // Ported from fermiviewer 9ec93a0.
  useEffect(() => {
    history.pushState(null, "", location.href);
    const onPop = () => history.pushState(null, "", location.href);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Global keyboard shortcuts (Cmd/Ctrl + key), plus Delete to remove datasets.
  useEffect(() => {
    const isEditing = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      // Delete / Backspace removes the selected dataset(s) — but never while the
      // user is typing in a field (rename, tag, filter, formula, dialog input).
      if ((e.key === "Delete" || e.key === "Backspace") && !isEditing(e.target)) {
        const s = useApp.getState();
        if (s.datasets.length === 0) return;
        e.preventDefault();
        const n = s.selectedIds.length || (s.activeId ? 1 : 0);
        const doRemove = () => {
          s.removeSelected();
          const msg = `removed ${n} dataset${n === 1 ? "" : "s"}`;
          s.setStatus(msg);
          toast(msg);
        };
        // Preferences ▸ Interaction ▸ Confirm before removing data.
        if (s.confirmRemove) {
          void askParams(`Remove ${n} dataset${n === 1 ? "" : "s"}?`, []).then((ok) => {
            if (ok) doRemove();
          });
        } else {
          doRemove();
        }
        return;
      }
      // "?" (Shift+/ on US layouts) opens the keyboard-shortcuts sheet.
      if (e.key === "?" && !isEditing(e.target)) {
        e.preventDefault();
        useApp.getState().setShortcutsOpen(true);
        return;
      }
      // Single-key tool / nav shortcuts (design interaction layer) — only with no
      // modifier held and not while typing in a field.
      if (!e.metaKey && !e.ctrlKey && !e.altKey && !isEditing(e.target)) {
        const s = useApp.getState();
        switch (e.key) {
          case "a":
          case "A": // autoscale / reset the plot view
            if (!s.xLim && !s.yLim) return; // nothing to reset
            e.preventDefault();
            s.setXLim(null);
            s.setYLim(null);
            s.setStatus("view reset");
            return;
          case "f":
          case "F": // curve-fit workshop
            e.preventDefault();
            s.setCurveFitOpen(true);
            return;
          case "y":
          case "Y": // hysteresis workshop
            e.preventDefault();
            s.setHysteresisOpen(true);
            return;
          case "ArrowUp":
          case "ArrowDown": {
            // Previous / next dataset (wraps); plain click semantics.
            if (s.datasets.length < 2) return;
            e.preventDefault();
            const n = s.datasets.length;
            const cur = s.datasets.findIndex((d) => d.id === s.activeId);
            const base = cur < 0 ? 0 : cur;
            const delta = e.key === "ArrowDown" ? 1 : -1;
            s.setActive(s.datasets[(((base + delta) % n) + n) % n].id);
            return;
          }
          case "p":
          case "P": // pick peak → the Peaks workshop
            e.preventDefault();
            s.setPeaksOpen(true);
            return;
        }
        // H/Z/D/M/I/W select a plot tool.
        const t = toolForKey(e.key);
        if (t) {
          e.preventDefault();
          s.setPlotTool(t);
          return;
        }
      }
      if (!(e.metaKey || e.ctrlKey)) return;
      const s = useApp.getState();
      switch (e.key.toLowerCase()) {
        case "k":
          e.preventDefault();
          s.setCmdk(true);
          break;
        case "o":
          e.preventDefault();
          openFilePicker((files) => void s.importFiles(files));
          break;
        case "v":
          // Only claim ⌘/Ctrl+V as "paste a dataset" when the user isn't typing
          // into a field (rename, tag, formula, dialog input) — those keep the
          // browser's native paste. Command palette / Edit menu always work.
          if (!isEditing(e.target)) {
            e.preventDefault();
            void s.pasteDataFromClipboard();
          }
          break;
        case "[":
          e.preventDefault();
          s.toggleLeft();
          break;
        case "]":
          e.preventDefault();
          s.toggleRight();
          break;
        case "l":
          // ⌘⇧L toggles the theme (plain ⌘L is the browser address bar).
          if (e.shiftKey) {
            e.preventDefault();
            s.setTheme(s.theme === "dark" ? "light" : "dark");
          }
          break;
        case ",":
          e.preventDefault();
          s.setPrefsOpen(true);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Curated palette actions — store setters are stable, so build once.
  const actions = useMemo<Action[]>(() => {
    const s = useApp.getState;
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
        run: () =>
          openFilePicker((files) => {
            const file = files[0];
            if (!file) return;
            file
              .text()
              .then((text) => s().loadWorkspace(parseWorkspace(text)))
              .catch((e: unknown) =>
                s().setStatus(`open failed: ${e instanceof Error ? e.message : "error"}`),
              );
          }, ".dwk,.json"),
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
        id: "yLog",
        group: "Plot",
        label: "Toggle log Y axis",
        run: () => s().setYLog(!s().yLog),
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
      {
        id: "curvefit",
        group: "Analyze",
        label: "Curve fit…",
        run: () => s().setCurveFitOpen(true),
      },
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
        id: "waterfall",
        group: "Plot",
        label: "Waterfall (stack datasets)…",
        run: () => s().setWaterfallOpen(true),
      },
      {
        id: "export-figure",
        group: "File",
        label: "Export figure…",
        run: async () => {
          const params = await askParams("Export figure", [
            {
              key: "fmt",
              label: "Format",
              type: "select",
              default: "pdf",
              options: ["pdf", "svg", "png", "tiff"],
              hint: "PDF / SVG are vector; PNG / TIFF are raster",
            },
            {
              key: "style",
              label: "Style",
              type: "select",
              default: "default",
              options: ["default", "aps", "nature", "thesis", "report", "web", "presentation", "poster"],
              hint: "Publication preset: sets font, size, line width, grid",
            },
            {
              key: "dpi",
              label: "DPI (raster)",
              type: "number",
              default: 300,
              hint: "Resolution for PNG / TIFF (50–1200); ignored by vector",
            },
            { key: "title", label: "Title", type: "text", default: "" },
            {
              key: "x_label",
              label: "X label",
              type: "text",
              default: "",
              hint: "Blank = derive from the data column",
            },
            { key: "y_label", label: "Y label", type: "text", default: "" },
          ]);
          if (!params) return;
          // Blank label fields mean "derive from the data" → send undefined, not "".
          const xl = (params.x_label as string).trim();
          const yl = (params.y_label as string).trim();
          exportActive(s, (stem, ds) => {
            // Per-series styles in plotted order so the figure matches the screen.
            const plotted = s().yKeys ?? ds.data.labels.map((_, i) => i);
            return exportFigure({
              dataset: ds.data,
              y_keys: s().yKeys ?? undefined,
              x_log: s().xLog,
              y_log: s().yLog,
              fmt: params.fmt as string,
              style: params.style as string,
              dpi: params.dpi as number,
              title: (params.title as string).trim(),
              x_label: xl || undefined,
              y_label: yl || undefined,
              series_styles: buildExportStyles(plotted, s().seriesStyles),
              filename: stem,
            });
          });
        },
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
              log_x: s().xLog,
              log_y: s().yLog,
              // Current plot state -> an Origin GRAPH, not just the workbook (item 26).
              graph: {
                y_keys: s().yKeys,
                x_key: s().xKey,
                x_log: s().xLog,
                y_log: s().yLog,
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
      {
        id: "duplicate",
        group: "Data",
        label: "Duplicate active dataset",
        run: () => {
          const id = s().activeId;
          if (id) s().duplicateDataset(id);
        },
      },
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
        id: "xLog",
        group: "Plot",
        label: "Toggle log X axis",
        run: () => s().setXLog(!s().xLog),
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
    ];
  }, []);

  const mainCls = `qzk-main${leftCollapsed ? " lc" : ""}${rightCollapsed ? " rc" : ""}`;

  return (
    <div className="qzk-app">
      <TitleBar />
      <MenuBar actions={actions} onOpenPalette={() => setCmdk(true)} />
      <div className={mainCls}>
        <Library />
        <Stage />
        <Inspector />
      </div>
      <StatusBar />
      <CommandPalette actions={actions} />
      <ParamDialog />
      <ConfirmDialog />
      <TooltipLayer />
      {curveFitOpen && <CurveFitPanel />}
      {hysteresisOpen && <HysteresisPanel />}
      {peaksOpen && <PeaksPanel />}
      {reflectivityOpen && <ReflectivityPanel />}
      {baselineOpen && <BaselinePanel />}
      {calculatorsOpen && <CalculatorsPanel />}
      {magToolsOpen && <MagToolsPanel />}
      {rsmOpen && <RsmPanel />}
      {digitizerOpen && <DigitizerView />}
      {datasetMathOpen && <DatasetMathPanel />}
      {tabulateOpen && <TabulatePanel />}
      {distributionOpen && <DistributionPanel />}
      {dataFilterOpen && <DataFilterPanel />}
      {statsChooserOpen && <StatsChooserPanel />}
      {peakWizardOpen && <PeakWizardPanel />}
      {importWizardOpen && <ImportWizardPanel />}
      {pipelineOpen && <PipelinePanel />}
      {openReportId && <ReportPanel />}
      {columnSwitcherOpen && <ColumnSwitcher />}
      {figureBuilderOpen && <FigureBuilderView />}
      {graphBuilderOpen && <GraphBuilderPanel />}
      {waterfallOpen && <WaterfallView />}
      {reflViewOpen && <ReflView />}
      <ShortcutsDialog />
      <PreferencesDialog />
      <Toaster />
    </div>
  );
}
