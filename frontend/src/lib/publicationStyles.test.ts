import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MARKER_SHAPES } from "./markers";
import { sanitizeExportSeriesStyles } from "./publicationStyles";
import { installSeriesPalette, TEST_SERIES_PALETTE } from "./regressionMatrix.testkit";

describe("sanitizeExportSeriesStyles", () => {
  it("passes through a well-formed entry, including line/marker/fill/color_by", () => {
    const out = sanitizeExportSeriesStyles([
      { color: "#ff0000", width: 2, line: "dashed", marker: true, marker_size: 6, fill: "under", color_by: 2, colormap: "magma" },
    ]);
    // No `colorDerived`: the entry carried none, and nothing here invents one
    // (BUG-016 round 5). Every other key is passed through untouched.
    expect(out).toEqual([
      { color: "#ff0000", width: 2, line: "dashed", marker: true, marker_size: 6, fill: "under", color_by: 2, colormap: "magma" },
    ]);
  });

  it("returns null for a non-array / null input", () => {
    expect(sanitizeExportSeriesStyles(null)).toBeNull();
    expect(sanitizeExportSeriesStyles("nope")).toBeNull();
    expect(sanitizeExportSeriesStyles(undefined)).toBeNull();
  });

  it("drops a null entry to null, and an entry with no valid fields to null", () => {
    const out = sanitizeExportSeriesStyles([null, { bogus: "field" }]);
    expect(out).toEqual([null, null]);
  });

  // BUG-014: `legend` is a presentation value that lives in `view.seriesLabels`
  // and is re-laid onto every export request. Restoring it here would give a
  // saved document a SECOND, stale source of legend text that the rename UI
  // cannot reach. Pinned because three places claim it in prose (the code
  // comment, the commit body and the BUG-014 entry) and the allowlist would
  // otherwise drop it only incidentally.
  it("deliberately does NOT restore a legend from a saved publication style", () => {
    expect(sanitizeExportSeriesStyles([{ color: "#fff", legend: "X" }]))
      .toEqual([{ color: "#fff" }]);
    // An entry whose ONLY key is a legend has no valid fields left at all.
    expect(sanitizeExportSeriesStyles([{ legend: "X" }])).toEqual([null]);
  });

  // ── GAP_PLOTTYPES: Graph Builder "step" mark export parity ──────────────
  it("captures a valid step value", () => {
    for (const step of ["pre", "post", "mid"] as const) {
      expect(sanitizeExportSeriesStyles([{ step }])).toEqual([{ step }]);
    }
  });

  it("drops an unrecognized step value without nulling the rest of the entry", () => {
    const out = sanitizeExportSeriesStyles([{ color: "#fff", step: "diagonal" }]);
    expect(out).toEqual([{ color: "#fff" }]);
  });

  it("omits step when unset", () => {
    const out = sanitizeExportSeriesStyles([{ color: "#fff" }]);
    expect(out?.[0]).not.toHaveProperty("step");
  });

  // Found while wiring the P3.3 dash/marker cycle: `marker_shape` was added to
  // the wire type and to `buildExportStyles`, but NOT here — so a saved
  // FigureDocument's exact publication styles came back shape-less and every
  // marker reverted to a circle on re-export. Same parity break the backend
  // `_MARKER` table closed, one layer down.
  it("restores marker_shape (a saved figure's glyphs must survive re-export)", () => {
    const out = sanitizeExportSeriesStyles([{ marker: true, marker_shape: "star" }]);
    expect(out).toEqual([{ marker: true, marker_shape: "star" }]);
  });

  it("drops a non-string marker_shape and omits it when unset", () => {
    expect(sanitizeExportSeriesStyles([{ marker: true, marker_shape: 7 }])?.[0]).toEqual({
      marker: true,
    });
    expect(sanitizeExportSeriesStyles([{ color: "#fff" }])?.[0]).not.toHaveProperty("marker_shape");
  });

  // ── BUG-016 round 3: the `colorDerived` provenance flag ─────────────────
  // The one non-wire key here. A pinned array outlives the palette it was
  // resolved against, so whether its `color` was CHOSEN or was the palette
  // slot has to survive a save -- round 2 tried to recover it by comparing
  // against the live palette at export time and lost the answer on every
  // theme flip.
  it("round-trips colorDerived in both directions", () => {
    expect(sanitizeExportSeriesStyles([{ color: "#7fb3ff", colorDerived: true }])).toEqual([
      { color: "#7fb3ff", colorDerived: true },
    ]);
    expect(sanitizeExportSeriesStyles([{ color: "#ffe066", colorDerived: false }])).toEqual([
      { color: "#ffe066", colorDerived: false },
    ]);
  });

  it("drops the flag when there is no colour to describe", () => {
    // It describes `color` and says nothing on its own; a lone flag would
    // also turn an otherwise empty entry into a non-null one.
    expect(sanitizeExportSeriesStyles([{ colorDerived: true }])).toEqual([null]);
    expect(sanitizeExportSeriesStyles([{ width: 2, colorDerived: false }])).toEqual([{ width: 2 }]);
  });

  // ── BUG-016 round 5: NO provenance inference, ever ──────────────────
  // Round 3 guessed a flagless entry's provenance at the export WIRE (a
  // palette comparison, re-run per request); round 4 moved the same guess to
  // LOAD, here. Both read the LIVE palette, because the palette a pin was
  // taken under is persisted in no document — so round 4 misclassified any
  // document opened under a different theme and then FROZE that answer on the
  // next save (review F1). The information is not in the data, so this
  // sanitizer does not guess: it records what the document says and nothing
  // more, and the wire boundary fails closed on what is left unsaid.
  describe("provenance is never inferred (BUG-016 round 5)", () => {
    let restorePalette: () => void = () => {};
    beforeEach(() => {
      restorePalette = installSeriesPalette();
    });
    afterEach(() => restorePalette());

    const PALETTE_B = ["#112233", "#223344", "#334455", "#445566", "#556677", "#667788", "#778899", "#8899aa"];
    function installPaletteB(): void {
      restorePalette();
      const root = document.documentElement;
      PALETTE_B.forEach((c, i) => root.style.setProperty(`--series-${i + 1}`, c));
      restorePalette = () => PALETTE_B.forEach((_c, i) => root.style.removeProperty(`--series-${i + 1}`));
    }

    it("leaves a flagless colour UNVOUCHED even when it equals the slot at its own index", () => {
      // The exact input round 4 marked `colorDerived: true`. It looks derived
      // under THIS palette; under the one the document was pinned under it may
      // have been the user's pick. Saying nothing is the only honest answer,
      // and `toWireSeriesStyles` reads "nothing" as "not on a grouped export".
      expect(sanitizeExportSeriesStyles([
        { color: TEST_SERIES_PALETTE[0], width: 2 },
        { color: TEST_SERIES_PALETTE[1] },
        { color: "#ffe066" },
      ])).toEqual([
        { color: TEST_SERIES_PALETTE[0], width: 2 },
        { color: TEST_SERIES_PALETTE[1] },
        { color: "#ffe066" },
      ]);
    });

    it("gives the SAME output for the same document under two different palettes", () => {
      // The property round 4 could not offer, and the reason this one exists:
      // a `.dwk`, a FigureDoc, a FigureDocument and a graph template all record
      // their colours and none records the palette those colours were resolved
      // against, so a load that consults the theme answers a question about the
      // READER rather than about the document. Sabotage target: reintroduce any
      // palette read in `sanitizeExportSeriesStyles` and this goes red.
      const stored = [
        { color: TEST_SERIES_PALETTE[0], width: 2 },
        { color: PALETTE_B[1], width: 2 },
        { color: "#ffe066", colorDerived: true },
        { color: "#abc" },
      ];
      const underA = sanitizeExportSeriesStyles(structuredClone(stored));
      expect(TEST_SERIES_PALETTE[0]).not.toBe(PALETTE_B[0]); // the palettes really differ
      installPaletteB();
      const underB = sanitizeExportSeriesStyles(structuredClone(stored));
      expect(underB).toEqual(underA);
      // Non-vacuous: the two entries whose hue IS a slot in one palette or the
      // other came back flagless both times, and the document's own `true`
      // survived unchanged.
      expect(underA).toEqual([
        { color: TEST_SERIES_PALETTE[0], width: 2 },
        { color: PALETTE_B[1], width: 2 },
        { color: "#ffe066", colorDerived: true },
        { color: "#abc" },
      ]);
    });

    it("DROPS a malformed flag instead of coercing it — review F3's two cases", () => {
      // The round-4 fix that stands. `"no"` is truthy and `null` is falsy, so
      // coercion (or round 3's raw `provenance === undefined` test) read them
      // as the document's word: a CHOSEN colour silently dropped from a
      // grouped export, and a DERIVED one shipped — round 1's regression.
      // Neither is a boolean, so neither says anything, and the entry lands in
      // the same UNVOUCHED bucket as one that never had the key.
      expect(sanitizeExportSeriesStyles([
        { color: "#ffe066", colorDerived: "no" },
        { color: TEST_SERIES_PALETTE[0], colorDerived: null },
        { color: TEST_SERIES_PALETTE[0], colorDerived: 1 },
        { color: "#ffe066", colorDerived: {} },
      ])).toEqual([
        { color: "#ffe066" },
        { color: TEST_SERIES_PALETTE[0] },
        { color: TEST_SERIES_PALETTE[0] },
        { color: "#ffe066" },
      ]);
    });

    it("passes a REAL boolean through in both directions, whatever the live palette says", () => {
      // The flag is the document's word and the only provenance there is: a
      // colour the user picked that happens to equal its slot stays CHOSEN,
      // and a derived colour under a palette that has since moved stays
      // DERIVED.
      const stored = [
        { color: TEST_SERIES_PALETTE[0], colorDerived: false },
        { color: "#ffe066", colorDerived: true },
      ];
      expect(sanitizeExportSeriesStyles(structuredClone(stored))).toEqual(stored);
      installPaletteB();
      expect(sanitizeExportSeriesStyles(structuredClone(stored))).toEqual(stored);
    });
  });

  // Value-checked like `line`/`step`, and against the SAME `MARKER_SHAPE_VALUES`
  // set `plotspec2.ts`'s view-style sanitizer uses — a hand-edited or
  // future-client blob must not smuggle an unknown glyph as far as the backend's
  // `_MARKER` table to be silently downgraded to a circle there.
  it("rejects a marker_shape that is not one of the eight real glyphs", () => {
    for (const shape of ["hexagon", "", "Circle", "o"]) {
      expect(sanitizeExportSeriesStyles([{ marker: true, marker_shape: shape }])?.[0]).toEqual({
        marker: true,
      });
    }
    // …and every real one still round-trips.
    for (const shape of MARKER_SHAPES.map((m) => m.value)) {
      expect(sanitizeExportSeriesStyles([{ marker_shape: shape }])?.[0]).toEqual({ marker_shape: shape });
    }
  });
});
