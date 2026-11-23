// seedFromClassic (plan "Migration of existing users") and the per-user
// `qz.windowLayout` template (plan "Persistence": last layout shape, applied
// only to a project without its own layout).
import { afterEach, describe, expect, it } from "vitest";

import { close, dock, emptyLayout, float, stackOf } from "./ops";
import { seedFromClassic } from "./seed";
import {
  applyTemplate, deskClassOf, loadLayoutTemplate, mergeTemplate, sanitizeTemplate, saveLayoutTemplate, seedWithTemplate, templateOf,
  toolFirstPlacement, WINDOW_LAYOUT_TEMPLATE_KEY,
} from "./template";
import { reopen } from "./ops";
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

  it("a small screen (D6) docks nothing: plots and Style float, Style remembering the right edge; Data and Analysis start closed and floating", () => {
    const l = seedFromClassic({ plotWindows: [{ id: "a", z: 1, winState: "maximized" }, { id: "b", z: 2 }], dockedTool: "curvefit" }, { small: true });
    checkInvariants(l);
    for (const slot of ["left", "centre", "right", "bottom"] as const) expect(stackOf(l, slot)).toEqual([]);
    expect(l.z).toEqual(["plot:a", "plot:b", "style", "tool:curvefit"]);
    expect(l.placements.style!.lastSlot).toBe("right");
    expect(l.placements.data).toMatchObject({ slot: null, open: false, lastSlot: "right" });
    expect(l.placements.analysis).toMatchObject({ slot: null, open: false });
    expect(seedFromClassic({ plotWindows: [{ id: "a", z: 1 }], dockedTool: null }).placements.data).toMatchObject({ slot: "right", open: false }); // wide desk unchanged
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
    ["a future version", JSON.stringify({ ...templateOf(emptyLayout()), v: 3 })],
    ["a store of an unknown version", JSON.stringify({ v: 9, wide: templateOf(emptyLayout()), narrow: templateOf(emptyLayout()) })],
    ["an unknown kind", JSON.stringify({ ...templateOf(emptyLayout()), kinds: { map: { slot: "left", open: true } } })],
    ["a bad slot", JSON.stringify({ ...templateOf(emptyLayout()), kinds: { data: { slot: "top", open: true } } })],
    ["a negative edge", JSON.stringify({ ...templateOf(emptyLayout()), edges: { left: -1, right: 0, bottom: 0 } })],
    ["a bad centre", JSON.stringify({ ...templateOf(emptyLayout()), centre: "stack" })],
  ])("an unreadable template (%s) is no template, never a throw", (_why, raw) => {
    localStorage.setItem(WINDOW_LAYOUT_TEMPLATE_KEY, raw);
    expect(loadLayoutTemplate()).toBeNull();
  });

  it("an unreadable template stays unreadable for the narrow class too", () => {
    localStorage.setItem(WINDOW_LAYOUT_TEMPLATE_KEY, "{");
    expect(loadLayoutTemplate("narrow")).toBeNull();
    expect(loadLayoutTemplate("wide")).toBeNull();
  });

  it("sanitizeTemplate accepts exactly a whole v1 template", () => {
    const t = templateOf(desk());
    expect(sanitizeTemplate(JSON.parse(JSON.stringify(t)))).toEqual(t);
    expect(sanitizeTemplate(null)).toBeNull();
  });
});

describe("one template per width class (owner-approved 2026-11-23)", () => {
  const wideDesk = () => dock(dock(emptyLayout(), "data", "left"), "style", "bottom");
  const narrowDesk = () => dock(dock(emptyLayout(), "data", "right"), "style", "right");
  const stored = () => JSON.parse(localStorage.getItem(WINDOW_LAYOUT_TEMPLATE_KEY) ?? "null");

  it("deskClassOf: 1280 px and over is wide, under it narrow", () => {
    expect([deskClassOf(1279), deskClassOf(1280), deskClassOf(320), deskClassOf(2560)]).toEqual(["narrow", "wide", "narrow", "wide"]);
  });

  it("migrates the old single template to wide; narrow starts empty; the next write is the versioned store", () => {
    localStorage.setItem(WINDOW_LAYOUT_TEMPLATE_KEY, JSON.stringify(templateOf(wideDesk())));
    expect(loadLayoutTemplate("wide")).toEqual(templateOf(wideDesk()));
    expect(loadLayoutTemplate("narrow")).toBeNull();
    saveLayoutTemplate(narrowDesk(), true, "narrow");
    expect(stored()).toEqual({ v: 2, wide: templateOf(wideDesk()), narrow: templateOf(narrowDesk()) });
  });

  it("a narrow write changes narrow only; a wide write changes wide only", () => {
    saveLayoutTemplate(wideDesk(), true, "wide");
    const wide = templateOf(wideDesk());
    expect(stored()).toEqual({ v: 2, wide });
    saveLayoutTemplate(narrowDesk(), true, "narrow");
    expect(stored()).toEqual({ v: 2, wide, narrow: templateOf(narrowDesk()) });
    saveLayoutTemplate(dock(wideDesk(), "data", "right"), true, "wide");
    expect(loadLayoutTemplate("narrow")).toEqual(templateOf(narrowDesk()));
    expect(loadLayoutTemplate("wide")!.kinds.data!.slot).toBe("right");
  });

  it("a replacing write (Reset) replaces its own class only", () => {
    saveLayoutTemplate(wideDesk(), true, "wide");
    saveLayoutTemplate(narrowDesk(), true, "narrow");
    saveLayoutTemplate(dock(emptyLayout(), "data", "centre"), false, "narrow");
    expect(loadLayoutTemplate("wide")).toEqual(templateOf(wideDesk()));
    expect(loadLayoutTemplate("narrow")!.kinds.style).toBeUndefined();
  });

  it("a corrupt class is empty while the other class still reads", () => {
    localStorage.setItem(WINDOW_LAYOUT_TEMPLATE_KEY, JSON.stringify({ v: 2, wide: templateOf(wideDesk()), narrow: { v: 1, kinds: { data: { slot: "top", open: true } } } }));
    expect(loadLayoutTemplate("narrow")).toBeNull();
    expect(loadLayoutTemplate("wide")).toEqual(templateOf(wideDesk()));
  });

  it("a store from a newer version is read as empty and never overwritten", () => {
    const raw = JSON.stringify({ v: 3, wide: "future" });
    localStorage.setItem(WINDOW_LAYOUT_TEMPLATE_KEY, raw);
    saveLayoutTemplate(wideDesk(), true, "wide");
    expect(localStorage.getItem(WINDOW_LAYOUT_TEMPLATE_KEY)).toBe(raw);
  });

  it("a corrupt store is replaced by the next write", () => {
    localStorage.setItem(WINDOW_LAYOUT_TEMPLATE_KEY, "{not json");
    saveLayoutTemplate(narrowDesk(), true, "narrow");
    expect(stored()).toEqual({ v: 2, narrow: templateOf(narrowDesk()) });
  });
});

describe("applying the template (plan P6)", () => {
  const desk = () => dock(dock(dock(emptyLayout(), "plot:w1", "left"), "data", "bottom"), "tool:cf", "right");

  it("seedWithTemplate: the focused plot is the first plot; the rest of the seed follows the template's kinds", () => {
    const seed = seedFromClassic({ plotWindows: [{ id: "a", z: 1 }, { id: "b", z: 2 }], dockedTool: null });
    const l = seedWithTemplate(seed, templateOf(desk()), "plot:b");
    checkInvariants(l);
    expect(stackOf(l, "left")).toEqual(["plot:b"]);
    expect(stackOf(l, "centre")).toEqual(["plot:a"]); // the seed's place: only the first plot follows the rule
    expect(l.placements.data).toMatchObject({ slot: "bottom", open: true });
    expect(seedWithTemplate(seed, null, "plot:b")).toBe(seed);
  });

  it("toolFirstPlacement: a never-placed tool opens where the template keeps tools; a placed one keeps its own place", () => {
    const t = templateOf(desk());
    const placed = toolFirstPlacement(emptyLayout(), "fft", t);
    expect(placed.placements["tool:fft"]).toMatchObject({ slot: "right", open: false });
    const opened = reopen(placed, "tool:fft");
    checkInvariants(opened);
    expect(stackOf(opened, "right")).toEqual(["tool:fft"]);
    const own = dock(emptyLayout(), "tool:fft", "left");
    expect(toolFirstPlacement(own, "fft", t)).toBe(own);
    expect(toolFirstPlacement(emptyLayout(), "fft", null)).toEqual(emptyLayout());
    const floating = templateOf(float(emptyLayout(), "tool:cf"));
    expect(reopen(toolFirstPlacement(emptyLayout(), "fft", floating), "tool:fft").z).toEqual(["tool:fft"]);
  });

  it("the saved template keeps a kind the new layout has no window of (no tool open after a restart)", () => {
    saveLayoutTemplate(desk());
    saveLayoutTemplate(dock(emptyLayout(), "data", "left")); // no plot, no tool open
    const t = loadLayoutTemplate()!;
    expect(t.kinds.tool).toEqual({ slot: "right", open: true });
    expect(t.kinds.plot).toEqual({ slot: "left", open: true });
    expect(t.kinds.data).toEqual({ slot: "left", open: true });
    expect(mergeTemplate(null, templateOf(emptyLayout()))).toEqual(templateOf(emptyLayout()));
  });

  it("a tiled desk writes no template, at either width class (the tile is the width rule)", async () => {
    const { saveLayoutTemplate: storeSave } = await import("../../store/windowLayoutRun");
    const { tileNarrow } = await import("./narrowTile");
    const tiled = tileNarrow(desk(), ["plot:w1", "data", "tool:cf"]);
    expect(tiled.tiled).toBeDefined();
    for (const width of [1440, 1000]) storeSave(tiled, width);
    expect(localStorage.getItem(WINDOW_LAYOUT_TEMPLATE_KEY)).toBeNull();
    storeSave(desk(), 1440); // the same desk, untiled, is the user's
    expect(loadLayoutTemplate("wide")).toEqual(templateOf(desk()));
    expect(loadLayoutTemplate("narrow")).toBeNull();
  });
});
