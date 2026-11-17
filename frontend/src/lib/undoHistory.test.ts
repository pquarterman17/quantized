// UX9-J: the Undo History list and the jump. The jump is plain undo() N times,
// so the redo stack must come out intact and walk back to where the user was.
import { beforeEach, describe, expect, it } from "vitest";

import { buildAppMenuItems } from "../components/Shell/appMenuModel";
import { buildHistoryActions } from "../components/history/useHistoryCommands";
import { useToasts } from "../store/toasts";
import { useApp } from "../store/useApp";
import { jumpBackInHistory, undoHistoryRows, UNDO_HISTORY_LIMIT } from "./undoHistory";

const raw = { time: [1, 2, 3], values: [[10], [20], [30]], labels: ["m"], units: ["emu"], metadata: {} };

beforeEach(() => {
  useApp.setState({ datasets: [], activeId: null, selectedIds: [], worksheetId: null, history: [], future: [] });
  useToasts.setState({ toasts: [] });
});

function addN(n: number): void {
  for (let i = 0; i < n; i++) useApp.getState().addDataset({ id: `d${i}`, name: `d${i}`, data: raw });
}

describe("undoHistoryRows", () => {
  it("lists the newest first, marks the current state, and caps at 20", () => {
    addN(25);
    const rows = undoHistoryRows(useApp.getState().history);
    expect(rows).toHaveLength(UNDO_HISTORY_LIMIT);
    expect(rows[0]).toMatchObject({ stepsBack: 0, current: true });
    expect(rows.slice(1).every((r) => !r.current)).toBe(true);
    expect(rows.map((r) => r.stepsBack)).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });
});

describe("jumpBackInHistory", () => {
  it("undoes N steps in one go and leaves redo able to come back", () => {
    addN(5);
    expect(useApp.getState().datasets).toHaveLength(5);
    expect(jumpBackInHistory(useApp.getState, 3)).toBe(3);
    expect(useApp.getState().datasets).toHaveLength(2);
    expect(useApp.getState().future).toHaveLength(3);
    for (let i = 0; i < 3; i++) useApp.getState().redo();
    expect(useApp.getState().datasets).toHaveLength(5);
    expect(useApp.getState().future).toHaveLength(0);
  });

  it("resolves the clicked entry by identity when the stack moved under an open menu", () => {
    addN(5);
    const rows = undoHistoryRows(useApp.getState().history);
    useApp.getState().addDataset({ id: "late0", name: "late0", data: raw }); // history changed while the flyout was open
    useApp.getState().addDataset({ id: "late", name: "late", data: raw });
    expect(jumpBackInHistory(useApp.getState, rows[2].stepsBack, rows[2].seq)).toBe(4); // 2 + the 2 new edits
    expect(useApp.getState().datasets).toHaveLength(3); // the state right after the clicked edit
    expect(jumpBackInHistory(useApp.getState, 1, -1)).toBe(0); // an entry that no longer exists
  });

  it("clamps to the stack and ignores zero", () => {
    addN(2);
    expect(jumpBackInHistory(useApp.getState, 0)).toBe(0);
    expect(jumpBackInHistory(useApp.getState, 99)).toBe(2);
    expect(useApp.getState().datasets).toHaveLength(0);
  });
});

describe("Edit menu flyout", () => {
  it("shows the history, current state marked, and a click jumps there", () => {
    addN(4);
    const items = buildAppMenuItems("Edit", buildHistoryActions(null, null), (s) => s);
    const fly = items.find((i) => "submenu" in i && i.label === "Undo history");
    if (!fly || !("submenu" in fly)) throw new Error("no Undo history flyout");
    expect(fly.submenu).toHaveLength(4);
    expect(fly.submenu[0]).toMatchObject({ checked: true, shortcutLabel: "current" });
    const third = fly.submenu[2];
    if (!("run" in third)) throw new Error("not a leaf");
    third.run();
    expect(useApp.getState().datasets).toHaveLength(2);
  });

  it("is disabled with a reason when there is nothing to undo", () => {
    const items = buildAppMenuItems("Edit", [], (s) => s);
    expect(items).toContainEqual(expect.objectContaining({ label: "Undo history", disabled: true, title: "Nothing to undo yet" }));
  });
});
