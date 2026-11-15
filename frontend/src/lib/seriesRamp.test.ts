// Origin gap audit 4 G1: the colour gradient across N curves. The resolver,
// its gate, its persistence (store undo, graph templates) and the 8-colour
// repeat it lifts. Screen == export is pinned by
// `seriesRampSymbolsBandFixture.test.ts` (shared with the backend).

import { describe, expect, it } from "vitest";

import { useApp } from "../store/useApp";
import { resolveDrawColor } from "./contrastColor";
import { captureGraphFormat, graphFormatPatch, sanitizeGraphFormat } from "./graphFormat";
import { defaultPlotView, sanitizePlotView } from "./plotview";
import { RAMP_MAPS, sanitizeSeriesRamp } from "./seriesRamp";
import { rampApplies, rampColor, rampSeriesStyles, valueRanks, windowRampApplies } from "./seriesRampImpl";
import { seriesColor, windowCyclesSeriesStyles } from "./seriesStyleCycle";

const view = { ...defaultPlotView(), seriesRamp: { map: "viridis" as const } };

describe("the ramp resolver", () => {
  it("lifts the 8-colour repeat: 20 curves are 20 distinct colours (the palette repeats at 9)", () => {
    const n = 20;
    const ramp = Array.from({ length: n }, (_, k) => rampColor({ map: "viridis" }, k, n));
    expect(new Set(ramp).size).toBe(n);
    expect(seriesColor(8)).toBe(seriesColor(0)); // the palette alone wraps
  });

  it("every map, every sample, reads on the dark AND the light canvas (never swapped for ink)", () => {
    for (const map of RAMP_MAPS) {
      for (const reverse of [false, true]) {
        for (let k = 0; k < 33; k++) {
          const hex = rampColor({ map, reverse }, k, 33);
          expect(hex).toMatch(/^#[0-9a-f]{6}$/);
          expect(resolveDrawColor(hex, true), `${map} ${k} dark`).toBe(hex);
          expect(resolveDrawColor(hex, false), `${map} ${k} light`).toBe(hex);
        }
      }
    }
  });

  it("reverse flips the run; one curve takes the start", () => {
    expect(rampColor({ map: "plasma", reverse: true }, 0, 5)).toBe(rampColor({ map: "plasma" }, 4, 5));
    expect(rampColor({ map: "plasma" }, 0, 1)).toBe(rampColor({ map: "plasma" }, 0, 5));
  });

  it("orders by the number in each label only when every label has a distinct one", () => {
    expect(valueRanks(["M 300 K", "M 2 K", "M 1.5e1 K"])).toEqual([2, 0, 1]);
    expect(valueRanks(["T=-5", "T=5"])).toEqual([0, 1]);
    expect(valueRanks(["M 300 K", "M"])).toBeNull();
    expect(valueRanks(["5 K", "5 K"])).toBeNull();
    const styles = rampSeriesStyles({}, [7, 8], { map: "turbo", order: "value" }, (ch) => (ch === 7 ? "10 K" : "2 K"));
    expect(styles[8].color).toBe(rampColor({ map: "turbo" }, 0, 2));
    expect(styles[7].color).toBe(rampColor({ map: "turbo" }, 1, 2));
  });

  it("a curve with its own colour keeps it but keeps its slot; other style fields survive", () => {
    const out = rampSeriesStyles({ 1: { color: "--series-3" }, 2: { width: 3 } }, [0, 1, 2], { map: "magma" }, () => "");
    expect(out[1].color).toBe("--series-3");
    expect(out[0].color).toBe(rampColor({ map: "magma" }, 0, 3));
    expect(out[2]).toEqual({ width: 3, color: rampColor({ map: "magma" }, 2, 3) });
  });
});

describe("the gate (one predicate, canvas and export)", () => {
  it("applies to a plain overlay and refuses the views whose export does not follow", () => {
    expect(rampApplies(view, false, false)).toBe(true);
    expect(rampApplies({ ...view, seriesRamp: null }, false, false)).toBe(false);
    for (const patch of [{ groupKey: 1 }, { facetKey: 1 }, { stackMode: true }, { polarMode: true }, { statMode: true }]) {
      expect(rampApplies({ ...view, ...patch }, false, false), JSON.stringify(patch)).toBe(false);
    }
    expect(rampApplies(view, true, false)).toBe(false); // pinned publication styles
    expect(rampApplies(view, false, true)).toBe(false); // Color / Symbol / Label encodings
    expect(windowRampApplies(view, { publication: { seriesStyles: null } })).toBe(false);
    expect(windowRampApplies(view, { bindings: { encoding: {} } })).toBe(false);
    expect(windowRampApplies(view, undefined)).toBe(true);
  });

  it("a gradient never repeats a hue, so 12 curves do not engage the dash cycle past the palette", () => {
    expect(windowCyclesSeriesStyles(false, { ...view, seriesRamp: null }, undefined, 12)).toBe(true);
    expect(windowCyclesSeriesStyles(false, view, undefined, 12)).toBe(false);
    expect(windowCyclesSeriesStyles(true, view, undefined, 12)).toBe(true); // the preference still cycles
  });
});

describe("persistence", () => {
  it("sanitizes untrusted input and survives a .dwk view", () => {
    expect(sanitizeSeriesRamp({ map: "cividis", reverse: true, order: "value" })).toEqual({ map: "cividis", reverse: true, order: "value" });
    expect(sanitizeSeriesRamp({ map: "jet" })).toBeNull();
    expect(sanitizeSeriesRamp({ map: "viridis", reverse: "yes", order: "x" })).toEqual({ map: "viridis" });
    expect(sanitizePlotView({ seriesRamp: { map: "turbo" } }).seriesRamp).toEqual({ map: "turbo" });
    expect(sanitizePlotView({}).seriesRamp).toBeNull(); // an older .dwk
  });

  it("is one undo step in the store", () => {
    useApp.setState({ seriesRamp: null, history: [], future: [] });
    useApp.getState().setSeriesRamp({ map: "plasma" });
    expect(useApp.getState().seriesRamp).toEqual({ map: "plasma" });
    expect(useApp.getState().history.map((h) => h.label)).toEqual(["colour gradient"]);
    useApp.getState().undo();
    expect(useApp.getState().seriesRamp).toBeNull();
  });

  it("rides a graph template / Copy Format; a format from before gradients leaves the target's alone", () => {
    const format = captureGraphFormat({ ...view, seriesRamp: { map: "coolwarm", reverse: true } }, [0, 1]);
    const back = sanitizeGraphFormat(JSON.parse(JSON.stringify(format)));
    expect(back?.seriesRamp).toEqual({ map: "coolwarm", reverse: true });
    expect(graphFormatPatch(back!, [0, 1], {}).seriesRamp).toEqual({ map: "coolwarm", reverse: true });
    const none = sanitizeGraphFormat(JSON.parse(JSON.stringify(captureGraphFormat({ ...view, seriesRamp: null }, [0]))));
    expect(graphFormatPatch(none!, [0], {}).seriesRamp).toBeNull(); // a template saved WITHOUT one clears it
    const { seriesRamp: _r, ...old } = JSON.parse(JSON.stringify(format)) as Record<string, unknown>;
    void _r;
    expect("seriesRamp" in graphFormatPatch(sanitizeGraphFormat(old)!, [0], {})).toBe(false);
  });
});
