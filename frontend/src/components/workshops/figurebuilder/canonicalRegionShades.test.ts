import { describe, expect, it, vi } from "vitest";

import type { RegionShade } from "../../../lib/types";
import {
  appendRegionShade,
  deriveRegionShadeRows,
  patchRegionShadeList,
  regionShadeBindings,
  removeRegionShadeFromList,
} from "./canonicalRegionShades";

const shade = (id: string, over: Partial<Omit<RegionShade, "id">> = {}): RegionShade => ({
  id,
  x1: 0,
  y1: 0,
  x2: 1,
  y2: 1,
  fill: "#336699",
  ...over,
});

describe("deriveRegionShadeRows", () => {
  it("numbers labels FLAT by draw order, not scoped by any field", () => {
    const rows = deriveRegionShadeRows([shade("a"), shade("b", { axis: 1 }), shade("c")]);
    expect(rows.map((row) => row.label)).toEqual([
      "Region shade 1",
      "Region shade 2",
      "Region shade 3",
    ]);
  });

  it("keeps the draft's own array order and carries id through", () => {
    expect(deriveRegionShadeRows([shade("z"), shade("a")])).toEqual([
      { id: "z", label: "Region shade 1", short: "Shade 1" },
      { id: "a", label: "Region shade 2", short: "Shade 2" },
    ]);
  });

  it("is empty for an empty draft", () => {
    expect(deriveRegionShadeRows([])).toEqual([]);
  });
});

describe("patchRegionShadeList", () => {
  it("merges into only the matching shade", () => {
    const shades = [shade("a"), shade("b")];
    expect(patchRegionShadeList(shades, "b", { fill: "#ff0000" })).toEqual([
      shade("a"),
      shade("b", { fill: "#ff0000" }),
    ]);
  });

  it("returns every non-matching shade by reference (no needless re-render churn)", () => {
    const untouched = shade("a");
    const next = patchRegionShadeList([untouched, shade("b")], "b", { fill: "#ff0000" });
    expect(next[0]).toBe(untouched);
  });

  it("is a no-op for an unknown id", () => {
    const shades = [shade("a")];
    expect(patchRegionShadeList(shades, "nope", { fill: "#000000" })).toEqual(shades);
  });

  it("can set axis to the explicit primary value 0, not just remove it", () => {
    const shades = [shade("a", { axis: 1 })];
    expect(patchRegionShadeList(shades, "a", { axis: 0 })[0].axis).toBe(0);
  });
});

describe("removeRegionShadeFromList", () => {
  it("drops only the matching shade", () => {
    expect(removeRegionShadeFromList([shade("a"), shade("b")], "a")).toEqual([shade("b")]);
  });

  it("is a no-op for an unknown id", () => {
    const shades = [shade("a")];
    expect(removeRegionShadeFromList(shades, "nope")).toEqual(shades);
  });
});

describe("appendRegionShade", () => {
  it("mints a draft-namespaced id that cannot collide with the store's shade- ids", () => {
    expect(appendRegionShade([shade("shade-1")], { x1: 0, y1: 0, x2: 1, y2: 1, fill: "#123456" })).toEqual([
      shade("shade-1"),
      { id: "pshade-1", x1: 0, y1: 0, x2: 1, y2: 1, fill: "#123456" },
    ]);
  });

  it("continues past the highest existing draft id, so remove-then-add never reuses one", () => {
    const one = appendRegionShade([], { x1: 0, y1: 0, x2: 1, y2: 1, fill: "#123456" });
    const two = appendRegionShade(one, { x1: 0, y1: 0, x2: 1, y2: 1, fill: "#123456" });
    const after = removeRegionShadeFromList(two, "pshade-1");
    expect(appendRegionShade(after, { x1: 0, y1: 0, x2: 1, y2: 1, fill: "#123456" }).map((s) => s.id)).toEqual([
      "pshade-2",
      "pshade-3",
    ]);
  });

  it("ignores a malformed draft-prefixed id instead of producing NaN", () => {
    const shades = [{ ...shade("pshade-oops") }];
    expect(appendRegionShade(shades, { x1: 0, y1: 0, x2: 1, y2: 1, fill: "#123456" }).at(-1)?.id).toBe(
      "pshade-1",
    );
  });

  it("rejects a shade with any non-finite coordinate rather than appending an unrenderable one", () => {
    expect(appendRegionShade([], { x1: Number.NaN, y1: 0, x2: 1, y2: 1, fill: "#123456" })).toEqual([]);
    expect(
      appendRegionShade([], { x1: 0, y1: 0, x2: Number.POSITIVE_INFINITY, y2: 1, fill: "#123456" }),
    ).toEqual([]);
  });

  it("does not mutate the input list", () => {
    const shades: RegionShade[] = [shade("a")];
    appendRegionShade(shades, { x1: 0, y1: 0, x2: 1, y2: 1, fill: "#123456" });
    expect(shades).toHaveLength(1);
  });

  it("carries axis: 1 through when supplied", () => {
    const out = appendRegionShade([], { x1: 0, y1: 0, x2: 1, y2: 1, fill: "#123456", axis: 1 });
    expect(out[0].axis).toBe(1);
  });
});

describe("regionShadeBindings", () => {
  it("passes the supplied list straight through", () => {
    const shades = [shade("a")];
    expect(regionShadeBindings(shades, vi.fn()).regionShades).toBe(shades);
  });

  it("patchRegionShade routes a patch through setCanonicalView using patchRegionShadeList", () => {
    const shades = [shade("a"), shade("b")];
    const setCanonicalView = vi.fn();
    regionShadeBindings(shades, setCanonicalView).patchRegionShade("b", { fill: "#ff0000" });
    expect(setCanonicalView).toHaveBeenCalledWith({
      regionShades: patchRegionShadeList(shades, "b", { fill: "#ff0000" }),
    });
  });

  it("addRegionShade routes through setCanonicalView using appendRegionShade", () => {
    const shades = [shade("a")];
    const setCanonicalView = vi.fn();
    const added = { x1: 0, y1: 0, x2: 1, y2: 1, fill: "#123456" };
    regionShadeBindings(shades, setCanonicalView).addRegionShade(added);
    expect(setCanonicalView).toHaveBeenCalledWith({ regionShades: appendRegionShade(shades, added) });
  });

  it("removeRegionShade routes through setCanonicalView using removeRegionShadeFromList", () => {
    const shades = [shade("a"), shade("b")];
    const setCanonicalView = vi.fn();
    regionShadeBindings(shades, setCanonicalView).removeRegionShade("a");
    expect(setCanonicalView).toHaveBeenCalledWith({
      regionShades: removeRegionShadeFromList(shades, "a"),
    });
  });
});
