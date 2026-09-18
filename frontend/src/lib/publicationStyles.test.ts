import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MARKER_SHAPES } from "./markers";
import { sanitizeExportSeriesStyles } from "./publicationStyles";
import { installSeriesPalette, TEST_SERIES_PALETTE } from "./regressionMatrix.testkit";

describe("sanitizeExportSeriesStyles", () => {
  it("passes through a well-formed entry, including line/marker/fill/color_by", () => {
    const out = sanitizeExportSeriesStyles([
      { color: "#ff0000", width: 2, line: "dashed", marker: true, marker_size: 6, fill: "under", color_by: 2, colormap: "magma" },
    ]);
    // `colorDerived: false` is the BUG-016 round-4 migration below deciding
    // this flagless `#ff0000` against the live palette: no `--series-N` is
    // set in this describe, so no slot resolves and an unvouchable colour is
    // recorded as the user's. Every other key is untouched.
    expect(out).toEqual([
      { color: "#ff0000", colorDerived: false, width: 2, line: "dashed", marker: true, marker_size: 6, fill: "under", color_by: 2, colormap: "magma" },
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
      .toEqual([{ color: "#fff", colorDerived: false }]);
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
    expect(out).toEqual([{ color: "#fff", colorDerived: false }]);
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

  // ── BUG-016 round 4: the PRE-PROVENANCE migration, resolved HERE ────────
  // Round 3 left a flagless entry's provenance ABSENT and had the export wire
  // guess it, once per request, against whatever palette was installed at
  // export time. Review F1 measured the consequence: a reopened document
  // re-persists its flagless array verbatim, so the guess never got written
  // down and "re-saving retires the residual" was false. Deciding it at LOAD
  // makes the array the app holds a provenance-carrying one, so the next save
  // writes it -- and the comparison runs exactly once per document.
  describe("pre-provenance migration (BUG-016 round 4)", () => {
    let restorePalette: () => void = () => {};
    beforeEach(() => {
      restorePalette = installSeriesPalette();
    });
    afterEach(() => restorePalette());

    it("marks a flagless colour DERIVED when it equals the slot at its own index", () => {
      const out = sanitizeExportSeriesStyles([
        { color: TEST_SERIES_PALETTE[0], width: 2 },
        { color: TEST_SERIES_PALETTE[1] },
      ]);
      expect(out).toEqual([
        { color: TEST_SERIES_PALETTE[0], colorDerived: true, width: 2 },
        { color: TEST_SERIES_PALETTE[1], colorDerived: true },
      ]);
    });

    it("marks it CHOSEN when it is not that index's slot", () => {
      // Slot 0's hue pinned at index 1 is a colour that series never derived,
      // and an off-palette literal is a pick anywhere.
      expect(sanitizeExportSeriesStyles([null, { color: TEST_SERIES_PALETTE[0] }])).toEqual([
        null, { color: TEST_SERIES_PALETTE[0], colorDerived: false },
      ]);
      expect(sanitizeExportSeriesStyles([{ color: "#ffe066", width: 2 }])).toEqual([
        { color: "#ffe066", colorDerived: false, width: 2 },
      ]);
    });

    it("compares case-insensitively — a pinned #7FB3FF is still the palette slot", () => {
      expect(TEST_SERIES_PALETTE[0]).toBe("#7fb3ff"); // the hex the fold is about
      expect(sanitizeExportSeriesStyles([{ color: "#7FB3FF" }])?.[0]).toEqual({
        color: "#7FB3FF", colorDerived: true,
      });
      // The other half, so the measurement cannot rot: three-digit hexes are
      // RESOLVED and compared, not skipped (`resolveToHex("#abc")` is
      // `#aabbcc` in this environment).
      expect(sanitizeExportSeriesStyles([{ color: "#abc" }])?.[0]).toEqual({
        color: "#abc", colorDerived: false,
      });
    });

    it("says CHOSEN when the live slot is UNRESOLVABLE rather than guessing", () => {
      // `resolveToHex`'s documented alpha-0 return is null on BOTH sides, and
      // without the `slot === null` guard they compare EQUAL — a colour this
      // sanitizer happily restores would be marked derived on a coincidence
      // of unresolvability and then dropped from every grouped export.
      restorePalette();
      const root = document.documentElement;
      root.style.setProperty("--series-1", "transparent");
      restorePalette = () => root.style.removeProperty("--series-1");
      expect(sanitizeExportSeriesStyles([{ color: "transparent", width: 2 }])).toEqual([
        { color: "transparent", colorDerived: false, width: 2 },
      ]);
    });

    it("treats a MALFORMED flag as absent and migrates it by the same rule", () => {
      // Review F3's two measured `.dwk` cases. `"no"` is truthy and `null` is
      // falsy, so round 3's `provenance === undefined` test read them as the
      // document's word: a CHOSEN colour was silently dropped from a grouped
      // export, and a DERIVED one shipped (round 1's regression). Neither is
      // a boolean, so neither is the document's word about anything.
      expect(sanitizeExportSeriesStyles([{ color: "#ffe066", colorDerived: "no" }])).toEqual([
        { color: "#ffe066", colorDerived: false },
      ]);
      expect(sanitizeExportSeriesStyles([{ color: TEST_SERIES_PALETTE[0], colorDerived: null }]))
        .toEqual([{ color: TEST_SERIES_PALETTE[0], colorDerived: true }]);
      expect(sanitizeExportSeriesStyles([{ color: TEST_SERIES_PALETTE[0], colorDerived: 1 }]))
        .toEqual([{ color: TEST_SERIES_PALETTE[0], colorDerived: true }]);
    });

    it("never overrides a REAL flag with the comparison", () => {
      // The whole point of recording provenance: a colour the user picked that
      // happens to equal its slot stays chosen, and a derived colour under a
      // palette that has since moved stays derived.
      expect(sanitizeExportSeriesStyles([
        { color: TEST_SERIES_PALETTE[0], colorDerived: false },
        { color: "#ffe066", colorDerived: true },
      ])).toEqual([
        { color: TEST_SERIES_PALETTE[0], colorDerived: false },
        { color: "#ffe066", colorDerived: true },
      ]);
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
