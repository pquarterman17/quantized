// A row-count change from outside (a correction trim, a derived recompute, a re-import that changed the row count)
// clears the plot's row window with a status line saying why, rather than leave a window that no longer means the same
// rows (ROW_RANGE_CONTRACT 3.2). The same row count leaves it alone; a window on another sheet is untouched.
import { beforeEach, describe, expect, it } from "vitest";

import { defaultPlotView } from "../lib/plotview";
import type { Dataset } from "../lib/types";
import { setPlotRowRange } from "./plotRowRangeSet";
import { markRowsReplaced } from "./rowRangeShift";
import { useApp } from "./useApp";
import { mainWindow } from "./windowDefaults";
import { plotWindowView, syncPlotWindow } from "./windowDocuments";

const mk = (id: string): Dataset => ({
  id, name: `${id}.dat`,
  data: { time: Array.from({ length: 100 }, (_v, i) => i), values: Array.from({ length: 100 }, (_v, i) => [i]), labels: ["A"], units: [""], metadata: {} },
});

beforeEach(() => {
  useApp.setState(useApp.getInitialState(), true);
  useApp.setState({ datasets: [mk("d"), mk("e")], activeId: "d", history: [], future: [], status: "" });
});

describe("plot row window on a row-count change from outside", () => {
  it("clears the live window and says why, keeping the status it extends", () => {
    setPlotRowRange({ from: 20, to: 43 });
    useApp.setState({ status: "Corrections applied: 100 -> 90 rows" });
    markRowsReplaced("d", true);
    expect(useApp.getState().rowRange).toBeUndefined();
    expect(useApp.getState().status).toBe("Corrections applied: 100 -> 90 rows; The plot row range (rows 21-44) was cleared: the worksheet's rows were replaced, so it no longer means the same rows.");
  });

  it("leaves a window alone when the row count did not change, and one on another sheet", () => {
    setPlotRowRange({ from: 20, to: 43 });
    markRowsReplaced("d", false);
    expect(useApp.getState().rowRange).toEqual({ from: 20, to: 43 });
    markRowsReplaced("e", true);
    expect(useApp.getState().rowRange).toEqual({ from: 20, to: 43 });
    expect(useApp.getState().status).not.toContain("cleared");
  });

  it("clears another window's saved view of that sheet too, and one undo of the caller's step restores it", () => {
    const w = mainWindow("d", "w2");
    useApp.setState({ plotWindows: [{ ...syncPlotWindow(w, { ...defaultPlotView(), rowRange: { from: 20, to: 43 } }), id: "w2" }] });
    useApp.getState().recordHistory("corrections");
    markRowsReplaced("d", true);
    expect(plotWindowView(useApp.getState().plotWindows.find((x) => x.id === "w2")!).rowRange).toBeUndefined();
    useApp.getState().undo();
    expect(plotWindowView(useApp.getState().plotWindows.find((x) => x.id === "w2")!).rowRange).toEqual({ from: 20, to: 43 });
  });
});
