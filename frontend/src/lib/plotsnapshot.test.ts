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
  thawEntries,
  thawList,
  type LivePlotSnapshot,
} from "./plotsnapshot";
import type { SeriesStyle } from "./types";
import { encodePersistedCells } from "./nonFiniteCells";

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
    colorByColumns: new Map([[1, { channel: 2, z: [0.1, 0.2, null], colormap: "viridis", lo: 0, hi: 1 }]]),
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
    expect(frozen.colorByColumns).toEqual([
      [1, { channel: 2, z: [0.1, 0.2, null], colormap: "viridis", lo: 0, hi: 1 }],
    ]);
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
    s.colorByColumns.get(1)!.z[0] = 9.9;
    expect(frozen.payload.data[1][0]).toBe(10);
    expect(frozen.payload.series[0].label).toBe("m");
    expect(frozen.errorBars[0][1][0]).toBe(0.1);
    expect(frozen.colorByColumns[0][1].z[0]).toBe(0.1);
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
    expect(thawEntries(frozen.errorBars)).toEqual(s.errorBars);
    expect(thawList(frozen.styleList)).toEqual(s.styleList);
    expect(thawList(frozen.labelList)).toEqual(s.labelList);
    expect(thawEntries(frozen.colorByColumns)).toEqual(s.colorByColumns);
  });

  it("thaws null decorations to undefined", () => {
    expect(thawList(null)).toBeUndefined();
    expect(thawEntries([]).size).toBe(0);
  });
});

describe("sanitizeFrozenBundle (the untrusted-.dwk boundary)", () => {
  it("accepts a frozen bundle round-tripped through JSON", () => {
    const frozen = freezePlotSnapshot(live());
    const json = JSON.stringify(frozen, encodePersistedCells);
    expect(json).toBe(JSON.stringify(frozen));
    const out = sanitizeFrozenBundle(JSON.parse(json));
    expect(out).toEqual(frozen);
  });

  it("directly encodes/decodes NaN, ±Infinity, and -0 without changing null gaps", () => {
    const source = live();
    source.payload.data = [
      [Number.NaN, Infinity, -Infinity, -0, null],
      [1, Number.NaN, Infinity, -Infinity, -0],
    ] as LivePlotSnapshot["payload"]["data"];
    source.errorBars = new Map([[1, [Number.NaN, Infinity, -Infinity, -0, null]]]);
    source.colorByColumns = new Map([[
      1,
      {
        channel: 2,
        z: [Number.NaN, Infinity, -Infinity, -0, null],
        colormap: "viridis",
        lo: 0,
        hi: 1,
      },
    ]]);
    const frozen = freezePlotSnapshot(source);
    const json = JSON.stringify(frozen, encodePersistedCells);
    const restored = sanitizeFrozenBundle(JSON.parse(json))!;

    const payload = restored.payload.data as (number | null)[][];
    expect(payload[0][0]).toBeNaN();
    expect(payload[0][1]).toBe(Infinity);
    expect(payload[0][2]).toBe(-Infinity);
    expect(Object.is(payload[0][3], -0)).toBe(true);
    expect(payload[0][4]).toBeNull();
    expect(restored.errorBars[0][1][0]).toBeNaN();
    expect(restored.errorBars[0][1][1]).toBe(Infinity);
    expect(restored.errorBars[0][1][2]).toBe(-Infinity);
    expect(Object.is(restored.errorBars[0][1][3], -0)).toBe(true);
    expect(restored.errorBars[0][1][4]).toBeNull();
    const z = restored.colorByColumns[0][1].z;
    expect(z[0]).toBeNaN();
    expect(z[1]).toBe(Infinity);
    expect(z[2]).toBe(-Infinity);
    expect(Object.is(z[3], -0)).toBe(true);
    expect(z[4]).toBeNull();
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
    // Absent plotted/colorByColumns degrade to empty, never drop the bundle.
    expect(out!.plotted).toEqual([]);
    expect(out!.colorByColumns).toEqual([]);
  });
});
