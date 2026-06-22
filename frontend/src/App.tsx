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
import ParamDialog from "./components/overlays/ParamDialog";
import TooltipLayer from "./components/overlays/TooltipLayer";
import CurveFitPanel from "./components/workshops/curvefit/CurveFitPanel";
import HysteresisPanel from "./components/workshops/hysteresis/HysteresisPanel";
import PeaksPanel from "./components/workshops/peaks/PeaksPanel";
import {
  exportConsolidated,
  exportHdf5,
  exportOrigin,
  exportXrdCsv,
  health,
} from "./lib/api";
import { makeDemoDataset } from "./lib/demo";
import { openFilePicker } from "./lib/openFilePicker";
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
  const setStatus = useApp((s) => s.setStatus);
  const setCmdk = useApp((s) => s.setCmdk);

  useEffect(() => {
    health()
      .then(() => setStatus("backend ready"))
      .catch(() => setStatus("offline — demo mode"));
  }, [setStatus]);

  // Global ⌘K / Ctrl+K opens the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useApp.getState().setCmdk(true);
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
        id: "peaks",
        group: "Analyze",
        label: "Find peaks…",
        run: () => s().setPeaksOpen(true),
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
    </div>
  );
}
