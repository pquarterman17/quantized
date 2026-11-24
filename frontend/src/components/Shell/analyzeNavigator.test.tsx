// Analyze menu as navigator: disabled-with-reason, menu <-> palette parity,
// "Recent analyses" persistence/order, and "Open results (N)".

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { buildAppActions } from "../../appCommands";
import type { AnalysisResult } from "../../lib/analysisResult";
import type { Dataset } from "../../lib/types";
import { resetAnalysisCenterPreferencesForTests, useAnalysisCenter } from "../../store/analysisCenter";
import { runAction } from "../../store/commands";
import { useApp } from "../../store/useApp";
import CommandPalette from "../overlays/CommandPalette";
import type { ContextMenuItem } from "../overlays/ContextMenu";
import { buildAppMenuItems } from "./appMenuModel";

const fmt = (s: string) => s;
const sheet = (id: string, labels = ["Intensity"]): Dataset => ({
  id, name: id,
  data: {
    time: [0, 1, 2, 3, 4, 5],
    values: [0, 1, 2, 3, 4, 5].map((i) => labels.map(() => i)),
    labels, units: labels.map(() => ""), metadata: {},
  },
});
const result = (id: string, datasetId: string): AnalysisResult => ({
  version: 1, id, name: `Fit ${id}`, producer: { id: "curve-fit", label: "Curve Fit", version: 1 },
  sources: [{ datasetId, role: "input" }], outputs: [], warnings: [], createdAt: "2026-01-01T00:00:00Z",
});

type Leaf = Extract<ContextMenuItem, { label: string }>;
const labelled = (items: ContextMenuItem[]): Leaf[] =>
  items.flatMap((i) => ("label" in i ? [i as Leaf, ...("submenu" in i ? labelled(i.submenu) : [])] : []));
const analyzeMenu = () => buildAppMenuItems("Analyze", buildAppActions(useApp.getState), fmt);
const find = (label: string): Leaf | undefined => labelled(analyzeMenu()).find((i) => i.label === label);

beforeEach(() => {
  localStorage.clear();
  resetAnalysisCenterPreferencesForTests();
  useApp.setState({ datasets: [], activeId: null, selectedIds: [], analysisResults: [], openAnalysisResultId: null, cmdkOpen: false });
});

describe("Analyze menu requirements", () => {
  it("lists but disables incompatible tools with a one-line reason; enables them when the worksheet fits", () => {
    expect(find("Curve fit…")).toMatchObject({ disabled: true, title: "Import or select a dataset first" });
    // The calculators live in the Tools menu (UX10 P1-3) and need no worksheet.
    const tools = labelled(buildAppMenuItems("Tools", buildAppActions(useApp.getState), fmt));
    expect(tools.find((i) => i.label === "Calculators…")).toMatchObject({ disabled: false });
    useApp.setState({ datasets: [sheet("d1")], activeId: "d1" });
    expect(find("Curve fit…")).toMatchObject({ disabled: false });
    expect(find("Average multiple curves…")).toMatchObject({ disabled: true, title: "Needs 2 or more worksheets" });
    expect(find("Pawley refinement…")).toMatchObject({ disabled: true, title: "Needs a 2θ X axis" });
    useApp.setState({ datasets: [sheet("d1"), sheet("d2")] });
    expect(find("Average multiple curves…")).toMatchObject({ disabled: false });
  });

  it("shows the same reason in the palette for every disabled menu item (parity)", () => {
    useApp.setState({ datasets: [sheet("d1")], activeId: "d1" });
    // Every command: the Analyze menu also lists Plot > Polar map under Maps (UX menus audit M2).
    const actions = buildAppActions(useApp.getState);
    const disabledInMenu = labelled(analyzeMenu()).filter((i) => i.disabled && i.title);
    expect(disabledInMenu.length).toBeGreaterThan(3);
    useApp.setState({ cmdkOpen: true });
    render(<CommandPalette actions={actions} />);
    for (const item of disabledInMenu) {
      const option = screen.getAllByRole("option", { name: item.label })[0]!;
      expect(option).toHaveAttribute("aria-disabled", "true");
      expect(option).toHaveTextContent(item.title!);
    }
    // An enabled one is not marked disabled.
    expect(screen.getByRole("option", { name: "Curve fit…" })).not.toHaveAttribute("aria-disabled");
  });
});

describe("Recent analyses", () => {
  it("is absent until a tool runs, then lists the last five newest first, persisted", () => {
    expect(analyzeMenu().some((i) => "header" in i)).toBe(false);
    useApp.setState({ datasets: [sheet("d1", ["A", "B"])], activeId: "d1" });
    const actions = buildAppActions(useApp.getState);
    const byLabel = (l: string) => actions.find((a) => a.label === l)!;
    for (const label of ["Distribution…", "Find peaks…", "Baseline / background…", "Signal processing…", "Hysteresis analysis…", "Outlier screening…"]) {
      // Run only the recording side: the tool's own opener is a store setter.
      runAction(byLabel(label));
    }
    const items = analyzeMenu();
    expect(items[0]).toEqual({ header: "Recent analyses" });
    const names = items.slice(1, 6).map((i) => (i as Leaf).label);
    expect(names).toEqual(["Outlier screening…", "Hysteresis analysis…", "Signal processing…", "Baseline / background…", "Find peaks…"]);
    expect(items[6]).toEqual({ separator: true });
    expect(JSON.parse(localStorage.getItem("qz.analysis-center.v1")!).recent[0]).toBe("outlier-screening");
    expect(useAnalysisCenter.getState().recent).toHaveLength(6);
  });
});

describe("Open results", () => {
  it("appears only when the active worksheet has results, and reveals the chosen one", () => {
    useApp.setState({ datasets: [sheet("d1"), sheet("d2")], activeId: "d1" });
    expect(find("Open results (1)")).toBeUndefined();
    useApp.setState({ analysisResults: [result("r1", "d1")] });
    const one = find("Open results (1)")!;
    expect(one).toBeDefined();
    (one as Extract<Leaf, { run: () => void }>).run();
    expect(useApp.getState().openAnalysisResultId).toBe("r1");
    useApp.setState({ analysisResults: [result("r1", "d1"), result("r2", "d1"), result("r3", "d2")], openAnalysisResultId: null });
    const many = find("Open results (2)") as Extract<Leaf, { submenu: ContextMenuItem[] }>;
    expect(many.submenu).toHaveLength(2);
    (many.submenu[1] as Extract<Leaf, { run: () => void }>).run();
    expect(useApp.getState().openAnalysisResultId).toBe("r2");
    useApp.setState({ activeId: "d2" });
    expect(find("Open results (1)")).toBeDefined();
    useApp.setState({ analysisResults: [] });
    expect(labelled(analyzeMenu()).some((i) => i.label.startsWith("Open results"))).toBe(false);
  });
});
