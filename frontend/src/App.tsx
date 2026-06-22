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
import { health } from "./lib/api";
import { makeDemoDataset } from "./lib/demo";
import { useApp } from "./store/useApp";

let demoCounter = 0;

export default function App() {
  const leftCollapsed = useApp((s) => s.leftCollapsed);
  const rightCollapsed = useApp((s) => s.rightCollapsed);
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
        id: "demo",
        group: "Data",
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
      <MenuBar onOpenPalette={() => setCmdk(true)} />
      <div className={mainCls}>
        <Library />
        <Stage />
        <Inspector />
      </div>
      <StatusBar />
      <CommandPalette actions={actions} />
      <ParamDialog />
      <TooltipLayer />
    </div>
  );
}
