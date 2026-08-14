// store/regionShades — the F2.3j slice: the region-shades array + its
// create/edit/remove actions. Exercised through the composed useApp store
// (same convention as shapes.test.ts).

import { afterEach, describe, expect, it } from "vitest";

import { useApp } from "./useApp";

const ORIGINAL = useApp.getState();

afterEach(() => {
  useApp.setState(ORIGINAL, true);
});

describe("regionShades (F2.3j)", () => {
  it("starts empty", () => {
    expect(useApp.getState().regionShades).toEqual([]);
  });

  it("addRegionShade appends a shade with a fresh id and returns it", () => {
    const id = useApp.getState().addRegionShade({ x1: 0, y1: 0, x2: 1, y2: 1, fill: "#336699" });
    expect(typeof id).toBe("string");
    expect(useApp.getState().regionShades).toEqual([
      { x1: 0, y1: 0, x2: 1, y2: 1, fill: "#336699", id },
    ]);
  });

  it("addRegionShade never reuses an id across calls", () => {
    const id1 = useApp.getState().addRegionShade({ x1: 0, y1: 0, x2: 1, y2: 1, fill: "#336699" });
    const id2 = useApp.getState().addRegionShade({ x1: 0, y1: 0, x2: 1, y2: 1, fill: "#336699" });
    expect(id1).not.toBe(id2);
  });

  it("updateRegionShade patches the matching shade, leaving others untouched", () => {
    useApp.setState({
      regionShades: [
        { id: "sh1", x1: 0, y1: 0, x2: 1, y2: 1, fill: "#336699" },
        { id: "sh2", x1: 2, y1: 2, x2: 3, y2: 3, fill: "#993366" },
      ],
    });
    useApp.getState().updateRegionShade("sh1", { x2: 10, fill: "#ff0000" });
    expect(useApp.getState().regionShades).toEqual([
      { id: "sh1", x1: 0, y1: 0, x2: 10, y2: 1, fill: "#ff0000" },
      { id: "sh2", x1: 2, y1: 2, x2: 3, y2: 3, fill: "#993366" },
    ]);
  });

  it("updateRegionShade is a no-op for an unknown id", () => {
    useApp.setState({ regionShades: [{ id: "sh1", x1: 0, y1: 0, x2: 1, y2: 1, fill: "#336699" }] });
    useApp.getState().updateRegionShade("ghost", { x1: 99 });
    expect(useApp.getState().regionShades).toEqual([
      { id: "sh1", x1: 0, y1: 0, x2: 1, y2: 1, fill: "#336699" },
    ]);
  });

  it("updateRegionShade can flip axis (0/1 toggle) like every other numeric field", () => {
    useApp.setState({ regionShades: [{ id: "sh1", x1: 0, y1: 0, x2: 1, y2: 1, fill: "#336699" }] });
    useApp.getState().updateRegionShade("sh1", { axis: 1 });
    expect(useApp.getState().regionShades[0].axis).toBe(1);
  });

  it("removeRegionShade drops only the matching shade", () => {
    useApp.setState({
      regionShades: [
        { id: "sh1", x1: 0, y1: 0, x2: 1, y2: 1, fill: "#336699" },
        { id: "sh2", x1: 2, y1: 2, x2: 3, y2: 3, fill: "#993366" },
      ],
    });
    useApp.getState().removeRegionShade("sh1");
    expect(useApp.getState().regionShades).toEqual([
      { id: "sh2", x1: 2, y1: 2, x2: 3, y2: 3, fill: "#993366" },
    ]);
  });

  it("removeRegionShade is a no-op for an unknown id", () => {
    useApp.setState({ regionShades: [{ id: "sh1", x1: 0, y1: 0, x2: 1, y2: 1, fill: "#336699" }] });
    useApp.getState().removeRegionShade("ghost");
    expect(useApp.getState().regionShades).toEqual([
      { id: "sh1", x1: 0, y1: 0, x2: 1, y2: 1, fill: "#336699" },
    ]);
  });

  // Every action above calls recordHistory, and architecture.test.ts's
  // HISTORY_EXCLUDED entry justifies the raw field's exclusion by CLAIMING
  // undo captures it inside the `view: PlotView` snapshot (VIEW_KEYS derives
  // from defaultPlotView(), which now lists regionShades). These two tests
  // are the behavioral proof of that claim — without them, a regression that
  // drops regionShades from the view snapshot would leave every shade action
  // announcing "Undid …" while changing nothing, and stay green.
  it("undo reverts addRegionShade; redo re-applies it", () => {
    useApp.setState({ regionShades: [] });
    const id = useApp.getState().addRegionShade({ x1: 0, y1: 0, x2: 1, y2: 1, fill: "#336699" });
    expect(useApp.getState().regionShades).toHaveLength(1);

    useApp.getState().undo();
    expect(useApp.getState().regionShades).toEqual([]);

    useApp.getState().redo();
    expect(useApp.getState().regionShades).toEqual([
      { x1: 0, y1: 0, x2: 1, y2: 1, fill: "#336699", id },
    ]);
  });

  it("undo reverts updateRegionShade to the pre-edit shade", () => {
    useApp.setState({
      regionShades: [{ id: "sh1", x1: 0, y1: 0, x2: 1, y2: 1, fill: "#336699" }],
    });
    useApp.getState().updateRegionShade("sh1", { x2: 10, fill: "#ff0000" });
    expect(useApp.getState().regionShades[0]).toMatchObject({ x2: 10, fill: "#ff0000" });

    useApp.getState().undo();
    expect(useApp.getState().regionShades).toEqual([
      { id: "sh1", x1: 0, y1: 0, x2: 1, y2: 1, fill: "#336699" },
    ]);
  });
});
