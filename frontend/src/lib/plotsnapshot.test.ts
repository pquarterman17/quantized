// lib/plotsnapshot — the snapshot-as-window seam + freeze/thaw + boundary
// sanitizer (MULTI_PLOT_PLAN item 11). The deep-copy tests are the "frozen
// means frozen" risk mitigation: nothing the live pipeline later does to its
// own arrays may reach a frozen bundle.

import { afterEach, describe, expect, it } from "vitest";

import {
  freezePlotSnapshot,
  publishLivePlotSnapshot,
  readLivePlotSnapshot,
  sanitizeFrozenBundle,
  thawErrorBars,
  thawLabelList,
  thawStyleList,
  type LivePlotSnapshot,
} from "./plotsnapshot";
import type { SeriesStyle } from "./types";

function live(): LivePlotSnapshot {
  return {
    payload: {
      data: [
        [0, 1, 2],
        [10, 20, null],
      ] as LivePlotSnapshot["payload"]["data"],
      series: [{ label: "m", unit: "emu", axis: 0 }],
      xLabel: "T",
      xUnit: "K",
    },
    styleList: [{ color: "#ff0000" } as SeriesStyle, undefined],
    labelList: ["moment", undefined],
    errorBars: new Map([[1, [0.1, 0.2, null]]]),
    plotted: [0],
    hidden: [false, true],
  };
}

afterEach(() => publishLivePlotSnapshot(null));

describe("the live seam (publish/read)", () => {
  it("reads back exactly what was published, and null after clearing", () => {
    expect(readLivePlotSnapshot()).toBeNull();
    const s = live();
    publishLivePlotSnapshot(s);
    expect(readLivePlotSnapshot()).toBe(s); // the seam is a plain ref, no copy
    publishLivePlotSnapshot(null);
    expect(readLivePlotSnapshot()).toBeNull();
  });
});

describe("freezePlotSnapshot", () => {
  it("normalizes to the JSON-safe at-rest shape (Map → entries, undefined → null)", () => {
    const frozen = freezePlotSnapshot(live());
    expect(frozen.errorBars).toEqual([[1, [0.1, 0.2, null]]]);
    expect(frozen.styleList).toEqual([{ color: "#ff0000" }, null]);
    expect(frozen.labelList).toEqual(["moment", null]);
    expect(frozen.plotted).toEqual([0]);
    expect(frozen.hidden).toEqual([false, true]);
    // The whole bundle must survive a JSON round-trip unchanged (it rides
    // the .dwk plotWindows persistence).
    expect(JSON.parse(JSON.stringify(frozen))).toEqual(frozen);
  });

  it("deep-copies — mutating the live bundle afterward never reaches the frozen one", () => {
    const s = live();
    const frozen = freezePlotSnapshot(s);
    (s.payload.data[1] as (number | null)[])[0] = null; // e.g. a row exclusion re-compose
    s.payload.series[0].label = "changed";
    s.errorBars.get(1)![0] = 9.9;
    expect(frozen.payload.data[1][0]).toBe(10);
    expect(frozen.payload.series[0].label).toBe("m");
    expect(frozen.errorBars[0][1][0]).toBe(0.1);
  });

  it("freezes absent decorations as null and copies xCategories when present", () => {
    const s = live();
    s.styleList = undefined;
    s.labelList = undefined;
    s.hidden = undefined;
    s.payload.xCategories = ["a", "b"];
    const frozen = freezePlotSnapshot(s);
    expect(frozen.styleList).toBeNull();
    expect(frozen.labelList).toBeNull();
    expect(frozen.hidden).toBeNull();
    expect(frozen.payload.xCategories).toEqual(["a", "b"]);
    expect(frozen.payload.xCategories).not.toBe(s.payload.xCategories);
  });
});

describe("thaw helpers (frozen → render shapes)", () => {
  it("round-trips freeze → thaw back to the render-side shapes", () => {
    const s = live();
    const frozen = freezePlotSnapshot(s);
    expect(thawErrorBars(frozen.errorBars)).toEqual(s.errorBars);
    expect(thawStyleList(frozen.styleList)).toEqual(s.styleList);
    expect(thawLabelList(frozen.labelList)).toEqual(s.labelList);
  });

  it("thaws null decorations to undefined", () => {
    expect(thawStyleList(null)).toBeUndefined();
    expect(thawLabelList(null)).toBeUndefined();
    expect(thawErrorBars([]).size).toBe(0);
  });
});

describe("sanitizeFrozenBundle (the untrusted-.dwk boundary)", () => {
  it("accepts a frozen bundle round-tripped through JSON", () => {
    const frozen = freezePlotSnapshot(live());
    const out = sanitizeFrozenBundle(JSON.parse(JSON.stringify(frozen)));
    expect(out).toEqual(frozen);
  });

  it("returns null for a malformed core payload — never throws", () => {
    expect(sanitizeFrozenBundle(null)).toBeNull();
    expect(sanitizeFrozenBundle("nope")).toBeNull();
    expect(sanitizeFrozenBundle({})).toBeNull();
    expect(sanitizeFrozenBundle({ payload: { data: "x", series: [] } })).toBeNull();
    expect(sanitizeFrozenBundle({ payload: { data: [[0]], series: [{ label: 3 }] } })).toBeNull();
    // data = [x, ...one column per series] — a count mismatch is malformed.
    expect(
      sanitizeFrozenBundle({
        payload: { data: [[0], [1], [2]], series: [{ label: "a", unit: "" }], xLabel: "x", xUnit: "" },
      }),
    ).toBeNull();
  });

  it("coerces bad cells to null and degrades malformed decorations instead of dropping the bundle", () => {
    const out = sanitizeFrozenBundle({
      payload: {
        data: [
          [0, "bad"],
          [1, 2],
        ],
        series: [{ label: "a" }],
      },
      styleList: "nope",
      labelList: [3, "ok"],
      errorBars: [[1, [0.5]], ["bad", []], null],
      hidden: [1, true],
    });
    expect(out).not.toBeNull();
    expect(out!.payload.data[0]).toEqual([0, null]);
    expect(out!.payload.series[0].unit).toBe("");
    expect(out!.payload.xLabel).toBe("x");
    expect(out!.styleList).toBeNull();
    expect(out!.labelList).toEqual([null, "ok"]);
    expect(out!.errorBars).toEqual([[1, [0.5]]]);
    expect(out!.hidden).toEqual([false, true]);
    // Absent plotted degrades to empty, never drops the bundle.
    expect(out!.plotted).toEqual([]);
  });
});
