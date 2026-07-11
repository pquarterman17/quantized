// Tests for the Library row's multi-selection quick-pick menu (MAIN_PLAN
// #19 v1): the >=2-selected gate, item labels/count, and that each pick
// creates + focuses a panel window over the CURRENT multi-selection.

import { describe, expect, it, vi } from "vitest";

import { multiSelectMenuItems } from "./panelMenu";
import type { ContextMenuItem } from "../components/overlays/ContextMenu";

function actionsMock() {
  return {
    mergeSelected: vi.fn(),
    createPanelWindow: vi.fn(() => "win-1"),
    focusWindow: vi.fn(),
  };
}

function labelsOf(items: ContextMenuItem[]): (string | undefined)[] {
  return items.map((i) => ("label" in i ? i.label : undefined));
}

describe("multiSelectMenuItems", () => {
  it("is empty with fewer than 2 selected", () => {
    expect(multiSelectMenuItems(false, 0, [], actionsMock())).toEqual([]);
    expect(multiSelectMenuItems(true, 1, ["a"], actionsMock())).toEqual([]);
  });

  it("with >=2 selected: a separator, merge, and 4 panel/overlay quick picks", () => {
    const items = multiSelectMenuItems(true, 2, ["a", "b"], actionsMock());
    expect(items).toHaveLength(6); // separator + merge + 4 picks
    expect(items[0]).toEqual({ separator: true });
    expect(labelsOf(items.slice(1))).toEqual([
      "Merge 2 selected",
      "Panel: side by side",
      "Panel: stacked",
      "Panel: grid",
      "Overlay in one plot",
    ]);
  });

  it("merge item runs actions.mergeSelected", () => {
    const actions = actionsMock();
    const items = multiSelectMenuItems(true, 2, ["a", "b"], actions);
    const merge = items.find((i) => "label" in i && i.label === "Merge 2 selected") as {
      run: () => void;
    };
    merge.run();
    expect(actions.mergeSelected).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["Panel: side by side", "row"],
    ["Panel: stacked", "column"],
    ["Panel: grid", "grid"],
    ["Overlay in one plot", "overlay"],
  ] as const)("%s creates a panel window with layout %s over the selection, then focuses it", (label, layout) => {
    const actions = actionsMock();
    const items = multiSelectMenuItems(true, 3, ["a", "b", "c"], actions);
    const pick = items.find((i) => "label" in i && i.label === label) as { run: () => void };
    pick.run();
    expect(actions.createPanelWindow).toHaveBeenCalledWith(["a", "b", "c"], layout);
    expect(actions.focusWindow).toHaveBeenCalledWith("win-1");
  });
});
