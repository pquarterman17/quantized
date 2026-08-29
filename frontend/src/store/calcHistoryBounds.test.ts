// Regression for the storage-bound half of the post-#263 review round.
//
// #260 added `CalcEntry.inputs` -- an exact raw snapshot of what the user
// typed into a calculator card. Entry COUNTS are capped (HISTORY_MAX 100,
// FAV_MAX 50) but no per-entry string length ever was, and card fields are
// free text: a pasted column of numbers rides verbatim into localStorage and
// is repeated across up to 150 retained entries.
//
// The failure that matters is not the fat entry, it is what the fat entry
// does to everything else: `save()` swallows a QuotaExceededError by design
// (private mode / storage-off must not break the app), so once the slot no
// longer fits, the ENTIRE session memory silently stops persisting -- the
// user's whole history and every pinned favorite, lost on reload with no
// signal.

import { beforeEach, describe, expect, it } from "vitest";

import { INPUTS_MAX, loadPersisted, useCalcHistory } from "./calcHistory";

beforeEach(() => {
  localStorage.clear();
  useCalcHistory.setState({ history: [], favorites: [], seq: 0 });
});

describe("calc history per-entry storage bound", () => {
  it("truncates an oversized inputs snapshot on record", () => {
    const huge = "9.81,".repeat(20_000); // ~100 kB pasted into a numeric field
    useCalcHistory.getState().record({
      domain: "thinfilm",
      label: "Scherrer",
      summary: "D = 165.7 Å",
      inputs: huge,
    });
    const stored = useCalcHistory.getState().history[0].inputs ?? "";
    expect(stored.length).toBeLessThanOrEqual(INPUTS_MAX);
    // Truncation must be visible, not silent — the value is provenance.
    expect(stored.endsWith("…")).toBe(true);
    // The head is preserved so the snapshot stays useful.
    expect(stored.startsWith("9.81,9.81,")).toBe(true);
  });

  it("keeps an ordinary inputs snapshot byte-for-byte", () => {
    const ordinary = "fwhm_deg=0.5, wavelength=1.5406 Å, two_theta_deg=33";
    useCalcHistory.getState().record({
      domain: "thinfilm",
      label: "Scherrer",
      summary: "D = 165.7 Å",
      inputs: ordinary,
    });
    expect(useCalcHistory.getState().history[0].inputs).toBe(ordinary);
  });

  it("bounds the persisted slot so a full history cannot blow the quota", () => {
    const huge = "x".repeat(200_000);
    for (let i = 0; i < 120; i++) {
      useCalcHistory.getState().record({
        domain: "d",
        label: `run ${i}`,
        summary: "ok",
        inputs: huge,
      });
    }
    const raw = localStorage.getItem("qz.calcHistory") ?? "";
    // 100 retained entries * a bounded snapshot must stay well inside the
    // ~5 MB localStorage budget, with room for the rest of the app's slots.
    expect(raw.length).toBeLessThan(1_000_000);
  });

  it("trims an oversized snapshot already persisted by an older build", () => {
    localStorage.setItem(
      "qz.calcHistory",
      JSON.stringify({
        history: [
          { id: "c1", domain: "d", label: "l", summary: "s", inputs: "y".repeat(200_000), ts: "t" },
        ],
        favorites: [],
        seq: 1,
      }),
    );
    // Re-read through the store's own loader (the real creation-time path).
    const loaded = loadPersisted();
    expect((loaded.history[0].inputs ?? "").length).toBeLessThanOrEqual(INPUTS_MAX);
  });
});

describe("quota failure degrades instead of losing the session", () => {
  it("sheds oldest history but keeps favorites when the slot will not fit", () => {
    // Simulating a full disk needs care about WHAT gets patched. jsdom's
    // `localStorage` is an exotic Storage object: `setItem` is not an own
    // property, and neither `vi.spyOn(localStorage, "setItem")` nor a
    // `Storage.prototype` patch reliably intercepts its internal calls --
    // measured here, spyOn landed 0 of 1 calls. `Storage.prototype` did work
    // on Node 22 and then silently stopped on newer Node, which ships its own
    // global `Storage` class for the patch to hit instead; that is how the
    // first version of this test passed one CI node version and failed the
    // other. Replacing the global binding is the one approach that does not
    // depend on either detail, and `rejected` below asserts the interception
    // actually happened rather than trusting it.
    const LIMIT = 4096;
    const backing = new Map<string, string>();
    let rejected = 0;
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string): string | null => backing.get(k) ?? null,
        setItem: (k: string, v: string): void => {
          if (v.length > LIMIT) {
            rejected += 1;
            const err = new Error("QuotaExceededError");
            err.name = "QuotaExceededError";
            throw err;
          }
          backing.set(k, v);
        },
        removeItem: (k: string): void => void backing.delete(k),
        clear: (): void => backing.clear(),
      },
    });
    try {
      for (let i = 0; i < 60; i++) {
        useCalcHistory.getState().record({
          domain: "d",
          label: `run ${i}`,
          summary: "s".repeat(200),
          inputs: "i".repeat(200),
        });
      }
      useCalcHistory.getState().toggleFavorite(useCalcHistory.getState().history[0].id);

      // The quota path was genuinely exercised. Without this the assertions
      // below can pass for the wrong reason wherever the patch fails to bite.
      expect(rejected, "the oversized write was actually refused").toBeGreaterThan(0);

      const raw = backing.get("qz.calcHistory");
      expect(raw, "something was persisted rather than nothing").toBeDefined();
      const parsed = JSON.parse(raw ?? "{}") as {
        history: unknown[];
        favorites: unknown[];
      };
      // The pinned favorite is the user's deliberate pick — it must survive.
      expect(parsed.favorites).toHaveLength(1);
      // History was shed to make room, not silently dropped whole-session.
      expect(parsed.history.length).toBeLessThan(60);
      expect((raw ?? "").length).toBeLessThanOrEqual(LIMIT);
    } finally {
      if (original) Object.defineProperty(globalThis, "localStorage", original);
    }
  });
});
