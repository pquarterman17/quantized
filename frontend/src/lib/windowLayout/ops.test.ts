// The pure layout operations (WORKSPACE_LAYOUT_PLAN P0 op tables): dock,
// toggle-to-float, stack order, renormalised shares, close/reopen remembers,
// tile, plotBesideData, dockAll, floatAll. Every result is also checked
// against the model's invariants, and inputs are frozen to prove purity.
import { describe, expect, it } from "vitest";

import {
  close, dock, dockAll, emptyLayout, float, floatAll, focusWindow, move, plotBesideData, pruneRefs,
  reopen, stackOf, tileAll, toggleDock,
} from "./ops";
import { defaultSlotOf } from "./refs";
import { SLOTS, type WindowLayoutV1, type WindowRef } from "./types";
import { checkInvariants } from "../../test/windowLayoutInvariants";

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

/** Run `steps` from an empty layout, freezing every intermediate result. */
function run(...steps: ((l: WindowLayoutV1) => WindowLayoutV1)[]): WindowLayoutV1 {
  let l = deepFreeze(emptyLayout());
  for (const step of steps) {
    l = deepFreeze(step(l));
    checkInvariants(l);
  }
  return l;
}

const P1: WindowRef = "plot:win-a-1";
const P2: WindowRef = "plot:win-b-2";
const CF: WindowRef = "tool:curvefit";
const ST: WindowRef = "tool:statistics";
const shares = (l: WindowLayoutV1, refs: WindowRef[]) => refs.map((r) => l.placements[r]!.share);

describe("dock", () => {
  it.each([["left"], ["right"], ["bottom"], ["centre"]] as const)("docks a never-placed window to %s, open, alone, share 1", (slot) => {
    const l = run((x) => dock(x, "data", slot));
    expect(l.placements.data).toEqual({ slot, order: 0, share: 1, lastSlot: slot, open: true });
    expect(stackOf(l, slot)).toEqual(["data"]);
  });

  it("stacks windows on one edge in docking order; a newcomer takes 1/n and the rest shrink in proportion", () => {
    const l = run((x) => dock(x, "data", "right"), (x) => dock(x, "style", "right"), (x) => dock(x, "analysis", "right"));
    expect(stackOf(l, "right")).toEqual(["data", "style", "analysis"]);
    const [a, b, c] = shares(l, ["data", "style", "analysis"]);
    expect(c).toBeCloseTo(1 / 3);
    expect(a).toBeCloseTo(1 / 3); // 0.5 * 2/3
    expect(b).toBeCloseTo(1 / 3);
  });

  it("keeps an uneven split in proportion when a newcomer joins", () => {
    let l = run((x) => dock(x, "data", "right"), (x) => dock(x, "style", "right"));
    l = { ...l, placements: { ...l.placements, data: { ...l.placements.data!, share: 0.75 }, style: { ...l.placements.style!, share: 0.25 } } };
    l = dock(l, "analysis", "right");
    checkInvariants(l);
    expect(shares(l, ["data", "style", "analysis"]).map((s) => +s.toFixed(4))).toEqual([0.5, 0.1667, 0.3333]);
  });

  it("inserts at an index, clamped to the stack", () => {
    const l = run((x) => dock(x, "data", "right"), (x) => dock(x, "style", "right"), (x) => dock(x, "analysis", "right", 0), (x) => dock(x, CF, "right", 99));
    expect(stackOf(l, "right")).toEqual(["analysis", "data", "style", CF]);
  });

  it("moving a window between slots repacks the slot it left", () => {
    const l = run((x) => dock(x, "data", "right"), (x) => dock(x, "style", "right"), (x) => dock(x, "data", "bottom"));
    expect(stackOf(l, "right")).toEqual(["style"]);
    expect(l.placements.style!.share).toBe(1);
    expect(stackOf(l, "bottom")).toEqual(["data"]);
  });

  it("several centre windows share it side by side", () => {
    const l = run((x) => dock(x, P1, "centre"), (x) => dock(x, "data", "centre"));
    expect(stackOf(l, "centre")).toEqual([P1, "data"]);
    expect(shares(l, [P1, "data"])).toEqual([0.5, 0.5]);
  });

  it("docking a floating window takes it out of the floating stack", () => {
    const l = run((x) => float(x, CF), (x) => float(x, ST), (x) => dock(x, CF, "bottom"));
    expect(l.z).toEqual([ST]);
  });
});

describe("toggleDock (D2: pressing the pressed dock button floats)", () => {
  it("docks, then floats on the same button, then docks again where it was", () => {
    const docked = run((x) => toggleDock(x, CF, "right"));
    expect(docked.placements[CF]!.slot).toBe("right");
    const floated = run((x) => toggleDock(x, CF, "right"), (x) => toggleDock(x, CF, "right"));
    expect(floated.placements[CF]).toMatchObject({ slot: null, lastSlot: "right", open: true });
    expect(floated.z).toEqual([CF]);
  });

  it("a different slot's button moves it instead of floating", () => {
    const l = run((x) => toggleDock(x, CF, "right"), (x) => toggleDock(x, CF, "bottom"));
    expect(l.placements[CF]!.slot).toBe("bottom");
  });
});

describe("float", () => {
  it("brings a floating window to the front and remembers its last slot", () => {
    const l = run((x) => dock(x, CF, "bottom"), (x) => float(x, ST), (x) => float(x, CF));
    expect(l.z).toEqual([ST, CF]);
    expect(l.placements[CF]!.lastSlot).toBe("bottom");
    expect(stackOf(l, "bottom")).toEqual([]);
  });

  it("is a no-op (same object) for the front floating window", () => {
    const l = run((x) => float(x, CF));
    expect(float(l, CF)).toBe(l);
  });
});

describe("move", () => {
  it("reorders a docked window within its slot, keeping shares", () => {
    let l = run((x) => dock(x, "data", "right"), (x) => dock(x, "style", "right"), (x) => dock(x, "analysis", "right"));
    const before = shares(l, ["data", "style", "analysis"]);
    l = move(l, "analysis", 0);
    checkInvariants(l);
    expect(stackOf(l, "right")).toEqual(["analysis", "data", "style"]);
    expect(shares(l, ["data", "style", "analysis"])).toEqual(before);
  });

  it("is a no-op for a floating or closed window, and for its own index", () => {
    const l = run((x) => float(x, CF), (x) => dock(x, "data", "right"));
    expect(move(l, CF, 0)).toBe(l);
    expect(move(l, "style", 0)).toBe(l);
    expect(move(l, "data", 0)).toBe(l);
  });
});

describe("close / reopen", () => {
  it("close keeps the placement; reopen restores slot and position", () => {
    const l = run(
      (x) => dock(x, "data", "right"), (x) => dock(x, "style", "right"), (x) => dock(x, "analysis", "right"),
      (x) => close(x, "style"),
    );
    expect(stackOf(l, "right")).toEqual(["data", "analysis"]);
    expect(l.placements.style).toMatchObject({ slot: "right", order: 1, open: false });
    const back = run((x) => x, () => reopen(l, "style"));
    expect(stackOf(back, "right")).toEqual(["data", "style", "analysis"]);
  });

  it("a floating window reopens floating, in front", () => {
    const l = run((x) => float(x, CF), (x) => float(x, ST), (x) => close(x, CF), (x) => reopen(x, CF));
    expect(l.placements[CF]!.slot).toBeNull();
    expect(l.z).toEqual([ST, CF]);
  });

  it("D7: reopening an OPEN window only focuses it (one window per tool)", () => {
    const l = run((x) => float(x, CF), (x) => float(x, ST));
    const again = reopen(l, CF);
    expect(again.z).toEqual([ST, CF]);
    expect(Object.keys(again.placements)).toEqual(Object.keys(l.placements));
    const docked = run((x) => dock(x, CF, "bottom"));
    expect(reopen(docked, CF)).toBe(docked);
  });

  it("a never-placed window opens in its default slot: plot centre, tool bottom (Curve Fit right, OG15), singletons right", () => {
    const l = run((x) => reopen(x, P1), (x) => reopen(x, ST), (x) => reopen(x, "analysis"), (x) => reopen(x, CF));
    expect([l.placements[P1]!.slot, l.placements[ST]!.slot, l.placements.analysis!.slot, l.placements[CF]!.slot]).toEqual(["centre", "bottom", "right", "right"]);
    expect(stackOf(l, "right")).toEqual(["analysis", CF]); // after the windows already in the column
    expect(defaultSlotOf(CF)).toBe("right");
    expect(defaultSlotOf("tool:peaks")).toBe("bottom");
  });

  it("closing a closed or unknown window is a no-op", () => {
    const l = run((x) => dock(x, "data", "right"), (x) => close(x, "data"));
    expect(close(l, "data")).toBe(l);
    expect(close(l, "style")).toBe(l);
  });

  it("closing a floating window removes it from z", () => {
    const l = run((x) => float(x, CF), (x) => close(x, CF));
    expect(l.z).toEqual([]);
  });
});

describe("focusWindow", () => {
  it("raises a floating window; leaves docked/closed ones alone", () => {
    const l = run((x) => float(x, CF), (x) => float(x, ST), (x) => dock(x, "data", "right"));
    expect(focusWindow(l, CF).z).toEqual([ST, CF]);
    expect(focusWindow(l, "data")).toBe(l);
    expect(focusWindow(l, "style")).toBe(l);
  });
});

describe("arranging (D4)", () => {
  const desk = (): WindowLayoutV1 =>
    run(
      (x) => float(x, P1), (x) => float(x, P2), (x) => dock(x, "data", "left"), (x) => dock(x, "style", "right"),
      (x) => float(x, CF), (x) => dock(x, ST, "right"), (x) => dock(x, "analysis", "bottom"), (x) => close(x, "analysis"),
    );

  it("tileAll puts the chosen windows in the centre grid, equal shares, in the given order", () => {
    const l = run((x) => x, () => tileAll(desk(), [P2, P1, "data", P2]));
    expect(l.centre).toBe("grid");
    expect(stackOf(l, "centre")).toEqual([P2, P1, "data"]);
    expect(shares(l, [P2, P1, "data"]).every((s) => Math.abs(s - 1 / 3) < 1e-12)).toBe(true);
    expect(stackOf(l, "left")).toEqual([]);
    expect(l.z).toEqual([CF]);
    expect(tileAll(desk(), []).centre).toBe("row"); // nothing chosen: unchanged
  });

  it("plotBesideData puts the plot then Data in the centre row; everything else stays", () => {
    const base = desk();
    const l = run((x) => x, () => plotBesideData(base, P1));
    expect(l.centre).toBe("row");
    expect(stackOf(l, "centre")).toEqual([P1, "data"]);
    expect(shares(l, [P1, "data"])).toEqual([0.5, 0.5]);
    expect(stackOf(l, "right")).toEqual(stackOf(base, "right"));
    expect(l.z).toEqual([P2, CF]);
    expect(plotBesideData(base, "style")).toBe(base); // not a plot: refused
  });

  it("dockAll: focused plot centre, Data/Style then Curve Fit (OG15) right, other open tools bottom; closed stay closed", () => {
    const l = run((x) => x, () => dockAll(desk(), P1));
    expect(stackOf(l, "centre")).toEqual([P1]);
    expect(stackOf(l, "right")).toEqual(["data", "style", CF]);
    expect(stackOf(l, "bottom")).toEqual([ST]);
    expect(l.placements.analysis!.open).toBe(false);
    expect(l.z).toEqual([P2]); // another plot window stays where it was
  });

  it("dockAll with no focused plot leaves the plots alone", () => {
    const l = dockAll(desk(), null);
    checkInvariants(l);
    expect(l.z).toEqual([P1, P2]);
  });

  it("floatAll floats every docked window in front, remembering each slot", () => {
    const base = desk();
    const l = run((x) => x, () => floatAll(base));
    for (const s of SLOTS) expect(stackOf(l, s)).toEqual([]);
    expect(l.z).toEqual([P1, P2, CF, "data", "style", ST]);
    expect(l.placements.data!.lastSlot).toBe("left");
    expect(l.placements[ST]!.lastSlot).toBe("right");
    expect(floatAll(l)).toBe(l);
    // Dock (reopen after a close) sends it back to its last slot.
    const back = reopen(close(l, "data"), "data");
    expect(back.placements.data!.slot).toBeNull(); // it was floating when closed
    expect(dock(l, "data", l.placements.data!.lastSlot!).placements.data!.slot).toBe("left");
  });
});

describe("pruneRefs", () => {
  it("forgets rejected windows and repacks their slots", () => {
    const l = run((x) => dock(x, P1, "centre"), (x) => dock(x, P2, "centre"), (x) => float(x, CF), (x) => pruneRefs(x, (r) => r !== P1 && r !== CF));
    expect(Object.keys(l.placements)).toEqual([P2]);
    expect(l.placements[P2]!.share).toBe(1);
    const same = pruneRefs(l, () => true);
    expect(same).toBe(l);
  });
});
