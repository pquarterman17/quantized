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
import ParamDialog, { askParams } from "./components/overlays/ParamDialog";
import ShortcutsDialog from "./components/overlays/ShortcutsDialog";
import TooltipLayer from "./components/overlays/TooltipLayer";
import BaselinePanel from "./components/workshops/baseline/BaselinePanel";
import CalculatorsPanel from "./components/workshops/calculators/CalculatorsPanel";
import DatasetMathPanel from "./components/workshops/datasetmath/DatasetMathPanel";
import FigureBuilderView from "./components/workshops/figurebuilder/FigureBuilderView";
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
} from "./lib/api";
import { makeDemoDataset } from "./lib/demo";
import { clearAutosave, loadAutosave, saveAutosave } from "./lib/autosave";
import { saveBlob } from "./lib/download";
import { buildExportStyles } from "./lib/exportStyles";
import { openFilePicker } from "./lib/openFilePicker";
import { parseWorkspace, serializeWorkspace } from "./lib/workspace";
import { useApp } from "./store/useApp";

type StoreGet = typeof useApp.getState;

/** Export the active dataset via `fn`, surfacing failures in the status bar. */
function exportActive(
  s: StoreGet,
  fn: (stem: string, ds: ReturnType<StoreGet>["datasets"][number]) => Promise<void>,
): void {
  const ds = s().datasets.find((d) => d.id === s().activeId);
  if (!ds) {
    s().setStatus("no dataset to export");
    return;
  }
  const stem = ds.name.replace(/\.[^.]+$/, "");
  fn(stem, ds).catch((e: unknown) =>
    s().setStatus(`export failed: ${e instanceof Error ? e.message : "error"}`),
  );
}

let demoCounter = 0;

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
  const figureBuilderOpen = useApp((s) => s.figureBuilderOpen);
  const waterfallOpen = useApp((s) => s.waterfallOpen);
  const reflViewOpen = useApp((s) => s.reflViewOpen);
  const setStatus = useApp((s) => s.setStatus);
  const setCmdk = useApp((s) => s.setCmdk);

  useEffect(() => {
    health()
      .then(() => setStatus("backend ready"))
      .catch(() => setStatus("offline — demo mode"));
  }, [setStatus]);

  // Restore the autosaved library once on startup (before any new import).
  useEffect(() => {
    const restored = loadAutosave();
    if (restored?.length) {
      useApp.getState().loadWorkspace(restored);
      setStatus(`restored ${restored.length} dataset${restored.length === 1 ? "" : "s"} from autosave`);
    }
  }, [setStatus]);

  // Debounced autosave whenever the library changes (datasets identity).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = useApp.subscribe((state, prev) => {
      if (state.datasets === prev.datasets) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!saveAutosave(useApp.getState().datasets)) {
          useApp.getState().setStatus("autosave skipped (storage full or unavailable)");
        }
      }, 800);
    });
    return () => {
      clearTimeout(timer);
      unsub();
    };
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
        s.removeSelected();
        s.setStatus(`removed ${n} dataset${n === 1 ? "" : "s"}`);
        return;
      }
      // "?" (Shift+/ on US layouts) opens the keyboard-shortcuts sheet.
      if (e.key === "?" && !isEditing(e.target)) {
        e.preventDefault();
        useApp.getState().setShortcutsOpen(true);
        return;
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
        case "[":
          e.preventDefault();
          s.toggleLeft();
          break;
        case "]":
          e.preventDefault();
          s.toggleRight();
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
        id: "save-workspace",
        group: "File",
        label: "Save workspace (.dwk)…",
        run: () => {
          const all = s().datasets;
          if (all.length === 0) {
            s().setStatus("no datasets to save");
            return;
          }
          saveBlob(new Blob([serializeWorkspace(all)], { type: "application/json" }), "workspace.dwk");
          s().setStatus(`saved workspace — ${all.length} dataset${all.length === 1 ? "" : "s"}`);
        },
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
        id: "theme",
        group: "View",
        label: "Toggle theme",
        run: () => s().setTheme(s().theme === "dark" ? "light" : "dark"),
      },
      {
        id: "yLog",
        group: "View",
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
        label: "Calculators (units · constants)…",
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
        group: "Analyze",
        label: "Dataset math (combine two datasets)…",
        run: () => s().setDatasetMathOpen(true),
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
        group: "View",
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
          exportActive(s, (stem, ds) => exportOrigin({ dataset: ds.data, filename: stem })),
      },
      {
        id: "export-consolidated",
        group: "File",
        label: "Export consolidated CSV…",
        run: () => {
          const all = s().datasets;
          if (all.length === 0) {
            s().setStatus("no datasets to consolidate");
            return;
          }
          exportConsolidated({
            datasets: all.map((d) => ({ dataset: d.data, name: d.name })),
          }).catch((e: unknown) =>
            s().setStatus(`export failed: ${e instanceof Error ? e.message : "error"}`),
          );
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
      {figureBuilderOpen && <FigureBuilderView />}
      {waterfallOpen && <WaterfallView />}
      {reflViewOpen && <ReflView />}
      <ShortcutsDialog />
    </div>
  );
}
