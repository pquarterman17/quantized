import { describe, expect, it, vi } from "vitest";

import { buildExportStyles } from "./exportStyles";
import type { PlotPayload } from "./plotdata";
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
   *  each survivor's position in the UNFILTERED display list. */
  const exportSpecs = (styles: Record<number, SeriesStyle>, on: boolean, hidden: number[] = []) => {
    const visible = PLOTTED.filter((ch) => !hidden.includes(ch));
    return buildExportStyles(visible, styles, on ? visible.map((ch) => PLOTTED.indexOf(ch)) : null);
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

  it("OFF: a hidden series leaves the export byte-identical to before the cycle", () => {
    // The invariant the cycle must not quietly buy its correctness with: with
    // the preference off, `buildExportStyles` is exactly the two-argument
    // function it was — palette skew and all.
    const styles: Record<number, SeriesStyle> = { 1: { width: 3 }, 2: { line: "dotted" } };
    const visible = PLOTTED.filter((ch) => ch !== 0);
    expect(exportSpecs(styles, false, [0])).toEqual(buildExportStyles(visible, styles));
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
});
