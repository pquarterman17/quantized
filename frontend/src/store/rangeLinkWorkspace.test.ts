// A plot window that FOLLOWS a named range survives a save and reopen (ROW_RANGE_CONTRACT 5.2 and 9.1): the file holds
// the link and is written as the gated v9 rung; reopening reads the range, so a range that moved while the project was
// closed (a hand edit of the file stands in) is what the plot shows. A link whose range is missing in the file is refused
// on load, never widened. Also pins the forward-compat classification of the nested `{ named }` shape, which v0.45.0 has
// no `rowRange` key for at all (`git show v0.45.0:frontend/src/lib/plotview.ts` holds none), so it drops the whole key.
import { beforeEach, describe, expect, it } from "vitest";

import { createFigureDocument } from "../lib/figureDocument";
import { defaultPlotView, type PlotWindow } from "../lib/plotview";
import { resolveRangeLink } from "../lib/rangeLink";
import { sanitizeRowRange } from "../lib/rowRangeSanitize";
import type { Dataset } from "../lib/types";
import { featuresV045WouldDrop } from "../lib/workspaceForwardCompat";
import { parseWorkspace, serializeWorkspace, WORKSPACE_VERSION_POST_045 } from "../lib/workspace";
import { resetRangeLinkSyncForTests } from "./rangeLinkSync";
import { useApp } from "./useApp";

const N = 30;
const ds: Dataset = {
  id: "d1", name: "run.csv",
  data: { time: Array.from({ length: N }, (_v, i) => i), values: Array.from({ length: N }, (_v, i) => [i]), labels: ["a"], units: [""], metadata: {} },
};
const range = { id: "nr1:w", name: "Window", scope: { kind: "sheet" as const, datasetId: "d1" }, target: { datasetId: "d1", cols: [0], rows: { from: 4, to: 9 } } };
const VIEWPORT = { width: 1600, height: 900 };

function windowWithLink(): PlotWindow {
  const view = { ...defaultPlotView(), rowRange: resolveRangeLink("nr1:w", "d1", [range], [ds]) };
  const document = createFigureDocument({ id: "f1", name: "W", datasetId: "d1", view, groupKey: null, facetKey: null });
  return { id: "w1", kind: "plot", title: "W", datasetId: "d1", geometry: { x: 1, y: 2, w: 300, h: 200 }, z: 1, winState: "normal", view, document, bg: "theme", linkGroup: null, pinned: false };
}
const save = (namedRanges = [range]) =>
  serializeWorkspace({ datasets: [ds], plotWindows: [windowWithLink()], focusedWindowId: "w1", namedRanges });

beforeEach(() => {
  resetRangeLinkSyncForTests();
  useApp.setState({ datasets: [], namedRanges: [], plotWindows: [], focusedWindowId: null, rowRange: undefined, activeId: null });
});

describe("the live link in a .dwk", () => {
  it("is written as the gated v9 rung and reads back as a link with the range's id", () => {
    const text = save();
    expect(JSON.parse(text).version).toBe(WORKSPACE_VERSION_POST_045);
    expect(featuresV045WouldDrop(JSON.parse(text))).toContain("PlotView.rowRange"); // v0.45.0 would draw every row
    const back = parseWorkspace(text, VIEWPORT);
    expect(back.plotWindows![0].view.rowRange).toMatchObject({ named: "nr1:w" });
    expect(back.namedRanges).toHaveLength(1);
  });

  it("a hand-written { named: id } is read as a link; anything else with no rows is dropped", () => {
    expect(sanitizeRowRange({ named: "nr1:w" })).toEqual({ from: 0, to: -1, named: "nr1:w" }); // no rows until the sync reads it
    expect(sanitizeRowRange({ named: "" })).toBeUndefined();
    expect(sanitizeRowRange({ named: 5 })).toBeUndefined();
  });

  it("reopening reads the range: the loaded window follows the file's range, not the cache it was saved with", async () => {
    const moved = { ...range, target: { ...range.target, rows: { from: 10, to: 12 } } };
    const text = JSON.stringify({ ...JSON.parse(save()), namedRanges: [moved] }); // the range moved while the project was closed
    useApp.getState().loadWorkspace(parseWorkspace(text, VIEWPORT));
    await new Promise((resolve) => setTimeout(resolve, 20)); // the sync is a lazy chunk
    const s = useApp.getState();
    const win = s.plotWindows[0];
    const shown = s.focusedWindowId === win.id ? s.rowRange : win.view.rowRange;
    expect(shown).toEqual({ from: 10, to: 12, named: "nr1:w", namedAs: "Window" });
  });

  it("a link whose range is missing from the file is refused on load, never widened", async () => {
    const text = JSON.stringify({ ...JSON.parse(save()), namedRanges: [] });
    useApp.getState().loadWorkspace(parseWorkspace(text, VIEWPORT));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const s = useApp.getState();
    const shown = s.focusedWindowId === s.plotWindows[0].id ? s.rowRange : s.plotWindows[0].view.rowRange;
    expect(shown).toMatchObject({ named: "nr1:w", refused: "the named range was removed", to: -1 });
  });
});
