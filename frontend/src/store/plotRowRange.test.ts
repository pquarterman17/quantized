// R2 of ROW_RANGE_CONTRACT through the real store: the plot's row window
// (`PlotView.rowRange`) is a view edit (one undo step), follows insert and
// delete in the live view AND in other windows' documents (one undo restores
// the data and the windows together), is never carried to another sheet, is not
// captured by a recipe, and survives a .dwk round trip at the v9 rung.
import { beforeEach, describe, expect, it } from "vitest";

import { defaultPlotView } from "../lib/plotview";
import { captureRecipe } from "../lib/plotRecipe";
import { parseWorkspace, serializeWorkspace } from "../lib/workspace";
import type { Dataset } from "../lib/types";
import { sortWorksheetRows } from "./sortRows";
import { setPlotRowRange } from "./plotRowRangeSet";
import { useApp } from "./useApp";
import { mainWindow } from "./windowDefaults";
import { plotWindowView, syncPlotWindow } from "./windowDocuments";

const n = 200;
const sheet = (id = "d"): Dataset => ({
  id,
  name: `${id}.csv`,
  data: {
    time: Array.from({ length: n }, (_v, i) => i),
    values: Array.from({ length: n }, (_v, i) => [(i * 7) % n]),
    labels: ["v"], units: ["V"], metadata: {},
  },
});

function otherWindow(range: { from: number; to: number }) {
  const w = mainWindow("d", "w2");
  return { ...syncPlotWindow(w, { ...defaultPlotView(), rowRange: range }), id: "w2" };
}
const bgRange = () => plotWindowView(useApp.getState().plotWindows.find((w) => w.id === "w2")!).rowRange;

beforeEach(() => {
  useApp.setState(useApp.getInitialState(), true);
  useApp.setState({ datasets: [sheet(), sheet("e")], activeId: "d", history: [], future: [], status: "", rowRange: undefined });
});

describe("plot row range in the real store", () => {
  it("sets, clears and undoes as one view edit; an unreadable range is refused", () => {
    setPlotRowRange({ from: 20, to: 43 });
    expect(useApp.getState().rowRange).toEqual({ from: 20, to: 43 });
    setPlotRowRange({ from: 5, to: 2 });
    expect(useApp.getState().rowRange).toEqual({ from: 20, to: 43 }); // refused, not clamped
    setPlotRowRange(null);
    expect(useApp.getState().rowRange).toBeUndefined();
    useApp.getState().undo(); // Ctrl+Z restores the window
    expect(useApp.getState().rowRange).toEqual({ from: 20, to: 43 });
    useApp.getState().undo();
    expect(useApp.getState().rowRange).toBeUndefined();
  });

  it("insert above, inside and after moves, grows and spares it; the other windows follow; one undo restores both", () => {
    useApp.setState({ plotWindows: [otherWindow({ from: 20, to: 43 })] });
    setPlotRowRange({ from: 20, to: 43 });
    useApp.getState().insertRows("d", 0, 2); // above
    expect(useApp.getState().rowRange).toEqual({ from: 22, to: 45 });
    expect(bgRange()).toEqual({ from: 22, to: 45 });
    useApp.getState().insertRows("d", 30, 1); // inside
    expect(useApp.getState().rowRange).toEqual({ from: 22, to: 46 });
    useApp.getState().insertRows("d", 100, 5); // after
    expect(useApp.getState().rowRange).toEqual({ from: 22, to: 46 });
    useApp.getState().undo();
    useApp.getState().undo();
    expect(useApp.getState().rowRange).toEqual({ from: 22, to: 45 });
    useApp.getState().undo(); // the insert above: data and BOTH windows come back together
    expect(useApp.getState().rowRange).toEqual({ from: 20, to: 43 });
    expect(bgRange()).toEqual({ from: 20, to: 43 });
    expect(useApp.getState().datasets[0].data.time).toHaveLength(n);
  });

  it("delete above moves it; deleting every row of it clears it with a status, and one undo restores it", () => {
    useApp.setState({ plotWindows: [otherWindow({ from: 20, to: 43 })] });
    setPlotRowRange({ from: 20, to: 43 });
    useApp.getState().deleteRows("d", [0, 1, 2]);
    expect(useApp.getState().rowRange).toEqual({ from: 17, to: 40 });
    expect(bgRange()).toEqual({ from: 17, to: 40 });
    useApp.getState().deleteRows("d", Array.from({ length: 24 }, (_v, i) => 17 + i));
    expect(useApp.getState().rowRange).toBeUndefined();
    expect(bgRange()).toBeUndefined();
    expect(useApp.getState().status).toMatch(/rows 18-41 no longer exist: the plot row range was cleared/);
    useApp.getState().undo();
    expect(useApp.getState().rowRange).toEqual({ from: 17, to: 40 });
    expect(bgRange()).toEqual({ from: 17, to: 40 });
  });

  it("another sheet's edits never move it", () => {
    setPlotRowRange({ from: 20, to: 43 });
    useApp.getState().insertRows("e", 0, 3);
    expect(useApp.getState().rowRange).toEqual({ from: 20, to: 43 });
  });

  it("a sort leaves it by position and the status line says so", () => {
    setPlotRowRange({ from: 20, to: 43 });
    sortWorksheetRows("d", 0, 1);
    expect(useApp.getState().rowRange).toEqual({ from: 20, to: 43 });
    expect(useApp.getState().status).toMatch(/1 row range is by position and now covers different rows/);
  });

  it("switching to another sheet does not carry positions across", () => {
    setPlotRowRange({ from: 20, to: 43 });
    useApp.getState().setActive("e");
    expect(useApp.getState().rowRange).toBeUndefined();
  });

  it("a recipe does not capture it", () => {
    setPlotRowRange({ from: 20, to: 43 });
    const ds = useApp.getState().datasets[0];
    const r = captureRecipe(ds, { ...defaultPlotView(), ...useApp.getState(), xKey: 0, yKeys: [0] } as never, null, {
      id: "r1", name: "x", appVersion: "0", now: () => "2026-11-27T00:00:00.000Z",
    });
    expect(JSON.stringify(r)).not.toMatch(/rowRange/);
  });

  it("round-trips a project at the v9 rung and reopens with the window", () => {
    setPlotRowRange({ from: 20, to: 43 });
    const s = useApp.getState();
    const view = { ...defaultPlotView(), rowRange: s.rowRange };
    const w = { ...syncPlotWindow(mainWindow("d", "w1"), view), id: "w1" };
    const text = serializeWorkspace({ ...(s as unknown as Record<string, unknown>), plotWindows: [w], focusedWindowId: "w1" } as never);
    expect(JSON.parse(text).version).toBe(9);
    const back = parseWorkspace(text, { width: 1200, height: 800 });
    expect(plotWindowView(back.plotWindows[0]).rowRange).toEqual({ from: 20, to: 43 });
  });
});
