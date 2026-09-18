import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildExportStyles, type ExportSeriesStyle } from "./exportStyles";
import { resolveDisplaySeries, resolveSeriesPresentation, seriesDisplayLabel, withSeriesLegends } from "./figureSpecSeries";
import { installSeriesPalette, TEST_SERIES_PALETTE } from "./regressionMatrix.testkit";
import type { DataStruct, SeriesStyle } from "./types";

const data: DataStruct = {
  time: [0, 1, 2],
  values: [
    [10, 100, 1, 2],
    [20, 200, 3, 4],
    [30, 300, 5, 6],
  ],
  labels: ["a", "b", "c", "d"],
  units: ["", "V", "A", "V"],
  metadata: {},
};

const view = (over: Partial<Parameters<typeof resolveDisplaySeries>[1]> = {}) => ({
  yKeys: [0, 1, 2, 3] as number[] | null,
  xKey: null as number | null,
  seriesOrder: null as number[] | null,
  hiddenChannels: [] as number[],
  ...over,
});

describe("resolveDisplaySeries", () => {
  it("is plain display order when nothing is hidden or reordered", () => {
    expect(resolveDisplaySeries(data, view())).toEqual({
      displayChannels: [0, 1, 2, 3],
      canvasChannels: [0, 1, 2, 3],
      plotted: [0, 1, 2, 3],
      positions: [0, 1, 2, 3],
    });
  });

  it("keeps the survivors on their UNFILTERED slots when a series is hidden (BUG-015)", () => {
    const { plotted, positions } = resolveDisplaySeries(data, view({ hiddenChannels: [1] }));
    expect(plotted).toEqual([0, 2, 3]);
    // Not [0, 1, 2]: the canvas leaves channel 1 in place with `show:false`.
    expect(positions).toEqual([0, 2, 3]);
  });

  it("follows seriesOrder, and hides AFTER reordering", () => {
    const { displayChannels, plotted, positions } = resolveDisplaySeries(
      data,
      view({ seriesOrder: [3, 1, 0, 2], hiddenChannels: [1] }),
    );
    expect(displayChannels).toEqual([3, 1, 0, 2]);
    expect(plotted).toEqual([3, 0, 2]);
    expect(positions).toEqual([0, 2, 3]);
  });

  it("gives each occurrence of a duplicated channel its own slot (NIT 2)", () => {
    // `indexOf` would collapse both copies of channel 1 onto slot 1, where the
    // canvas (`seriesColor(i, …)`, keyed by array index) paints them 1 and 2.
    const { plotted, positions } = resolveDisplaySeries(data, view({ yKeys: [0, 1, 1, 2] }));
    expect(plotted).toEqual([0, 1, 1, 2]);
    expect(positions).toEqual([0, 1, 2, 3]);
  });

  it("drops the X channel from both lists by default", () => {
    expect(resolveDisplaySeries(data, view({ xKey: 1 }))).toEqual({
      displayChannels: [0, 2, 3],
      // With no `allowExplicitXAsY` the two lists are the same array.
      canvasChannels: [0, 2, 3],
      plotted: [0, 2, 3],
      positions: [0, 1, 2],
    });
  });

  it("keeps an explicit X-as-Y channel but scores positions against the CANVAS list", () => {
    // The canvas' own call always drops the x channel, so its list is [2, 3].
    // Channels 2 and 3 therefore keep slots 0 and 1 — the paints the screen
    // actually used — and channel 1, which the canvas never draws, is parked
    // past the end rather than stealing slot 0 or colliding with channel 2.
    const { displayChannels, canvasChannels, plotted, positions } = resolveDisplaySeries(
      data,
      view({ xKey: 1, yKeys: [1, 2, 3], allowExplicitXAsY: true }),
    );
    expect(displayChannels).toEqual([1, 2, 3]);
    expect(plotted).toEqual([1, 2, 3]);
    expect(positions).toEqual([2, 0, 1]);
    // BUG-013 round 3: the waterfall STEP is measured over this list, so it is
    // returned rather than recomputed by every caller that needs it.
    expect(canvasChannels).toEqual([2, 3]);
  });

  it("parks EVERY canvas-absent channel on its own slot", () => {
    // Two X-as-Y copies must not share one paint either.
    const { positions } = resolveDisplaySeries(
      data,
      view({ xKey: 1, yKeys: [1, 1, 2], allowExplicitXAsY: true }),
    );
    expect(positions).toEqual([1, 2, 0]);
  });
});

describe("withSeriesLegends (BUG-014)", () => {
  it("is the identity when nothing was renamed — including for a null list", () => {
    const styles = [{ color: "#111" }, null];
    expect(withSeriesLegends(styles, [undefined, undefined])).toBe(styles);
    expect(withSeriesLegends(null, [undefined])).toBeNull();
  });

  it("lays a rename over the existing style without displacing it", () => {
    expect(withSeriesLegends([{ color: "#111" }, { width: 2 }], ["Loop 1", undefined])).toEqual([
      { color: "#111", legend: "Loop 1" },
      { width: 2 },
    ]);
  });

  it("materializes a list when there are no styles at all, so a rename still ships", () => {
    expect(withSeriesLegends(null, [undefined, "Loop 2"])).toEqual([null, { legend: "Loop 2" }]);
    expect(withSeriesLegends([], ["Loop 1"])).toEqual([{ legend: "Loop 1" }]);
  });

  it("carries an EMPTY rename verbatim — a blank legend is a real choice", () => {
    expect(withSeriesLegends(null, [""])).toEqual([{ legend: "" }]);
  });

  it("does not mutate the style objects it was handed", () => {
    const styles = [{ color: "#111" }];
    withSeriesLegends(styles, ["Loop 1"]);
    expect(styles[0]).not.toHaveProperty("legend");
  });
});

describe("seriesDisplayLabel (BUG-014 round 3)", () => {
  it("renders the derived label for an undefined legend", () => {
    expect(seriesDisplayLabel("Signal", "au", undefined)).toBe("Signal (au)");
  });

  it("renders the verbatim rename when given one", () => {
    expect(seriesDisplayLabel("Signal", "au", "Loop 1")).toBe("Loop 1");
  });

  // The doc above claims `??` semantics — matching `uplotOpts.buildOpts`
  // (`args.seriesLabels?.[i] ?? (...)`) and the backend's `if legend is not
  // None`. A `null` is reachable despite the `string | undefined` signature:
  // any caller that builds a view in memory can pass one (round 4 closed the
  // `.dwk` route — `sanitizePlotView` drops non-string values now — but not
  // the type hole itself). `!== undefined` would ship `label: null` on the
  // wire; `??` degrades gracefully, same as every other leg.
  it("degrades to the derived label for a null legend, not `!== undefined`", () => {
    // `null` slipping past the `string | undefined` signature is exactly the
    // runtime case under test — see the doc comment above.
    expect(seriesDisplayLabel("Signal", "au", null as unknown as undefined)).toBe("Signal (au)");
  });
});

describe("resolveSeriesPresentation", () => {
  it("derives styles from the view when the document pins none", () => {
    const out = resolveSeriesPresentation([0, 1], { 0: { width: 3 } }, [0, 1], false, [], undefined);
    expect(out?.[0]).toMatchObject({ width: 3 });
  });

  it("deep-copies a pinned publication array rather than sharing it", () => {
    const pinned = [{ color: "#fedcba" }, null];
    const out = resolveSeriesPresentation([0, 1], {}, [0, 1], false, [], pinned);
    expect(out).toEqual(pinned);
    expect(out).not.toBe(pinned);
    expect(out?.[0]).not.toBe(pinned[0]);
  });

  it("omits the field entirely for a null pin with no renames, and materializes one with", () => {
    expect(resolveSeriesPresentation([0], {}, [0], false, [undefined], null)).toBeNull();
    expect(resolveSeriesPresentation([0], {}, [0], false, ["Loop 1"], null)).toEqual([
      { legend: "Loop 1" },
    ]);
  });

  // BUG-016 round 3 (round-2 review F1/F2). A pinned array is a previous
  // `buildExportStyles` run on a FLAT request, so its `color` is the palette
  // slot whenever the user chose none. Shipping it verbatim on a grouped
  // request made the backend paint every LEVEL that one hue — a regression
  // against the pre-fix cycle. Round 2 recovered "derived vs chosen" from the
  // LIVE palette at THIS request's display positions; both inputs are the
  // wrong ones, so every case below moves one of them between the pin and the
  // export and still demands the rule.
  describe("a grouped request's colour", () => {
    let restorePalette: () => void = () => {};
    beforeEach(() => {
      restorePalette = installSeriesPalette();
    });
    afterEach(() => restorePalette());

    const PALETTE_B = ["#112233", "#223344", "#334455", "#445566", "#556677", "#667788", "#778899", "#8899aa"];
    /** A theme flip / palette preset between the pin and the export. */
    function flipTheme(): void {
      restorePalette();
      const root = document.documentElement;
      PALETTE_B.forEach((c, i) => root.style.setProperty(`--series-${i + 1}`, c));
      restorePalette = () => PALETTE_B.forEach((_c, i) => root.style.removeProperty(`--series-${i + 1}`));
    }
    /** What a document actually stores: `buildExportStyles`' own output, taken
     *  at pin time under whatever palette was then live — provenance included. */
    const pin = (styles: Record<number, SeriesStyle>, plotted: number[] = [0]) =>
      buildExportStyles(plotted, styles);

    it("derives no palette colour when grouped", () => {
      const styles = { 0: { width: 3 } };
      expect(resolveSeriesPresentation([0], styles, [0], false, [], undefined, true))
        .toEqual([{ width: 3 }]);
      // Control: the same call, ungrouped, DOES carry the slot — and carries
      // no provenance flag onto the wire.
      expect(resolveSeriesPresentation([0], styles, [0], false, [], undefined, false))
        .toEqual([{ color: TEST_SERIES_PALETTE[0], width: 3 }]);
    });

    it("strips a PINNED derived colour when grouped after a THEME FLIP, and only the colour", () => {
      const pinned = pin({ 0: { width: 2, line: "dashed" } });
      flipTheme();
      expect(resolveSeriesPresentation([0], {}, [0], false, [], pinned, true))
        .toEqual([{ width: 2, line: "dashed" }]);
      // The document is never mutated by the wire rules.
      expect(pinned[0]?.color).toBe(TEST_SERIES_PALETTE[0]);
    });

    it("keeps a PINNED explicit colour when grouped after a PALETTE PRESET switch", () => {
      const pinned = pin({ 0: { color: "#ffe066", width: 2 } });
      flipTheme();
      expect(resolveSeriesPresentation([0], {}, [0], false, [], pinned, true))
        .toEqual([{ color: "#ffe066", width: 2 }]);
    });

    it("strips the derived colour at the `allowExplicitXAsY` positions the document really gets", () => {
      // Round-2 review F2, row 1, and the DEFAULT document path:
      // `buildFigureSpecFromDocument` passes `allowExplicitXAsY` always, so a
      // doc with `xKey:1, yKeys:[1,2]` resolves positions `[1,0]` while the
      // pinned array was built in index order. Round 2 compared the pin's
      // entry 0 against slot 1 and shipped both colours.
      const { plotted, positions } = resolveDisplaySeries(data, view({
        yKeys: [1, 2], xKey: 1, allowExplicitXAsY: true,
      }));
      expect(positions).toEqual([1, 0]); // the shifted space, non-vacuously
      const pinned = pin({}, plotted);
      expect(resolveSeriesPresentation(plotted, {}, positions, false, [], pinned, true))
        .toEqual([null, null]);
    });

    it("strips the derived colour of a channel HIDDEN after the pin", () => {
      // F2 row 2: pinned over three channels, one hidden before the export, so
      // the request plots two and round 2 read slots 1 and 2 against pinned
      // entries 0 and 1 — the first survived and painted every level one hue.
      const pinned = pin({}, [0, 1, 2]);
      const { displayChannels, plotted, positions } = resolveDisplaySeries(data, view({
        yKeys: [0, 1, 2], hiddenChannels: [0],
      }));
      expect([plotted, positions]).toEqual([[1, 2], [1, 2]]);
      expect(resolveSeriesPresentation(
        plotted, {}, positions, false, [], pinned, true, { displayChannels, hiddenChannels: [0] },
      )).toEqual([null, null]);
    });

    // ── round 4, review F7: a pinned array is re-cut to `y_keys` ───────────
    // `y_keys` is hidden-FILTERED; a pinned array is built over the document's
    // whole display list. Before this the two were shipped at different
    // lengths and the backend read `styles[0]` — the HIDDEN channel's style —
    // for the first plotted series. Measured then: pin three colours for
    // channels 0/1/2, hide channel 0, and all three entries went on the wire
    // against a two-entry `y_keys`.
    it("re-aligns a PINNED array to `y_keys` when a channel was hidden after the pin", () => {
      const pinned: (ExportSeriesStyle | null)[] = [
        { color: "#aa0000", colorDerived: false },
        { color: "#00aa00", colorDerived: false },
        { color: "#0000aa", colorDerived: false },
      ];
      const { displayChannels, plotted, positions } = resolveDisplaySeries(data, view({
        yKeys: [0, 1, 2], hiddenChannels: [0],
      }));
      expect([displayChannels, plotted]).toEqual([[0, 1, 2], [1, 2]]); // non-vacuous
      // Entry 0 stays with channel 0 — which is not plotted, so it is dropped
      // rather than sliding onto channel 1.
      expect(resolveSeriesPresentation(
        plotted, {}, positions, false, [], pinned, false, { displayChannels, hiddenChannels: [0] },
      )).toEqual([{ color: "#00aa00" }, { color: "#0000aa" }]);
      // The legend overlay rides the same re-cut list, so a rename lands on
      // the series it names rather than one slot early.
      expect(resolveSeriesPresentation(
        plotted, {}, positions, false, ["B", "C"], pinned, false, { displayChannels, hiddenChannels: [0] },
      )).toEqual([{ color: "#00aa00", legend: "B" }, { color: "#0000aa", legend: "C" }]);
    });

    it("fails closed: a pin of a DIFFERENT length is left exactly as it was", () => {
      // The projection is index-for-index against the request's own display
      // list. A template or a stale pin that matches neither length is not
      // re-cut on a guess — that is the named residual, not a silent re-cut.
      const pinned: (ExportSeriesStyle | null)[] = [{ color: "#aa0000", colorDerived: false }];
      const { displayChannels, plotted, positions } = resolveDisplaySeries(data, view({
        yKeys: [0, 1, 2], hiddenChannels: [0],
      }));
      expect(resolveSeriesPresentation(
        plotted, {}, positions, false, [], pinned, false, { displayChannels, hiddenChannels: [0] },
      )).toEqual([{ color: "#aa0000" }]);
      // …and an array already the length of `y_keys` is untouched.
      const exact: (ExportSeriesStyle | null)[] = [
        { color: "#aa0000", colorDerived: false }, { color: "#00aa00", colorDerived: false },
      ];
      expect(resolveSeriesPresentation(
        plotted, {}, positions, false, [], exact, false, { displayChannels, hiddenChannels: [0] },
      )).toEqual([{ color: "#aa0000" }, { color: "#00aa00" }]);
    });

    it("filters the pin by CHANNEL, not by index \u2014 a hidden channel 5 is not entry 5", () => {
      // The re-cut drops the pin entries whose DISPLAY CHANNEL is hidden. A
      // filter written against the entry index instead would be identical
      // whenever the display list happens to be [0,1,2,\u2026] and wrong for every
      // other selection \u2014 which is most of them, since `yKeys` names channels.
      const pinned: (ExportSeriesStyle | null)[] = [
        { color: "#aa0000", colorDerived: false },
        { color: "#00aa00", colorDerived: false },
        { color: "#0000aa", colorDerived: false },
      ];
      const { displayChannels, plotted, positions } = resolveDisplaySeries(data, view({
        yKeys: [3, 1, 2], hiddenChannels: [3],
      }));
      expect([displayChannels, plotted]).toEqual([[3, 1, 2], [1, 2]]); // non-vacuous
      expect(resolveSeriesPresentation(
        plotted, {}, positions, false, [], pinned, false,
        { displayChannels, hiddenChannels: [3] },
      )).toEqual([{ color: "#00aa00" }, { color: "#0000aa" }]);
    });

    it("keeps BOTH copies of a duplicated channel, and hides both together", () => {
      // `yKeys` may name the same channel twice (`figureDocument.integerList`
      // does not dedupe) and `resolveDisplaySeries` gives each occurrence its
      // own slot, so the pin has an entry for each. A re-cut that searched for
      // the channel instead of filtering index-for-index would collapse them.
      const pinned: (ExportSeriesStyle | null)[] = [
        { color: "#aa0000", colorDerived: false },
        { color: "#00aa00", colorDerived: false },
        { color: "#0000aa", colorDerived: false },
      ];
      const kept = resolveDisplaySeries(data, view({ yKeys: [0, 1, 0], hiddenChannels: [1] }));
      expect([kept.displayChannels, kept.plotted]).toEqual([[0, 1, 0], [0, 0]]);
      expect(resolveSeriesPresentation(
        kept.plotted, {}, kept.positions, false, [], pinned, false,
        { displayChannels: kept.displayChannels, hiddenChannels: [1] },
      )).toEqual([{ color: "#aa0000" }, { color: "#0000aa" }]);
      // Hiding the DUPLICATED channel drops both of its entries, exactly as
      // `resolveDisplaySeries` drops both of its occurrences.
      const dup = resolveDisplaySeries(data, view({ yKeys: [0, 1, 0], hiddenChannels: [0] }));
      expect(dup.plotted).toEqual([1]);
      expect(resolveSeriesPresentation(
        dup.plotted, {}, dup.positions, false, [], pinned, false,
        { displayChannels: dup.displayChannels, hiddenChannels: [0] },
      )).toEqual([{ color: "#00aa00" }]);
    });

    it("sends a pin of a DIFFERENT length whole, legends and all \u2014 the recorded residual", () => {
      // The one fail-closed path left, measured rather than described. A pin
      // taken against a different channel SELECTION has no index-for-index
      // correspondence to filter, so it is left alone \u2014 and the BUG-014 legend
      // overlay rides that same un-recut array, which is how a 4-entry pin
      // reaches a 2-entry `y_keys` with the renames on entries 0 and 1. That
      // is the pre-BUG-016 shape and it is what the BUG-016 residual names;
      // re-cutting it on a guess would be the silent corruption instead.
      const pinned: (ExportSeriesStyle | null)[] = [
        { color: "#000000", colorDerived: false }, { color: "#000001", colorDerived: false },
        { color: "#000002", colorDerived: false }, { color: "#000003", colorDerived: false },
      ];
      const { displayChannels, plotted, positions } = resolveDisplaySeries(data, view({
        yKeys: [0, 1, 2], hiddenChannels: [0],
      }));
      expect(plotted).toEqual([1, 2]); // two `y_keys`, four pin entries
      expect(resolveSeriesPresentation(
        plotted, {}, positions, false, ["L1", "L2"], pinned, false,
        { displayChannels, hiddenChannels: [0] },
      )).toEqual([
        { color: "#000000", legend: "L1" }, { color: "#000001", legend: "L2" },
        { color: "#000002" }, { color: "#000003" },
      ]);
    });

    it("passes a pin through untouched when the caller supplies NO alignment", () => {
      // Every caller but `figureSpec.ts` \u2014 and `figureSpec.ts` itself before
      // round 4 \u2014 has no display list to cut against, so the pin is the
      // request's array as-is.
      const pinned: (ExportSeriesStyle | null)[] = [
        { color: "#aa0000", colorDerived: false },
        { color: "#00aa00", colorDerived: false },
        { color: "#0000aa", colorDerived: false },
      ];
      expect(resolveSeriesPresentation([1, 2], {}, [1, 2], false, [], pinned, false))
        .toEqual([{ color: "#aa0000" }, { color: "#00aa00" }, { color: "#0000aa" }]);
    });

    it("leaves a pinned FLAT request's colours as pinned, even under a palette switch", () => {
      const pinned = pin({ 1: { color: "#ffe066" } }, [0, 1]);
      flipTheme();
      expect(resolveSeriesPresentation([0, 1], {}, [0, 1], false, [], pinned, false))
        .toEqual([{ color: TEST_SERIES_PALETTE[0] }, { color: "#ffe066" }]);
    });

    it("still lays a legend rename over a stripped entry", () => {
      const pinned = pin({ 0: { width: 2 } });
      flipTheme();
      expect(resolveSeriesPresentation([0], {}, [0], false, ["Loop 1"], pinned, true))
        .toEqual([{ width: 2, legend: "Loop 1" }]);
    });

    it("sends no `colorDerived` on either branch — it is a document field, not a wire field", () => {
      const derived = resolveSeriesPresentation([0], {}, [0], false, [], undefined, false)!;
      const pinnedOut = resolveSeriesPresentation([0], {}, [0], false, [], pin({ 0: { width: 2 } }), false)!;
      for (const entry of [...derived, ...pinnedOut]) {
        expect(Object.keys(entry ?? {})).not.toContain("colorDerived");
      }
      expect(derived[0]?.color).toBe(TEST_SERIES_PALETTE[0]); // non-vacuous
    });
  });
});
