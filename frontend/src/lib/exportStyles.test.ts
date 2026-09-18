import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildExportStyles, toWireSeriesStyles } from "./exportStyles";
import type { PlotPayload } from "./plotdata";
import type { ExportSeriesStyle } from "./publicationStyles";
import { installSeriesPalette, TEST_SERIES_PALETTE } from "./regressionMatrix.testkit";
import { DASH, displayPositions } from "./seriesStyleCycle";
import type { SeriesStyle } from "./types";
import { buildOpts } from "./uplotOpts";

describe("buildExportStyles", () => {
  it("carries width / line / marker overrides per channel in plotted order", () => {
    const styles: Record<number, SeriesStyle> = {
      2: { width: 3, line: "dashed", marker: true, markerSize: 6 },
    };
    // plotted channels [2, 0]: index 0 → channel 2 (styled), index 1 → channel 0
    const out = buildExportStyles([2, 0], styles);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ width: 3, line: "dashed", marker: true, marker_size: 6 });
    // channel 0 has no override → only the resolved palette color (or null in jsdom)
    expect(out[1]?.width).toBeUndefined();
  });

  it("omits a marker_size when markers are off", () => {
    const out = buildExportStyles([0], { 0: { marker: false } });
    expect(out[0]?.marker).toBeUndefined();
    expect(out[0]?.marker_size).toBeUndefined();
  });

  // ── MAIN #13: fill under/between ────────────────────────────────────────
  it("carries fill: 'under' through unchanged", () => {
    const out = buildExportStyles([0], { 0: { fill: "under" } });
    expect(out[0]?.fill).toBe("under");
  });

  it("carries fill: {vs: channel} as a dataset channel index (not a display position)", () => {
    const out = buildExportStyles([2, 0], { 2: { fill: { vs: 0 } } });
    expect(out[0]?.fill).toEqual({ vs: 0 });
  });

  it("omits fill when it's 'none' (the default, no wire noise)", () => {
    const out = buildExportStyles([0], { 0: { fill: "none" } });
    expect(out[0]?.fill).toBeUndefined();
  });

  // ── MAIN #14: colour-mapped scatter ─────────────────────────────────────
  it("carries color_by + colormap (defaulting to viridis)", () => {
    const out = buildExportStyles([0], { 0: { colorBy: 2 } });
    expect(out[0]).toMatchObject({ color_by: 2, colormap: "viridis" });
  });

  it("respects an explicit colormap override", () => {
    const out = buildExportStyles([0], { 0: { colorBy: 2, colormap: "magma" } });
    expect(out[0]?.colormap).toBe("magma");
  });

  it("omits color_by/colormap when colorBy is unset", () => {
    const out = buildExportStyles([0], { 0: { width: 2 } });
    expect(out[0]?.color_by).toBeUndefined();
    expect(out[0]?.colormap).toBeUndefined();
  });

  // ── GAP_PLOTTYPES: Graph Builder "step" mark export parity ──────────────
  it("carries step through — the chokepoint every export path (ordinary Export figure…, Figure Builder, Figure Page) shares", () => {
    const out = buildExportStyles([0], { 0: { step: "mid" } });
    expect(out[0]?.step).toBe("mid");
  });

  it("omits step when unset (no wire noise)", () => {
    const out = buildExportStyles([0], { 0: { width: 2 } });
    expect(out[0]?.step).toBeUndefined();
  });
});

// ── P3.3 auto dash/marker cycle: THE EXPORT-PARITY GUARD ────────────────────
// This is the test that FEATURE-001 (plans/BUGS_AND_ISSUES.md) exists to
// demand. A faceted per-series-styling fix was built, reviewed and REVERTED
// there precisely because it would have made the export honour something the
// screen did not. So this block does not check that each side "has some dash";
// it drives BOTH real builders over the SAME plot and asserts the two resolved
// sets are EQUAL, series for series:
//
//   canvas   : buildOpts(...).series[i + 1].dash   / .points.paths
//   export   : buildExportStyles(...)[j].line      / .marker_shape
//
// Two things the first cut of this block could not catch, and which every case
// here is built to:
//
//   * `plotted` is NON-IDENTITY ([2,0,1], a reordered legend). With
//     plotted[i] === i, resolving the cycle by CHANNEL and resolving it by
//     DISPLAY POSITION are the same function, and a sabotage that swapped one
//     for the other sailed through the whole suite.
//   * one series is HIDDEN. The canvas keeps it in `payload.series` with
//     `show:false`; the export drops it. So the export's own index for a
//     channel is NOT the canvas' display position, and the two sides can only
//     agree if the export is handed the canvas' positions.
describe("auto dash/marker cycle — canvas/export parity (FEATURE-001 guard)", () => {
  // Channels 0,1,2 with a legend reordered to [2,0,1] — `seriesOrder` on the
  // real Stage, spelled out here as the plotted list both builders receive.
  const PLOTTED = [2, 0, 1];
  const payload: PlotPayload = {
    data: [
      [0, 1, 2],
      [1, 2, 3],
      [2, 3, 4],
      [3, 4, 5],
    ],
    series: [{ label: "C", unit: "" }, { label: "A", unit: "" }, { label: "B", unit: "" }],
    xLabel: "x",
    xUnit: "",
  };
  const optsArgs = {
    width: 600,
    height: 400,
    xScale: "linear" as const,
    yScale: "linear" as const,
    tool: "zoom" as const,
    onReadout: vi.fn(),
  };

  /** The uPlot series config the CANVAS builds, in display order. */
  const canvasSeries = (styles: Record<number, SeriesStyle>, on: boolean) =>
    (
      buildOpts(payload, {
        ...optsArgs,
        seriesStyles: PLOTTED.map((ch) => styles[ch]),
        // Exactly what `PlotStage.tsx` passes: plain display order over the
        // series it draws.
        seriesCycle: displayPositions(on, PLOTTED.length),
      }).series ?? []
    ).slice(1);

  /** The dash the CANVAS will draw for each display series. */
  const canvasDashes = (styles: Record<number, SeriesStyle>, on: boolean) =>
    canvasSeries(styles, on).map((s) => (s as { dash?: number[] }).dash);

  /** The dash the EXPORT will draw, translated through the same DASH table so
   *  the two are comparable values. The wire type's extra `"none"` (point-only
   *  scatter) has no canvas dash by definition, so it maps to undefined like
   *  `"solid"` does. */
  const toDash = (specs: ReturnType<typeof buildExportStyles>) =>
    specs.map((spec) => (spec?.line && spec.line !== "none" ? DASH[spec.line] : undefined));

  /** What `lib/figureSpec.ts` builds: the hidden-FILTERED channel list, plus
   *  each survivor's position in the UNFILTERED display list. The positions go
   *  in unconditionally (BUG-015) — `on` toggles only the dash/glyph cycle. */
  const exportSpecs = (styles: Record<number, SeriesStyle>, on: boolean, hidden: number[] = []) => {
    const visible = PLOTTED.filter((ch) => !hidden.includes(ch));
    return buildExportStyles(visible, styles, visible.map((ch) => PLOTTED.indexOf(ch)), on);
  };

  it("OFF: neither side encodes a dash (and they agree about that)", () => {
    expect(canvasDashes({}, false)).toEqual([undefined, undefined, undefined]);
    expect(toDash(exportSpecs({}, false))).toEqual([undefined, undefined, undefined]);
    expect(exportSpecs({}, false).map((s) => s?.line)).toEqual([undefined, undefined, undefined]);
  });

  it("ON: the export spec carries the SAME dash per series the canvas draws", () => {
    const canvas = canvasDashes({}, true);
    expect(toDash(exportSpecs({}, true))).toEqual(canvas); // the parity assertion
    // …and it is a meaningful agreement, not two empty lists agreeing:
    expect(new Set(canvas.map((d) => JSON.stringify(d))).size).toBe(3);
  });

  it("ON: parity survives a reordered legend — the cycle follows POSITION, not channel", () => {
    // Channel 2 draws FIRST, so it is the solid one; channel 0 is second and
    // dashed. Resolving by channel would swap them and still look plausible.
    const specs = exportSpecs({}, true);
    expect(specs.map((s) => s?.line)).toEqual(["solid", "dashed", "dotted"]);
    expect(toDash(specs)).toEqual(canvasDashes({}, true));
  });

  it("ON: parity holds with a HIDDEN series — the export uses the canvas' positions", () => {
    // Hide channel 0, which sits at display position 1. The two survivors keep
    // positions 0 and 2, so channel 1 stays DOTTED on both sides; an export
    // that re-indexed its own filtered list would draw it dashed.
    const hidden = [0];
    const canvas = canvasDashes({}, true);
    const specs = exportSpecs({}, true, hidden);
    expect(specs.map((s) => s?.line)).toEqual(["solid", "dotted"]);
    // Compare series-for-series against the canvas entries still drawn.
    const visibleCanvas = PLOTTED.map((ch, i) => [ch, canvas[i]] as const)
      .filter(([ch]) => !hidden.includes(ch))
      .map(([, d]) => d);
    expect(toDash(specs)).toEqual(visibleCanvas);
  });

  it("ON: the palette rides the same positions, so a hidden series cannot skew it", () => {
    // The pre-existing half of the same bug: `seriesColor(i)` on both sides
    // with two different `i`. Channel 1 is the export's SECOND entry but the
    // canvas' THIRD display position, so it must take --series-3, not
    // --series-2 — which is what indexing by the filtered position gave it.
    //
    // The palette tokens have to be real for this: `seriesColor` reads
    // `--series-N` off the document, and jsdom's stylesheet has none, so every
    // index would otherwise fall back to the same literal and the assertion
    // could not fail.
    const root = document.documentElement;
    // Light, mutually distinct paints: the canvas runs its stroke through the
    // same `resolveDrawColor` contrast check a literal override gets, and a
    // near-black token would be substituted for the ink colour instead.
    const paint = ["#ffcccc", "#ccffcc", "#ccccff"];
    paint.forEach((c, i) => root.style.setProperty(`--series-${i + 1}`, c));
    try {
      const canvasStrokes = canvasSeries({}, true).map((s) => s.stroke);
      expect(canvasStrokes).toEqual(paint); // display positions 0,1,2
      const tokens = exportSpecs({}, true, [0]).map((s) => s?.color);
      expect(tokens).toEqual([paint[0], paint[2]]); // positions 0 and 2 survive
    } finally {
      paint.forEach((_, i) => root.style.removeProperty(`--series-${i + 1}`));
    }
  });

  it("OFF: the positions still hold — no dash is invented, and no palette skew either (BUG-015)", () => {
    // The two halves are independent. With the preference OFF nothing is
    // cycled — only the explicitly styled series carries a line, and no glyph
    // is invented — but the PALETTE still rides the canvas' positions, because
    // colouring by the hidden-filtered index is BUG-015 and was never part of
    // the opt-in. (This test previously asserted that skew, by comparing
    // against the positionless two-argument call.)
    const styles: Record<number, SeriesStyle> = { 1: { width: 3 }, 2: { line: "dotted" } };
    const specs = exportSpecs(styles, false, [0]); // survivors: channel 2, then 1
    expect(specs.map((s) => s?.line)).toEqual(["dotted", undefined]);
    expect(specs.map((s) => s?.marker_shape)).toEqual([undefined, undefined]);
    const root = document.documentElement;
    const paint = ["#ffcccc", "#ccffcc", "#ccccff"];
    paint.forEach((c, i) => root.style.setProperty(`--series-${i + 1}`, c));
    try {
      // Positions 0 and 2 — NOT the filtered 0 and 1 the bug produced.
      expect(exportSpecs(styles, false, [0]).map((s) => s?.color)).toEqual([paint[0], paint[2]]);
    } finally {
      paint.forEach((_, i) => root.style.removeProperty(`--series-${i + 1}`));
    }
  });

  it("ON: parity holds when some series are explicitly styled and some are not", () => {
    const styles: Record<number, SeriesStyle> = { 0: { line: "dotted" }, 1: { width: 3 } };
    expect(toDash(exportSpecs(styles, true))).toEqual(canvasDashes(styles, true));
    // channel 0 sits at position 1 (which wants "dashed") and keeps its dotted
    expect(exportSpecs(styles, true)[1]?.line).toBe("dotted");
  });

  it("ON: the exported marker_shape is the SAME glyph the canvas paths builder uses", () => {
    const styles: Record<number, SeriesStyle> = {
      2: { marker: true },
      0: { marker: true },
      1: { marker: true, markerShape: "star" },
    };
    const shapes = exportSpecs(styles, true).map((s) => s?.marker_shape);
    expect(shapes).toEqual(["circle", "square", "star"]); // cycle, cycle, explicit
    // The canvas side agrees: a circle is uPlot's own renderer (no paths
    // builder), every other glyph supplies one — so "has a builder" is exactly
    // "is not a circle", which is what the shape list above claims.
    const pts = canvasSeries(styles, true).map((s) => s.points);
    expect(pts.map((p) => typeof p?.paths === "function")).toEqual(shapes.map((sh) => sh !== "circle"));
  });

  it("ON: no marker_shape leaks onto a series that draws no marker", () => {
    // The glyph is resolved for every series but stays behind the `marker` gate
    // on BOTH sides, so a line-only plot exports exactly as before.
    const out = exportSpecs({}, true);
    expect(out.map((s) => s?.marker)).toEqual([undefined, undefined, undefined]);
    expect(out.map((s) => s?.marker_shape)).toEqual([undefined, undefined, undefined]);
  });

  // NIT 3 of the BUG-015 review: a positions array shorter than `plotted`
  // degrades to the plotted index instead of `seriesColor(undefined)` indexing
  // SERIES_VARS[NaN] and painting every uncovered series one hardcoded colour.
  // Defensive only — the one non-null producer builds it with `plotted.length`
  // entries — so it is pinned here rather than through a real view.
  it("a SHORT positions array degrades to the plotted index, not to one fallback paint", () => {
    const root = document.documentElement;
    const paint = ["#ffcccc", "#ccffcc", "#ccccff"];
    paint.forEach((c, i) => root.style.setProperty(`--series-${i + 1}`, c));
    try {
      const short = buildExportStyles([0, 1, 2], {}, [0]).map((s) => s?.color);
      expect(short).toEqual(paint);
      // Non-vacuous: the ragged entries are distinct paints, not one repeat.
      expect(new Set(short).size).toBe(3);
    } finally {
      paint.forEach((_, i) => root.style.removeProperty(`--series-${i + 1}`));
    }
  });
});

// ── BUG-016: the `grouped` colour rule, and the PROVENANCE it now rides on ──
// Round 1 added `buildExportStyles`' fifth argument and nothing guarded it
// (sabotaging `legacyFigure`'s use left 713/713 green — review F3). Round 2
// added a pinned-array strip that recovered "derived vs chosen" by comparing
// the pinned hex against the LIVE palette at THIS request's positions, which
// round-2 review F1/F2 measured failing on a theme flip, a palette preset and
// a display-position shift — the round-1 one-hue regression, back whole.
// Round 3 records the answer at the producer instead. These cases are written
// so the recovery-by-comparison implementation CANNOT pass them: every
// grouped assertion about a provenance-carrying array runs under a palette
// that is NOT the one the array was pinned against.
describe("BUG-016 — a grouped request's colour", () => {
  let restorePalette: () => void = () => {};
  beforeEach(() => {
    restorePalette = installSeriesPalette();
  });
  afterEach(() => restorePalette());

  /** A DIFFERENT palette, installed after the pin: a theme flip
   *  (`styles/colors.css` redefines all eight) or one of the five presets
   *  (`lib/palettes.ts`'s `applyPalette`). Deliberately disjoint from
   *  `TEST_SERIES_PALETTE` so an equality-based classifier misses every time. */
  const PALETTE_B = ["#112233", "#223344", "#334455", "#445566", "#556677", "#667788", "#778899", "#8899aa"];
  function flipTheme(): void {
    restorePalette();
    const root = document.documentElement;
    PALETTE_B.forEach((c, i) => root.style.setProperty(`--series-${i + 1}`, c));
    restorePalette = () => PALETTE_B.forEach((_c, i) => root.style.removeProperty(`--series-${i + 1}`));
  }

  // ── the producer records which branch paid for the colour ────────────────
  it("records `colorDerived` on the colour it emits: true for the palette slot, false for a pick", () => {
    expect(buildExportStyles([0], {})[0]).toEqual({
      color: TEST_SERIES_PALETTE[0], colorDerived: true,
    });
    expect(buildExportStyles([0], { 0: { color: "#ffe066" } })[0]).toEqual({
      color: "#ffe066", colorDerived: false,
    });
    // A `--series-N` SWATCH pick resolves to a palette hex and is still a
    // pick: this is review F3's case, and it is now recorded, not guessed.
    expect(buildExportStyles([0], { 0: { color: "--series-1" } })[0]).toEqual({
      color: TEST_SERIES_PALETTE[0], colorDerived: false,
    });
  });

  it("`grouped` omits the palette-DERIVED colour and nothing else", () => {
    const style: Record<number, SeriesStyle> = { 0: { width: 2, line: "dashed" } };
    // Control, same call with the flag off: the colour IS baked in, so the
    // assertion below is about the flag and not about an absent palette.
    expect(buildExportStyles([0], style)[0]).toEqual({
      color: TEST_SERIES_PALETTE[0], colorDerived: true, width: 2, line: "dashed",
    });
    expect(buildExportStyles([0], style, null, false, true)[0]).toEqual({
      width: 2, line: "dashed",
    });
  });

  it("`grouped` KEEPS an explicit colour — the canvas gives it to every level", () => {
    const style: Record<number, SeriesStyle> = { 0: { color: "#ffe066", width: 2 } };
    expect(buildExportStyles([0], style, null, false, true)[0]).toEqual({
      color: "#ffe066", colorDerived: false, width: 2,
    });
  });

  it("`grouped` leaves nothing at all for a channel whose only style was the palette", () => {
    expect(buildExportStyles([0, 1], {}, null, false, true)).toEqual([null, null]);
    // Non-vacuous: flat, the same channels carry their two distinct slots.
    expect(buildExportStyles([0, 1], {}).map((s) => s?.color))
      .toEqual([TEST_SERIES_PALETTE[0], TEST_SERIES_PALETTE[1]]);
  });

  // ── the wire boundary ────────────────────────────────────────────────────
  it("takes the provenance flag off every request, flat or grouped", () => {
    const flat = toWireSeriesStyles(buildExportStyles([0], { 0: { width: 2 } }), false);
    expect(flat).toEqual([{ color: TEST_SERIES_PALETTE[0], width: 2 }]);
    expect(Object.keys(flat[0]!)).not.toContain("colorDerived");
    const grouped = toWireSeriesStyles(buildExportStyles([0], { 0: { color: "#ffe066" } }), true);
    expect(grouped).toEqual([{ color: "#ffe066" }]);
  });

  it("drops a DERIVED pinned colour when grouped even after a THEME FLIP", () => {
    // The F1 case. Pinned under palette A, exported under palette B: the hex
    // matches no live slot at all, so round 2 classified it "chosen" and the
    // backend painted all three levels `#7fb3ff`. Provenance does not care.
    const pinned = buildExportStyles([0], { 0: { width: 2, line: "dashed" } });
    expect(pinned[0]?.color).toBe(TEST_SERIES_PALETTE[0]);
    flipTheme();
    expect(toWireSeriesStyles(pinned, true)).toEqual([{ width: 2, line: "dashed" }]);
  });

  it("KEEPS an explicit pinned colour when grouped after a theme flip — even one that now equals a live slot", () => {
    // The other half of the promise, and review F3's asymmetry closed: the
    // pick `#112233` is slot 0 of the NEW palette, so a comparison-based
    // classifier would strip the colour the user chose. It is sent.
    const pinned = buildExportStyles([0], { 0: { color: PALETTE_B[0], width: 2 } });
    flipTheme();
    expect(toWireSeriesStyles(pinned, true)).toEqual([{ color: PALETTE_B[0], width: 2 }]);
  });

  it("asks nothing about the request's positions — the same entry decides the same way anywhere", () => {
    // Review F2's root: round 2 read the slot at THIS request's display
    // position, which is not the position the array was pinned at. A
    // provenance-carrying entry has no position dependence left to exercise,
    // so the whole array's answer is index-invariant.
    const derived = buildExportStyles([0, 1, 2], {});
    expect(toWireSeriesStyles(derived, true)).toEqual([null, null, null]);
    expect(toWireSeriesStyles([derived[2]!, derived[0]!], true)).toEqual([null, null]);
  });

  it("leaves a FLAT pinned array's colours exactly as pinned, including under a palette switch", () => {
    // The deliberate asymmetry: a pinned FLAT figure keeps the hex it was
    // saved with rather than tracking the live palette. Design (a) — pin no
    // derived colour and refill from the palette at export — would have
    // changed this line, which is why it was not taken (BUG-016 round 3).
    const pinned = buildExportStyles([0, 1], { 1: { color: "#ffe066" } });
    flipTheme();
    expect(toWireSeriesStyles(pinned, false)).toEqual([
      { color: TEST_SERIES_PALETTE[0] }, { color: "#ffe066" },
    ]);
  });

  it("collapses an emptied entry to null, not {}", () => {
    const pinned = buildExportStyles([0], {});
    flipTheme();
    expect(toWireSeriesStyles(pinned, true)).toEqual([null]);
  });

  it("does not mutate the entries it rewrites", () => {
    const entry: ExportSeriesStyle = { color: TEST_SERIES_PALETTE[0], colorDerived: true, width: 2 };
    toWireSeriesStyles([entry], true);
    expect(entry).toEqual({ color: TEST_SERIES_PALETTE[0], colorDerived: true, width: 2 });
  });

  it("returns the caller's OWN array when there is nothing to remove", () => {
    // A pre-provenance array of chosen colours: no flag to strip, nothing
    // derived, so a request pinning explicit colours is untouched by this
    // function existing.
    const pinned: (ExportSeriesStyle | null)[] = [{ color: "#ffe066" }, null];
    expect(toWireSeriesStyles(pinned, true)).toBe(pinned);
    expect(toWireSeriesStyles(pinned, false)).toBe(pinned);
  });

  // ── the PRE-PROVENANCE migration rule ────────────────────────────────────
  // An array pinned before `colorDerived` existed. The rule, and its whole
  // scope: on a GROUPED request only, drop a colour that still equals the
  // palette slot at the entry's OWN ARRAY INDEX — the index every producer of
  // a pinned array built in (`positions = null`). Flat is untouched.
  describe("a pre-provenance pinned array (no colorDerived key)", () => {
    it("drops a colour equal to the slot at its own pinned INDEX when grouped", () => {
      const pinned: (ExportSeriesStyle | null)[] = [
        { color: TEST_SERIES_PALETTE[0], width: 2, line: "dashed" },
        { color: TEST_SERIES_PALETTE[1] },
        null,
      ];
      expect(toWireSeriesStyles(pinned, true)).toEqual([{ width: 2, line: "dashed" }, null, null]);
    });

    it("keeps a colour that is not that index's slot", () => {
      // Slot 0's hue pinned at index 1 is a colour that series never derived.
      expect(toWireSeriesStyles([null, { color: TEST_SERIES_PALETTE[0] }], true))
        .toEqual([null, { color: TEST_SERIES_PALETTE[0] }]);
      expect(toWireSeriesStyles([{ color: "#ffe066", width: 2 }], true))
        .toEqual([{ color: "#ffe066", width: 2 }]);
    });

    it("compares case-insensitively — a pinned #7FB3FF is still the palette slot", () => {
      expect(TEST_SERIES_PALETTE[0]).toBe("#7fb3ff"); // the hex the fold is about
      expect(toWireSeriesStyles([{ color: "#7FB3FF" }], true)[0]).toBeNull();
    });

    it("is FLAT-safe: the same array is untouched on an ungrouped request", () => {
      const pinned: (ExportSeriesStyle | null)[] = [{ color: TEST_SERIES_PALETTE[0], width: 2 }];
      expect(toWireSeriesStyles(pinned, false)).toBe(pinned);
    });

    it("keeps the colour when the live slot is UNRESOLVABLE rather than guessing", () => {
      // Round-2 review F4: the `slot === null` clause survived that round's
      // sabotage untouched because no test could reach it — the case it was
      // written for (a 3-digit `#abc` against an oklch token) is decided by
      // the hex comparison instead. MEASURED in this environment:
      // `resolveToHex("#abc")` -> `#aabbcc`, `resolveToHex("oklch(...)")` ->
      // `#000000` (jsdom's canvas ignores the oklch fillStyle), so neither is
      // null. What IS null is a colour that paints nothing at all: the
      // function's documented "alpha 0 -> unparseable" return. With BOTH
      // sides null and no guard, they compare EQUAL and a colour the
      // sanitizer happily restored (it accepts any string) is stripped from a
      // grouped export on a coincidence of unresolvability.
      restorePalette();
      const root = document.documentElement;
      root.style.setProperty("--series-1", "transparent");
      restorePalette = () => root.style.removeProperty("--series-1");
      const pinned: (ExportSeriesStyle | null)[] = [{ color: "transparent", width: 2 }];
      expect(toWireSeriesStyles(pinned, true)).toBe(pinned);
    });

    it("still decides an UNMARKED #abc against the slot's own resolved hex", () => {
      // The other half of the measurement above, so the comment cannot rot:
      // three-digit hexes are compared, not skipped. `#7fb3ff` is slot 0.
      expect(toWireSeriesStyles([{ color: "#7FB3FF", width: 2 }], true)).toEqual([{ width: 2 }]);
      expect(toWireSeriesStyles([{ color: "#abc", width: 2 }], true)).toEqual([{ color: "#abc", width: 2 }]);
    });

    it("RESIDUAL, recorded: under a changed palette its derived colour reads as chosen", () => {
      // The known and documented limit of the migration rule — a document
      // saved before provenance existed, exported under a different theme.
      // Pinned here so the residual is a pinned behaviour and not a surprise;
      // re-saving such a figure writes provenance and retires it.
      const pinned: (ExportSeriesStyle | null)[] = [{ color: TEST_SERIES_PALETTE[0], width: 2 }];
      flipTheme();
      expect(toWireSeriesStyles(pinned, true)).toBe(pinned);
    });
  });
});
