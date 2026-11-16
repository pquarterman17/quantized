import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadUsage, MAX_USAGE_BOOST, PALETTE_USAGE_KEY, recentIds, recordUse, usageBoost } from "./paletteUsage";
import { isKnownStorageKey } from "./storageKeys";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("palette usage", () => {
  it("counts runs and remembers when", () => {
    recordUse("curvefit", 1000);
    recordUse("curvefit", 2000);
    recordUse("peaks", 1500);
    expect(loadUsage()).toEqual({ curvefit: { n: 2, t: 2000 }, peaks: { n: 1, t: 1500 } });
  });

  it("is a registered storage slot (the diagnostics allowlist)", () => {
    expect(isKnownStorageKey(PALETTE_USAGE_KEY)).toBe(true);
  });

  it("lists recent ids most-recent first, up to the limit", () => {
    recordUse("a", 1);
    recordUse("b", 3);
    recordUse("c", 2);
    expect(recentIds(loadUsage(), 2)).toEqual(["b", "c"]);
  });

  it("keeps only the 60 most recently used commands", () => {
    for (let i = 0; i < 70; i++) recordUse(`c${i}`, i);
    const usage = loadUsage();
    expect(Object.keys(usage)).toHaveLength(60);
    expect(usage.c69).toBeDefined();
    expect(usage.c0).toBeUndefined();
  });

  it("survives corrupt, hostile or unavailable storage", () => {
    localStorage.setItem(PALETTE_USAGE_KEY, "{not json");
    expect(loadUsage()).toEqual({});
    localStorage.setItem(PALETTE_USAGE_KEY, JSON.stringify({ ok: { n: 2, t: 5 }, bad: { n: "x" }, neg: { n: -1, t: 1 }, arr: [1] }));
    expect(loadUsage()).toEqual({ ok: { n: 2, t: 5 } });
    localStorage.setItem(PALETTE_USAGE_KEY, "[1,2]");
    expect(loadUsage()).toEqual({});
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(loadUsage()).toEqual({});
    expect(() => recordUse("x")).not.toThrow();
  });

  it("boosts by frequency (logarithmically) and decays with age, never past the cap", () => {
    const now = 10 * 86_400_000;
    expect(usageBoost(undefined, now)).toBe(0);
    const once = usageBoost({ n: 1, t: now }, now);
    const often = usageBoost({ n: 20, t: now }, now);
    expect(often).toBeGreaterThan(once);
    expect(usageBoost({ n: 1e9, t: now }, now)).toBeLessThanOrEqual(MAX_USAGE_BOOST);
    expect(usageBoost({ n: 20, t: now - 14 * 86_400_000 }, now)).toBeCloseTo(often / 2, 5);
  });
});
