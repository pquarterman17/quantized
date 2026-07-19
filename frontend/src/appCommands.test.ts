// Direct behavioral test for the "Cycle X/Y tick format" commands (MAIN
// #20) — buildAppActions is curated against the REAL store (StoreGet =
// typeof useApp.getState), so a command can be found by id and run() against
// the live store without mounting the App tree.

import { beforeEach, describe, expect, it } from "vitest";

import { buildAppActions } from "./appCommands";
import { useApp } from "./store/useApp";

beforeEach(() => {
  useApp.setState({
    xFmt: { mode: "auto", digits: 2 },
    yFmt: { mode: "auto", digits: 2 },
  });
});

function findCommand(id: string) {
  const action = buildAppActions(useApp.getState).find((a) => a.id === id);
  if (!action) throw new Error(`command "${id}" not registered`);
  return action;
}

describe("Cycle X/Y tick format commands (MAIN #20)", () => {
  it("yTickFormat cycles auto -> fixed -> sci -> eng -> auto, preserving digits", () => {
    useApp.setState({ yFmt: { mode: "auto", digits: 3 } });
    const cmd = findCommand("yTickFormat");
    expect(cmd.group).toBe("Plot");
    cmd.run();
    expect(useApp.getState().yFmt).toEqual({ mode: "fixed", digits: 3 });
    cmd.run();
    expect(useApp.getState().yFmt).toEqual({ mode: "sci", digits: 3 });
    cmd.run();
    expect(useApp.getState().yFmt).toEqual({ mode: "eng", digits: 3 });
    cmd.run();
    expect(useApp.getState().yFmt).toEqual({ mode: "auto", digits: 3 });
  });

  it("xTickFormat cycles independently of yFmt", () => {
    const cmd = findCommand("xTickFormat");
    cmd.run();
    expect(useApp.getState().xFmt.mode).toBe("fixed");
    expect(useApp.getState().yFmt.mode).toBe("auto"); // untouched
  });
});

describe("Insert commands (MAIN #27 drawing shapes — the menu-driven counterpart of the dock flyout)", () => {
  it("registers all five entries in the Insert group", () => {
    const ids = ["insert-arrow", "insert-line", "insert-rect", "insert-ellipse", "insert-textbox"];
    for (const id of ids) {
      expect(findCommand(id).group).toBe("Insert");
    }
  });

  it("each command sets drawShapeKind to its matching kind", () => {
    const cases: [string, string][] = [
      ["insert-arrow", "arrow"],
      ["insert-line", "line"],
      ["insert-rect", "rect"],
      ["insert-ellipse", "ellipse"],
      ["insert-textbox", "textbox"],
    ];
    for (const [id, kind] of cases) {
      useApp.setState({ drawShapeKind: null });
      findCommand(id).run();
      expect(useApp.getState().drawShapeKind).toBe(kind);
    }
  });
});

// GUI_INTERACTION #17 — sub-topic grouping in the long menus. A new command
// that forgets `section` renders header-less ABOVE every grouped item
// (withSectionHeaders puts unsectioned first), quietly re-growing the flat
// list this item exists to fix. Cheaper to fail here than to notice in the UI.
const SECTIONED_MENUS: Record<string, { min: number; allowed: string[] }> = {
  Analyze: {
    min: 16,
    allowed: [
      "Fit",
      "Peaks & baseline",
      "Magnetometry",
      "XRD & reflectivity",
      "Transform & signal",
      "Statistics",
      "Workflow",
    ],
  },
  Data: {
    min: 10,
    allowed: ["Combine & split", "Rows & summary", "Recalculation"],
  },
  Plot: { min: 21, allowed: ["Axes", "Display", "Layout", "Build & export"] },
};

describe.each(Object.entries(SECTIONED_MENUS))("%s menu sections (#17)", (group, cfg) => {
  const items = () => buildAppActions(useApp.getState).filter((a) => a.group === group);

  it("files every command under a section", () => {
    expect(items().filter((a) => !a.section).map((a) => a.id)).toEqual([]);
  });

  it("uses only the agreed section vocabulary", () => {
    const allowed = new Set(cfg.allowed);
    expect([...new Set(items().map((a) => a.section!))].filter((s) => !allowed.has(s))).toEqual([]);
  });

  it("still registers the full command set (the scan is not vacuous)", () => {
    expect(items().length).toBeGreaterThanOrEqual(cfg.min);
  });
});
