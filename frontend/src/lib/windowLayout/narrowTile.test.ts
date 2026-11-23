// D6 "tile below width" (WORKSPACE_LAYOUT_PLAN P5): the pure tile and the
// untile that gives the user's own layout back, never overwritten.
import { describe, expect, it } from "vitest";

import { checkInvariants } from "../../test/windowLayoutInvariants";
import { isNarrow, tileNarrow, untile } from "./narrowTile";
import { close, dock, emptyLayout, float, pruneRefs, stackOf } from "./ops";
import type { WindowLayoutV1 } from "./types";

/** The user's own desk: a plot in the centre, Style and Data right, a floating tool, sized edges. */
const desk = (): WindowLayoutV1 => {
  let l = dock(emptyLayout(), "plot:w1", "centre");
  l = dock(l, "style", "right");
  l = dock(l, "data", "right");
  l = float(l, "tool:curvefit");
  return { ...l, edges: { left: 0, right: 420, bottom: 0 } };
};
const SHOWN = ["plot:w1", "style", "data", "tool:curvefit"] as const;

describe("isNarrow", () => {
  it("only below a set width; 0 keeps floating whatever the width", () => {
    expect(isNarrow(0, 300)).toBe(false);
    expect(isNarrow(1280, 1279)).toBe(true);
    expect(isNarrow(1280, 1280)).toBe(false);
    expect(isNarrow(1280, Number.NaN)).toBe(false);
  });
});

describe("tileNarrow", () => {
  it("tiles every window on screen in the centre grid and keeps the user's layout underneath", () => {
    const l = desk();
    const t = tileNarrow(l, [...SHOWN]);
    expect(stackOf(t, "centre")).toEqual([...SHOWN]);
    expect(t.centre).toBe("grid");
    expect(t.z).toEqual([]);
    expect(t.tiled!.from).toEqual(l);
    checkInvariants(t);
  });

  it("is a no-op (same object) when nothing new is on screen, and with nothing on screen", () => {
    const t = tileNarrow(desk(), [...SHOWN]);
    expect(tileNarrow(t, [...SHOWN])).toBe(t);
    const empty = emptyLayout();
    expect(tileNarrow(empty, [])).toBe(empty);
  });

  it("a window opened while narrow joins the grid; one the user floated while narrow stays floating", () => {
    let t = tileNarrow(desk(), [...SHOWN]);
    t = float(t, "data");
    t = tileNarrow(t, [...SHOWN, "analysis"]);
    expect(t.placements.data!.slot).toBeNull();
    expect(t.placements.analysis).toMatchObject({ slot: "centre", open: true });
    expect(t.tiled!.refs).toContain("analysis");
    checkInvariants(t);
  });
});

describe("untile", () => {
  it("gives back the user's layout exactly, whatever was rearranged while narrow", () => {
    const l = desk();
    let t = tileNarrow(l, [...SHOWN]);
    t = dock(float(t, "style"), "style", "left");
    t = { ...t, edges: { left: 99, right: 99, bottom: 99 }, centre: "row" };
    expect(untile(t)).toEqual(l);
    expect(untile(t).tiled).toBeUndefined();
  });

  it("is the identity on a layout that is not tiled", () => {
    const l = desk();
    expect(untile(l)).toBe(l);
  });

  it("carries content, not arrangement: opened and closed windows, gone plot windows, pins and the Data source", () => {
    const l = desk();
    let t = tileNarrow(l, [...SHOWN]);
    t = close(t, "tool:curvefit");
    t = tileNarrow(t, ["plot:w1", "style", "data", "plot:w2"]); // a new plot window opened while narrow
    t = { ...t, data: { pinned: "d1", follow: "library" }, pins: { analysis: "d2" } };
    t = pruneRefs(t, (r) => r !== "plot:w1"); // plot window w1 was closed while narrow (useLayoutSync)
    const back = untile(t);
    expect(back.placements["plot:w1"]).toBeUndefined();
    expect(back.placements["tool:curvefit"]).toMatchObject({ open: false });
    expect(back.placements["plot:w2"]).toMatchObject({ open: true, slot: "centre" });
    expect(back.placements.style).toEqual(l.placements.style);
    expect(back.placements.data).toEqual(l.placements.data);
    expect(back.edges).toEqual(l.edges);
    expect(back.data).toEqual({ pinned: "d1", follow: "library" });
    expect(back.pins).toEqual({ analysis: "d2" });
    checkInvariants(back);
  });

  it("a window closed before the tile and reopened while narrow comes back where it was saved", () => {
    const l = close(desk(), "data");
    let t = tileNarrow(l, ["plot:w1", "style", "tool:curvefit"]);
    t = tileNarrow(t, ["plot:w1", "style", "tool:curvefit", "data"]);
    expect(t.placements.data).toMatchObject({ open: true, slot: "centre" });
    expect(untile(t).placements.data).toMatchObject({ open: true, slot: "right" });
  });
});
