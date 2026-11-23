// Untrusted layouts fail closed and never throw (WORKSPACE_LAYOUT_PLAN P0
// "sanitize: unknown refs, clamped rects, future v"), plus the ref parser
// that is their trust boundary.
import { describe, expect, it } from "vitest";

import { dock, emptyLayout, float } from "./ops";
import { defaultSlotOf, kindOf, parseRef, plotRef, toolRef } from "./refs";
import { MAX_EDGE_PX, MAX_PLACEMENTS, sanitizeWindowLayout, windowLayoutWarning } from "./sanitize";
import { checkInvariants } from "../../test/windowLayoutInvariants";

const good = () => ({
  v: 1,
  placements: {
    data: { slot: "right", order: 0, share: 1, lastSlot: "right", open: true },
    "plot:win-a-1": { slot: "centre", order: 0, share: 1, lastSlot: "centre", open: true },
    "tool:curvefit": { slot: null, order: 0, share: 1, lastSlot: "bottom", open: true },
  },
  z: ["tool:curvefit"],
  edges: { left: 0, right: 320, bottom: 200 },
  centre: "row",
  data: { pinned: null, follow: "plot" },
});

describe("parseRef", () => {
  it("reads the five ref shapes", () => {
    expect(parseRef("data")).toEqual({ ref: "data", kind: "data", id: null });
    expect(parseRef("style")?.kind).toBe("style");
    expect(parseRef("analysis")?.kind).toBe("analysis");
    expect(parseRef("plot:win-a-1")).toEqual({ ref: "plot:win-a-1", kind: "plot", id: "win-a-1" });
    expect(parseRef("tool:curvefit")).toEqual({ ref: "tool:curvefit", kind: "tool", id: "curvefit" });
  });

  it.each([
    ["an unknown kind", "map:x"], ["an empty id", "plot:"], ["a space in the id", "tool:curve fit"],
    ["a control char", "tool:a\nb"], ["a bare word", "inspector"], ["an over-long id", `plot:${"x".repeat(201)}`],
    ["not a string", 42], ["null", null], ["the prototype key", "__proto__"],
  ])("refuses %s", (_why, raw) => {
    expect(parseRef(raw)).toBeNull();
  });

  it("builds and classifies refs", () => {
    expect(plotRef("w")).toBe("plot:w");
    expect(toolRef("t")).toBe("tool:t");
    expect([kindOf("plot:w"), kindOf("tool:t"), kindOf("data")]).toEqual(["plot", "tool", "data"]);
    expect([defaultSlotOf("plot:w"), defaultSlotOf("tool:t"), defaultSlotOf("style")]).toEqual(["centre", "bottom", "right"]);
  });
});

describe("sanitizeWindowLayout", () => {
  it("keeps a whole, valid layout exactly (round trip of an ops-built layout)", () => {
    const built = float(dock(dock(emptyLayout(), "data", "right"), "style", "right"), "tool:curvefit");
    const r = sanitizeWindowLayout(JSON.parse(JSON.stringify(built)));
    expect(r).toEqual({ layout: built, reason: null, dropped: [] });
  });

  it.each([
    ["a string", "layout", /not an object/],
    ["an array", [], /not an object/],
    ["null", null, /not an object/],
    ["no version", { placements: {} }, /no readable version/],
    ["v0", { ...good(), v: 0 }, /no readable version/],
    ["a string version", { ...good(), v: "1" }, /no readable version/],
    ["no placements", { ...good(), placements: [] }, /no placements/],
  ])("refuses %s as a whole, never throwing", (_why, raw, rx) => {
    const r = sanitizeWindowLayout(raw);
    expect(r.layout).toBeNull();
    expect(r.reason).toMatch(rx);
    expect(windowLayoutWarning(r)).toMatch(/^Window layout not restored: .*; it was reset\.$/);
  });

  it("refuses a future version by name (re-seeded, never half-read)", () => {
    const r = sanitizeWindowLayout({ ...good(), v: 2, placements: { anything: 1 } });
    expect(r.layout).toBeNull();
    expect(r.reason).toBe("the saved window layout is version 2, from a newer Quantized");
  });

  it("refuses a layout naming more windows than a desk can hold", () => {
    const placements = Object.fromEntries(Array.from({ length: MAX_PLACEMENTS + 1 }, (_, i) => [`tool:t${i}`, good().placements["tool:curvefit"]]));
    expect(sanitizeWindowLayout({ ...good(), placements }).layout).toBeNull();
  });

  it("drops unknown kinds and malformed entries with a reason, keeping the rest", () => {
    const raw = good() as Record<string, unknown> & ReturnType<typeof good>;
    const placements: Record<string, unknown> = {
      ...raw.placements,
      "map:x": raw.placements.data,
      style: { ...raw.placements.data, slot: "top" },
      analysis: { ...raw.placements.data, open: "yes" },
      "tool:bad-order": { ...raw.placements.data, order: -1 },
      "tool:bad-share": { ...raw.placements.data, share: 0 },
      "tool:nan": { ...raw.placements.data, share: Number.NaN },
      "tool:not-obj": 7,
    };
    const r = sanitizeWindowLayout({ ...raw, placements });
    expect(r.reason).toBeNull();
    expect(Object.keys(r.layout!.placements).sort()).toEqual(["data", "plot:win-a-1", "tool:curvefit"]);
    expect(r.dropped).toEqual([
      '"map:x": not a window this version knows',
      '"style": unknown slot "top"',
      '"analysis": open is not true/false',
      '"tool:bad-order": order is not a number >= 0',
      '"tool:bad-share": share is not in (0, 1]',
      '"tool:nan": share is not in (0, 1]',
      '"tool:not-obj": not an object',
    ]);
    expect(windowLayoutWarning(r)).toMatch(/^Window layout: 7 windows not restored \("map:x": not a window/);
  });

  it("drops a plot window the project does not have, and a tool this build does not know (when told)", () => {
    const r = sanitizeWindowLayout(good(), { plotIds: new Set(["other"]), toolIds: new Set(["baseline"]) });
    expect(Object.keys(r.layout!.placements)).toEqual(["data"]);
    expect(r.dropped).toEqual(['"plot:win-a-1": that plot window is not in the project', '"tool:curvefit": not a tool this version has']);
    expect(r.layout!.z).toEqual([]);
  });

  it("clamps edges (px, never negative, never past 80 % of the workspace or the hard cap)", () => {
    const r = sanitizeWindowLayout({ ...good(), edges: { left: -5, right: 1e9, bottom: "wide" } }, { viewport: { width: 1000, height: 600 } });
    expect(r.layout!.edges).toEqual({ left: 0, right: 800, bottom: 0 });
    const capped = sanitizeWindowLayout({ ...good(), edges: { left: 1e9, right: 10.6, bottom: 1e9 } });
    expect(capped.layout!.edges).toEqual({ left: MAX_EDGE_PX, right: 11, bottom: MAX_EDGE_PX });
  });

  it("repacks orders and shares, rebuilds z from the open floating windows, and fixes a docked lastSlot", () => {
    const raw = good();
    const placements = {
      ...raw.placements,
      style: { slot: "right", order: 7, share: 0.25, lastSlot: null, open: true },
      "tool:b": { slot: null, order: 0, share: 1, lastSlot: null, open: true },
      "tool:closed": { slot: null, order: 0, share: 1, lastSlot: null, open: false },
    };
    const r = sanitizeWindowLayout({ ...raw, placements, z: ["data", "tool:closed", "ghost", "tool:curvefit", "tool:curvefit", 3] });
    const l = r.layout!;
    checkInvariants(l);
    expect(l.placements.style).toMatchObject({ order: 1, share: 0.2, lastSlot: "right" });
    expect(l.placements.data!.share).toBeCloseTo(0.8);
    expect(l.z).toEqual(["tool:curvefit", "tool:b"]);
  });

  it("defaults the centre mode and Data follow; clears a pin to a dataset that is gone", () => {
    const r = sanitizeWindowLayout({ ...good(), centre: "mosaic", data: { pinned: "ds-9", follow: "nowhere" } }, { datasetIds: new Set(["ds-1"]) });
    expect(r.layout!.centre).toBe("row");
    expect(r.layout!.data).toEqual({ pinned: null, follow: "plot" });
    const kept = sanitizeWindowLayout({ ...good(), centre: "grid", data: { pinned: "ds-1", follow: "library" } }, { datasetIds: new Set(["ds-1"]) });
    expect(kept.layout!.centre).toBe("grid");
    expect(kept.layout!.data).toEqual({ pinned: "ds-1", follow: "library" });
    expect(windowLayoutWarning(kept)).toBeNull();
  });
});
