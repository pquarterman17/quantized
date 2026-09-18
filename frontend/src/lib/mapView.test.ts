// Audit P2.8, review round 2 — the pure map-view unit contracts the `.dwk`
// suite (lib/workspaceMapView.test.ts) cannot see through a JSON round trip:
// object IDENTITY on the save path, the sanitizer's trust-boundary bounds, the
// deep freeze, and the colormap-name list that has no compiler tying it to the
// real colormap table.

import { describe, expect, it } from "vitest";

import { COLORMAPS } from "./colormap";
import {
  COLORMAP_NAMES,
  DEFAULT_MAP_VIEW,
  isDefaultMapView,
  isDefaultMapViews,
  mapViewFor,
  sanitizeMapView,
  sanitizeMapViews,
  serializeMapViews,
  type MapViewMap,
  type MapViewState,
} from "./mapView";

const VIEW: MapViewState = {
  colormap: "magma",
  logZ: true,
  colorLimits: [1, 2],
  slices: [
    { id: "s1", kind: "h", a: { x: 3, y: 4 }, width: 0.2, space: "angular" },
    { id: "s2", kind: "seg", a: { x: 1, y: 1 }, b: { x: 2, y: 2 }, width: 0, space: "q" },
  ],
  annotations: [{ id: "a1", x: 5, y: 6, text: "peak", space: "angular" }],
};

describe("serializeMapViews", () => {
  // Review round 2, finding 6: the first cut "pinned" this through
  // `JSON.parse(serializeWorkspace(...))`, which mints fresh objects no matter
  // what the serializer does — the assertion could not fail. Assert on the
  // unit that actually holds the contract.
  it("does NOT alias the live store objects", () => {
    const live: MapViewMap = { a: VIEW };
    const out = serializeMapViews(live);
    expect(out.a).toEqual(VIEW);
    expect(out.a).not.toBe(VIEW);
    expect(out.a!.slices).not.toBe(VIEW.slices);
    expect(out.a!.slices[0]).not.toBe(VIEW.slices[0]);
    expect(out.a!.slices[0]!.a).not.toBe(VIEW.slices[0]!.a);
    expect(out.a!.slices[1]!.b).not.toBe(VIEW.slices[1]!.b);
    expect(out.a!.annotations[0]).not.toBe(VIEW.annotations[0]);
    expect(out.a!.colorLimits).not.toBe(VIEW.colorLimits);
  });

  it("drops entries that record nothing", () => {
    expect(serializeMapViews({ a: DEFAULT_MAP_VIEW, b: VIEW })).toEqual({ b: VIEW });
  });
});

describe("the default view", () => {
  // Review round 2, finding 13: the freeze was shallow while the comment
  // claimed a mutating caller could not corrupt later resets — and `.slices`
  // / `.annotations` are exactly what such a caller would `.push` to.
  it("is DEEPLY frozen, arrays included", () => {
    expect(Object.isFrozen(DEFAULT_MAP_VIEW)).toBe(true);
    expect(Object.isFrozen(DEFAULT_MAP_VIEW.slices)).toBe(true);
    expect(Object.isFrozen(DEFAULT_MAP_VIEW.annotations)).toBe(true);
  });

  // Review round 2, finding 2: the first cut required `datasetId === null`, so
  // merely OPENING a map made an all-default view "non-default", dirtied the
  // project and wrote a field recording no decision.
  it("is default regardless of which map is looking at it", () => {
    expect(isDefaultMapView(DEFAULT_MAP_VIEW)).toBe(true);
    expect(isDefaultMapViews({ a: DEFAULT_MAP_VIEW, b: DEFAULT_MAP_VIEW })).toBe(true);
    expect(isDefaultMapViews({ a: VIEW })).toBe(false);
  });

  it("is what an absent entry reads as", () => {
    expect(mapViewFor({}, "ds-1")).toBe(DEFAULT_MAP_VIEW);
    expect(mapViewFor({ a: VIEW }, null)).toBe(DEFAULT_MAP_VIEW);
    expect(mapViewFor({ a: VIEW }, "a")).toBe(VIEW);
  });
});

describe("COLORMAP_NAMES", () => {
  // Review round 2, finding 11: this list is duplicated from lib/colormap's
  // COLORMAPS (a value import would drag the colour LUTs into the eager
  // chunk). Add a fifth colormap and, without this pin, every saved `.dwk`
  // naming it silently reverts to viridis on reopen.
  it("is exactly the real colormap table's keys", () => {
    expect([...COLORMAP_NAMES].sort()).toEqual(Object.keys(COLORMAPS).sort());
  });

  it("an unknown colormap degrades to the default", () => {
    expect(sanitizeMapView({ colormap: "inferno" }).colormap).toBe("viridis");
    expect(sanitizeMapView({ colormap: "rdbu" }).colormap).toBe("rdbu");
  });
});

describe("sanitizeMapView bounds a hand-edited document", () => {
  // Review round 2, finding 10: the first cut bounded nothing — 5,000 slices
  // and a 50,000-character label were kept verbatim and rendered.
  it("caps the number of slices and annotations", () => {
    const slices = Array.from({ length: 5000 }, (_, i) => ({
      id: `s${i}`,
      kind: "h",
      a: { x: 1, y: 2 },
      width: 0,
      space: "angular",
    }));
    const annotations = Array.from({ length: 5000 }, (_, i) => ({
      id: `a${i}`,
      x: 1,
      y: 2,
      text: "t",
      space: null,
    }));
    const v = sanitizeMapView({ slices, annotations });
    expect(v.slices).toHaveLength(200);
    expect(v.annotations).toHaveLength(200);
  });

  it("caps a label's length", () => {
    const v = sanitizeMapView({
      annotations: [{ id: "a", x: 1, y: 2, text: "x".repeat(50_000), space: null }],
    });
    expect(v.annotations[0]!.text).toHaveLength(200);
  });

  it("rejects a negative width and keeps a zero one (the toolbar's own default)", () => {
    const mk = (width: number) => ({
      id: "s",
      kind: "h" as const,
      a: { x: 1, y: 2 },
      width,
      space: "angular" as const,
    });
    expect(sanitizeMapView({ slices: [mk(-3)] }).slices).toEqual([]);
    expect(sanitizeMapView({ slices: [mk(0)] }).slices).toHaveLength(1);
  });

  // Review round 2, finding 9: an unknown space was COERCED to angular, so a
  // hand-edited or future-space slice reappeared drawn over the wrong axes.
  it("drops a slice whose space is neither angular nor q", () => {
    const mk = (space: unknown) => ({ id: "s", kind: "h", a: { x: 1, y: 2 }, width: 0, space });
    expect(sanitizeMapView({ slices: [mk("hkl")] }).slices).toEqual([]);
    expect(sanitizeMapView({ slices: [mk(undefined)] }).slices).toEqual([]);
    expect(sanitizeMapView({ slices: [mk("q")] }).slices).toHaveLength(1);
  });
});

describe("sanitizeMapViews", () => {
  it("drops entries for datasets this load did not keep", () => {
    const raw = { a: VIEW, gone: VIEW };
    expect(Object.keys(sanitizeMapViews(raw, new Set(["a"])))).toEqual(["a"]);
    expect(Object.keys(sanitizeMapViews(raw))).toEqual(["a", "gone"]);
  });

  it("never throws on rubbish", () => {
    expect(sanitizeMapViews(null)).toEqual({});
    expect(sanitizeMapViews(42)).toEqual({});
    expect(sanitizeMapViews([VIEW])).toEqual({});
    expect(sanitizeMapViews({ a: "not a view" })).toEqual({});
  });

  // Review round 3, finding 4: the first-cut migration was detected with a
  // bare `"datasetId" in o`, which also fired for a KEYED record holding a
  // dataset whose id happens to be the string "datasetId" — and then threw
  // away every OTHER dataset's entry with it, contradicting this module's
  // "drop the malformed one, keep the rest" contract.
  describe("legacy detection only fires for the single-object form (round 3, finding 4)", () => {
    it("a keyed record with a `datasetId` KEY keeps that entry and all the others", () => {
      expect(sanitizeMapViews({ datasetId: VIEW })).toEqual({ datasetId: VIEW });
      expect(sanitizeMapViews({ a: VIEW, datasetId: VIEW })).toEqual({ a: VIEW, datasetId: VIEW });
    });

    it("the first cut's single object still migrates — it wrote a STRING there", () => {
      expect(sanitizeMapViews({ datasetId: "a", ...VIEW })).toEqual({ a: VIEW });
    });

    it("a legacy object bound to no dataset is still dropped", () => {
      expect(sanitizeMapViews({ datasetId: null, ...VIEW })).toEqual({});
    });
  });

  // Review round 3, finding 7: the other three trust-boundary caps
  // (slices/annotations/label chars) are unconditional, but the ENTRY count
  // was bounded only by `liveDatasetIds` — a property of the callers, not of
  // this function, which is the documented boundary for a hand-edited `.dwk`.
  it("caps the number of dataset entries even with no live-id filter (round 3, finding 7)", () => {
    const raw: Record<string, MapViewState> = {};
    for (let i = 0; i < 400; i++) raw[`ds-${i}`] = VIEW;
    expect(Object.keys(sanitizeMapViews(raw))).toHaveLength(256);
    // The filtered path is unaffected: it was already bounded by the ids.
    expect(Object.keys(sanitizeMapViews(raw, new Set(["ds-7"])))).toEqual(["ds-7"]);
  });

  it("the 256 cap follows JS's own key order, not file order, for an integer-like key (round 4, finding 6)", () => {
    const raw: Record<string, MapViewState> = {};
    for (let i = 0; i < 300; i++) raw[`ds-${i}`] = VIEW;
    // Ordinary ids (`ds-<n>`) are not integer-like, so insertion order holds
    // and the cap keeps exactly the first 256 written.
    const ordinary = Object.keys(sanitizeMapViews(raw));
    expect(ordinary).toHaveLength(256);
    expect(ordinary[0]).toBe("ds-0");
    expect(ordinary[255]).toBe("ds-255");
    expect(ordinary).not.toContain("ds-256");

    // A single INTEGER-LIKE key, written LAST in the object, is moved to the
    // FRONT by the JS engine's own property order (ahead of every non-integer
    // key) — before `sanitizeMapViews` ever runs. It is therefore among the
    // survivors even though it is textually last, which is the documented,
    // deterministic-by-key-order behaviour, not a bug this function can fix.
    const withIntegerKey: Record<string, MapViewState> = { ...raw, "9999": VIEW };
    const kept = Object.keys(sanitizeMapViews(withIntegerKey));
    expect(kept).toHaveLength(256);
    expect(kept[0]).toBe("9999");
  });
});
