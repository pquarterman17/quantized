// Reset layout (WORKSPACE_LAYOUT_PLAN P6): the default seed for this screen
// width, keeping what is content rather than arrangement.
import { describe, expect, it } from "vitest";

import { checkInvariants } from "../../test/windowLayoutInvariants";
import { tileNarrow } from "./narrowTile";
import { close, dock, float, reopen, stackOf } from "./ops";
import { setPin } from "./pins";
import { resetLayout } from "./reset";
import { seedFromClassic } from "./seed";
import type { WindowLayoutV1 } from "./types";

const plots = [{ id: "w1", z: 1 }];
const wide = () => seedFromClassic({ plotWindows: plots, dockedTool: null });
const small = () => seedFromClassic({ plotWindows: plots, dockedTool: null }, { small: true });
/** A desk the user rearranged: Data left and open, Style floating, a tool on the right, odd edges, a grid. */
const mine = (): WindowLayoutV1 => ({
  ...dock(float(dock(dock(wide(), "data", "left"), "tool:curvefit", "right"), "style"), "plot:w1", "centre"),
  edges: { left: 333, right: 222, bottom: 111 },
  centre: "grid",
  data: { pinned: "d1", follow: "library" },
});

describe("resetLayout", () => {
  it("wide: every window goes back to the seed's place; open windows stay open", () => {
    const out = resetLayout({ seed: wide(), live: mine(), openTools: ["curvefit"], small: false });
    checkInvariants(out);
    expect(stackOf(out, "right")).toEqual(["data", "style", "tool:curvefit"]); // Data reopens at the head, where the seed remembers it; Curve Fit (OG15) joins after Style
    expect(stackOf(out, "bottom")).toEqual([]); // OG15: Curve Fit docks right, after the seed's windows
    expect(stackOf(out, "right")).toEqual(["data", "style", "tool:curvefit"]);
    // The seed floats a lone, unmaximized plot (classic's place); a reset puts it where a new project's plot goes.
    expect(stackOf(out, "centre")).toEqual(["plot:w1"]);
    expect(out.z).toEqual([]);
    expect(out.edges).toEqual({ left: 0, right: 0, bottom: 0 });
    expect(out.centre).toBe("row");
  });

  it("M1: a floated plot (Float all) goes back to the centre; more plots tile the centre row; none stays floating", () => {
    const two = seedFromClassic({ plotWindows: [{ id: "w1", z: 1, winState: "normal" }, { id: "w2", z: 2, winState: "minimized" }], dockedTool: null });
    const floated = float(float(mine(), "plot:w1"), "plot:w2");
    expect(floated.z).toContain("plot:w1");
    const out = resetLayout({ seed: two, live: floated, openTools: [], small: false, minimized: ["plot:w2"] });
    checkInvariants(out);
    expect(stackOf(out, "centre")).toEqual(["plot:w1"]);
    expect(out.z).toEqual(["plot:w2"]); // a minimized plot sits in the strip: it stays where the seed has it
    const three = seedFromClassic({ plotWindows: [{ id: "w1", z: 1, winState: "normal" }, { id: "w3", z: 3, winState: "minimized" }], dockedTool: null });
    const both = resetLayout({ seed: three, live: float(float(mine(), "plot:w1"), "plot:w3"), openTools: [], small: false });
    expect(stackOf(both, "centre")).toEqual(["plot:w1", "plot:w3"]); // not minimized: both tile the centre row
    expect(both.centre).toBe("row");
  });

  it("M1: a plot the seed already docks (two visible plots gather in a grid) is left as the seed has it", () => {
    const grid = seedFromClassic({ plotWindows: [{ id: "w1", z: 1 }, { id: "w2", z: 2 }], dockedTool: null });
    const out = resetLayout({ seed: grid, live: float(mine(), "plot:w1"), openTools: [], small: false });
    expect(stackOf(out, "centre")).toEqual(["plot:w1", "plot:w2"]);
    expect(out.centre).toBe("grid");
  });

  it("keeps the Data follow setting and the pins; drops nothing else of the old arrangement", () => {
    const live = setPin(mine(), "tool:curvefit", "d2");
    const out = resetLayout({ seed: wide(), live, openTools: ["curvefit"], small: false });
    expect(out.data).toEqual({ pinned: "d1", follow: "library" });
    expect(out.pins).toEqual({ "tool:curvefit": "d2" });
    expect(resetLayout({ seed: wide(), live: mine(), openTools: [], small: false }).pins).toBeUndefined();
  });

  it("a closed, pinned tool keeps its pin and a closed placement at its default, so a save keeps the pin", () => {
    const live = setPin(close(mine(), "tool:curvefit"), "tool:curvefit", "d2");
    const out = resetLayout({ seed: wide(), live, openTools: [], small: false });
    checkInvariants(out);
    expect(out.pins).toEqual({ "tool:curvefit": "d2" });
    expect(out.placements["tool:curvefit"]).toEqual({ slot: "right", order: 0, share: 1, lastSlot: "right", open: false }); // OG15
    expect(stackOf(reopen(out, "tool:curvefit"), "right")).toContain("tool:curvefit");
    expect(stackOf(reopen(out, "tool:curvefit"), "bottom")).toEqual([]);
  });

  it("closed windows stay closed (Data, Analysis, Style), and a closed tool gets no window", () => {
    const live = close(close(mine(), "data"), "style");
    const out = resetLayout({ seed: wide(), live, openTools: [], small: false });
    checkInvariants(out);
    expect(out.placements.data).toMatchObject({ open: false, slot: "right" });
    expect(out.placements.analysis!.open).toBe(false);
    expect(out.placements.style).toMatchObject({ open: false, slot: "right" });
    expect(out.placements["tool:curvefit"]).toBeUndefined();
  });

  it("small screen (D6): the floating seed; open Data and tools float in front", () => {
    const out = resetLayout({ seed: small(), live: mine(), openTools: ["curvefit"], small: true });
    checkInvariants(out);
    for (const slot of ["left", "centre", "right", "bottom"] as const) expect(stackOf(out, slot)).toEqual([]);
    expect(out.z).toEqual(["plot:w1", "style", "data", "tool:curvefit"]); // the plot floats too: D6, nothing docks
  });

  it("a narrow-screen tile is never kept: the reset is the user's new own layout (the width rule tiles it again)", () => {
    const tiled = tileNarrow(mine(), ["plot:w1", "data", "tool:curvefit"]);
    expect(tiled.tiled).toBeDefined();
    const out = resetLayout({ seed: wide(), live: tiled, openTools: ["curvefit"], small: false });
    expect(out.tiled).toBeUndefined();
    expect(out.placements.data).toMatchObject({ open: true, slot: "right" });
    expect(out.data).toEqual(mine().data);
  });
});
