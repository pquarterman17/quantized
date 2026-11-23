// seedFromClassic (plan "Migration of existing users") and the per-user
// `qz.windowLayout` template (plan "Persistence": last layout shape, applied
// only to a project without its own layout).
import { afterEach, describe, expect, it } from "vitest";

import { close, dock, emptyLayout, float, stackOf } from "./ops";
import { seedFromClassic } from "./seed";
import {
  applyTemplate, loadLayoutTemplate, sanitizeTemplate, saveLayoutTemplate, templateOf, WINDOW_LAYOUT_TEMPLATE_KEY,
} from "./template";
import { checkInvariants } from "../../test/windowLayoutInvariants";

afterEach(() => localStorage.clear());

describe("seedFromClassic", () => {
  it("maximized plot to the centre, other plots float in z order, Style right with the docked tool under it", () => {
    const l = seedFromClassic({
      plotWindows: [
        { id: "w1", z: 1, winState: "maximized" }, { id: "w2", z: 2, winState: "minimized" },
      ],
      dockedTool: "curvefit",
      floatingTools: ["baseline", "curvefit"],
    });
    checkInvariants(l);
    expect(stackOf(l, "centre")).toEqual(["plot:w1"]);
    expect(l.z).toEqual(["plot:w2", "tool:baseline"]);
    expect(stackOf(l, "right")).toEqual(["style", "tool:curvefit"]);
    expect(l.placements.data).toEqual({ slot: "right", order: 0, share: 1, lastSlot: "right", open: false });
    expect(l.placements.analysis!.open).toBe(false);
  });

  it("with nothing maximized and no docked tool, every plot floats and Style docks alone", () => {
    const l = seedFromClassic({ plotWindows: [{ id: "a", z: 1 }], dockedTool: null });
    checkInvariants(l);
    expect(stackOf(l, "centre")).toEqual([]);
    expect(l.z).toEqual(["plot:a"]);
    expect(stackOf(l, "right")).toEqual(["style"]);
  });
});

describe("seedFromClassic: M1 several plots and m8 small screens", () => {
  const three = [{ id: "a", z: 1 }, { id: "b", z: 2 }, { id: "c", z: 3, winState: "minimized" }];

  it("two or more visible plot windows dock to the centre as a grid, so none floats over docked Style", () => {
    const l = seedFromClassic({ plotWindows: three, dockedTool: null });
    checkInvariants(l);
    expect(stackOf(l, "centre")).toEqual(["plot:a", "plot:b"]);
    expect(l.centre).toBe("grid");
    expect(l.z).toEqual(["plot:c"]); // the minimized one is not on screen
    expect(stackOf(l, "right")).toEqual(["style"]);
  });

  it("a small screen (D6) docks nothing: plots and Style float, Style remembering the right edge", () => {
    const l = seedFromClassic({ plotWindows: [{ id: "a", z: 1, winState: "maximized" }, { id: "b", z: 2 }], dockedTool: "curvefit" }, { small: true });
    checkInvariants(l);
    for (const slot of ["left", "centre", "right", "bottom"] as const) expect(stackOf(l, slot)).toEqual([]);
    expect(l.z).toEqual(["plot:a", "plot:b", "style", "tool:curvefit"]);
    expect(l.placements.style!.lastSlot).toBe("right");
  });
});

describe("layout template", () => {
  const desk = () => close(dock(float(dock(dock(dock(emptyLayout(), "plot:w1", "centre"), "data", "left"), "tool:cf", "bottom"), "tool:st"), "analysis", "right"), "analysis");

  it("templateOf keeps only the shape: a slot per kind, no project ids", () => {
    const t = templateOf({ ...desk(), edges: { left: 250, right: 0, bottom: 180 }, centre: "grid" });
    expect(t).toEqual({
      v: 1,
      kinds: { data: { slot: "left", open: true }, plot: { slot: "centre", open: true }, tool: { slot: "bottom", open: true }, analysis: { slot: "right", open: false } },
      edges: { left: 250, right: 0, bottom: 180 },
      centre: "grid",
    });
    expect(JSON.stringify(t)).not.toMatch(/w1|cf|st/);
  });

  it("applyTemplate lays a new project's windows out the same way; only the first plot follows the plot rule", () => {
    const t = templateOf(desk());
    const l = applyTemplate(emptyLayout(), t, ["plot:p1", "plot:p2", "data", "tool:x", "analysis"]);
    checkInvariants(l);
    expect(stackOf(l, "centre")).toEqual(["plot:p1"]);
    expect(l.placements["plot:p2"]).toBeUndefined();
    expect(stackOf(l, "left")).toEqual(["data"]);
    expect(stackOf(l, "bottom")).toEqual(["tool:x"]);
    expect(l.placements.analysis).toMatchObject({ slot: "right", open: false });
  });

  it("round-trips through localStorage under qz.windowLayout", () => {
    expect(loadLayoutTemplate()).toBeNull();
    saveLayoutTemplate(desk());
    expect(localStorage.getItem(WINDOW_LAYOUT_TEMPLATE_KEY)).not.toBeNull();
    expect(loadLayoutTemplate()).toEqual(templateOf(desk()));
  });

  it.each([
    ["bad JSON", "{"],
    ["a future version", JSON.stringify({ ...templateOf(emptyLayout()), v: 2 })],
    ["an unknown kind", JSON.stringify({ ...templateOf(emptyLayout()), kinds: { map: { slot: "left", open: true } } })],
    ["a bad slot", JSON.stringify({ ...templateOf(emptyLayout()), kinds: { data: { slot: "top", open: true } } })],
    ["a negative edge", JSON.stringify({ ...templateOf(emptyLayout()), edges: { left: -1, right: 0, bottom: 0 } })],
    ["a bad centre", JSON.stringify({ ...templateOf(emptyLayout()), centre: "stack" })],
  ])("an unreadable template (%s) is no template, never a throw", (_why, raw) => {
    localStorage.setItem(WINDOW_LAYOUT_TEMPLATE_KEY, raw);
    expect(loadLayoutTemplate()).toBeNull();
  });

  it("sanitizeTemplate accepts exactly a whole v1 template", () => {
    const t = templateOf(desk());
    expect(sanitizeTemplate(JSON.parse(JSON.stringify(t)))).toEqual(t);
    expect(sanitizeTemplate(null)).toBeNull();
  });
});
