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
    // A storage that refuses anything over ~4 kB, the shape of a quota error.
    const real = Storage.prototype.setItem;
    const LIMIT = 4096;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (v.length > LIMIT) {
        const err = new Error("QuotaExceededError");
        err.name = "QuotaExceededError";
        throw err;
      }
      return real.call(this, k, v);
    };
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

      const raw = localStorage.getItem("qz.calcHistory");
      expect(raw, "something was persisted rather than nothing").not.toBeNull();
      const parsed = JSON.parse(raw ?? "{}") as {
        history: unknown[];
        favorites: unknown[];
      };
      // The pinned favorite is the user's deliberate pick — it must survive.
      expect(parsed.favorites).toHaveLength(1);
      // History was shed to make room, not silently dropped whole-session.
      expect(parsed.history.length).toBeLessThan(60);
    } finally {
      Storage.prototype.setItem = real;
    }
  });
});
