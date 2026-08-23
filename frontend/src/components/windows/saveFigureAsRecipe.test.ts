// P1.3 wave 3, Lane D deliverable 2: the Save-as-Recipe entry point, the
// `figureLifecycleUi.ts` `saveFigureAs` sibling (split into its own module
// for the bundle-size budget -- see saveFigureAsRecipe.ts's header).

import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultPlotView } from "../../lib/plotview";
import { useApp } from "../../store/useApp";
import { saveFocusedFigureAsRecipe } from "./saveFigureAsRecipe";

const askParams = vi.fn();
vi.mock("../overlays/ParamDialog", () => ({
  askParams: (...args: unknown[]) => askParams(...args) as Promise<Record<string, unknown> | null>,
}));

beforeEach(() => {
  askParams.mockReset();
});

describe("saveFocusedFigureAsRecipe", () => {
  function datasetAndFocusedWindow(): { datasetId: string; windowId: string } {
    const datasetId = "d1";
    useApp.setState({
      datasets: [
        {
          id: datasetId,
          name: "d1.xy",
          data: {
            time: [0, 1, 2],
            values: [[10, 100], [20, 200], [30, 300]],
            labels: ["x", "y"],
            units: ["", ""],
            metadata: { technique: "xrd.powder" },
          },
        },
      ],
      plotRecipes: [],
    });
    const windowId = useApp.getState().createWindow(datasetId, { ...defaultPlotView(), xKey: 0, yKeys: [1] }, "My Plot");
    useApp.getState().focusWindow(windowId);
    return { datasetId, windowId };
  }

  it("prompts with the window's title as the default name, then saves via the real store action", async () => {
    datasetAndFocusedWindow();
    askParams.mockResolvedValueOnce({ name: "My Recipe" });

    await saveFocusedFigureAsRecipe();

    expect(askParams).toHaveBeenCalledWith("Save as Plot Recipe", [
      { key: "name", label: "Name", type: "text", default: "My Plot" },
    ]);
    expect(useApp.getState().plotRecipes.map((r) => r.name)).toEqual(["My Recipe"]);
  });

  it("cancelling the dialog saves nothing", async () => {
    datasetAndFocusedWindow();
    askParams.mockResolvedValueOnce(null);

    await saveFocusedFigureAsRecipe();

    expect(useApp.getState().plotRecipes).toHaveLength(0);
  });

  it("no focused window: sets a status message and never opens the dialog", async () => {
    useApp.setState({ focusedWindowId: null, plotRecipes: [] });

    await saveFocusedFigureAsRecipe();

    expect(askParams).not.toHaveBeenCalled();
    expect(useApp.getState().status).toContain("unavailable");
    expect(useApp.getState().plotRecipes).toHaveLength(0);
  });

  it("focused window is not a plot window: sets a status message and never opens the dialog", async () => {
    useApp.setState({
      datasets: [
        {
          id: "d1",
          name: "d1.xy",
          data: { time: [0], values: [[1]], labels: ["y"], units: [""], metadata: {} },
        },
      ],
      plotRecipes: [],
    });
    const windowId = useApp.getState().createDocumentWindow("worksheet", "d1");
    useApp.getState().focusWindow(windowId);

    await saveFocusedFigureAsRecipe();

    expect(askParams).not.toHaveBeenCalled();
    expect(useApp.getState().status).toContain("unavailable");
  });
});
