import { describe, expect, it } from "vitest";

import { resolveSelectionPlot } from "./selectionplot";
import type { DataStruct } from "./types";

/** An Origin-shaped reflectometry-like book: A (consumed as time, not a value
 *  channel), R++ is Y with a comment, dR++ is its Y-error pair, Sample is a
 *  Label column, X2 is a secondary "X" designation (multi-XY sheet), Junk is
 *  an X-error nobody pairs to. */
const originData: DataStruct = {
  time: [1, 2, 3],
  values: [
    [10, 0.5, 1, 100, 0.1],
    [20, 0.6, 1, 200, 0.1],
    [30, 0.7, 1, 300, 0.1],
  ],
  labels: ["R++", "dR++", "Sample", "X2", "Junk"],
  units: ["", "", "", "", ""],
  metadata: {
    origin_column_names: ["R++", "dR++", "Sample", "X2", "Junk"],
    column_designations: { A: "X", "R++": "Y", "dR++": "Y-error", Sample: "Label", X2: "X", Junk: "X-error" },
  },
};

// Plain (non-Origin) 3-channel dataset — no designations at all.
const plain: DataStruct = {
  time: [0, 1, 2],
  values: [
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
  ],
  labels: ["A", "B", "C"],
  units: ["", "", ""],
  metadata: {},
};

const NO_AXIS = { xKey: null, yKeys: null };

describe("resolveSelectionPlot", () => {
  it("is a no-op for an empty selection", () => {
    expect(resolveSelectionPlot(plain, new Set(), NO_AXIS, "replace")).toEqual({
      actions: [],
      summary: "no columns selected",
    });
  });

  it("plots plain (undesignated) selected columns as Y, in ascending order", () => {
    const result = resolveSelectionPlot(plain, new Set([2, 0]), NO_AXIS, "replace");
    expect(result.actions).toEqual([{ kind: "setYKeys", yKeys: [0, 2] }]);
  });

  it("leaves xKey untouched when nothing in the selection resolves an X", () => {
    const result = resolveSelectionPlot(plain, new Set([0]), { xKey: 1, yKeys: null }, "replace");
    expect(result.actions.some((a) => a.kind === "setXKey")).toBe(false);
  });

  it("an X-designated selected column wins as the new X axis", () => {
    const result = resolveSelectionPlot(originData, new Set([3, 0]), NO_AXIS, "replace"); // X2, R++
    expect(result.actions).toContainEqual({ kind: "setXKey", xKey: 3 });
    expect(result.actions).toContainEqual({ kind: "setYKeys", yKeys: [0] }); // X2 excluded from Y
  });

  it("selecting the pinned x/time column (-1) with no X-designated value column resets xKey to null", () => {
    const result = resolveSelectionPlot(originData, new Set([-1, 0]), { xKey: 3, yKeys: null }, "replace");
    expect(result.actions).toContainEqual({ kind: "setXKey", xKey: null });
  });

  it("a Y-error column pairs to the nearest preceding selected Y (originErrKeys rule)", () => {
    const result = resolveSelectionPlot(originData, new Set([0, 1]), NO_AXIS, "replace"); // R++, dR++
    expect(result.actions).toContainEqual({ kind: "setYKeys", yKeys: [0] });
    expect(result.actions).toContainEqual({ kind: "setErrKey", channel: 0, errChannel: 1 });
  });

  it("a Y-error column with no preceding selected Y is dropped silently (never plotted)", () => {
    const result = resolveSelectionPlot(originData, new Set([1]), NO_AXIS, "replace"); // dR++ alone
    expect(result.actions.some((a) => a.kind === "setYKeys")).toBe(false);
    expect(result.actions.some((a) => a.kind === "setErrKey")).toBe(false);
    expect(result.summary).toBe("nothing plottable in the selection");
  });

  it("Label and X-error columns are never plotted, even when explicitly selected", () => {
    const result = resolveSelectionPlot(originData, new Set([2, 4]), NO_AXIS, "replace"); // Sample, Junk
    expect(result.actions).toEqual([]);
  });

  it("a secondary X designation is excluded from Y even when it isn't a NEW X", () => {
    const result = resolveSelectionPlot(originData, new Set([0, 3]), { xKey: 3, yKeys: null }, "replace");
    // X2 (col 3) already IS xKey — resolving to the same value collapses to
    // "no change" (no spurious setXKey), but X2 still never joins Y.
    expect(result.actions.some((a) => a.kind === "setXKey")).toBe(false);
    expect(result.actions).toContainEqual({ kind: "setYKeys", yKeys: [0] });
  });

  it("resolving to the SAME xKey the store already has emits no setXKey (avoids a no-op macro step)", () => {
    const result = resolveSelectionPlot(originData, new Set([-1, 0]), { xKey: null, yKeys: null }, "replace");
    expect(result.actions.some((a) => a.kind === "setXKey")).toBe(false);
  });

  it("replace mode sets yKeys to exactly the selection's Y set", () => {
    const result = resolveSelectionPlot(plain, new Set([1]), { xKey: null, yKeys: [0, 2] }, "replace");
    expect(result.actions).toContainEqual({ kind: "setYKeys", yKeys: [1] });
  });

  it("add mode unions the selection into the CURRENT explicit yKeys", () => {
    const result = resolveSelectionPlot(plain, new Set([2]), { xKey: null, yKeys: [0] }, "add");
    expect(result.actions).toContainEqual({ kind: "setYKeys", yKeys: [0, 2] });
  });

  it("add mode expands a null (auto/dense) current yKeys to its concrete default before unioning", () => {
    // plain's dense default (xKey=null) is every channel [0,1,2] (all equally dense).
    const result = resolveSelectionPlot(plain, new Set([1]), { xKey: null, yKeys: null }, "add");
    expect(result.actions).toContainEqual({ kind: "setYKeys", yKeys: [0, 1, 2] });
  });

  it("summary reports the channel count and whether X changed", () => {
    const r1 = resolveSelectionPlot(plain, new Set([0, 1]), NO_AXIS, "replace");
    expect(r1.summary).toBe("Plot selection: 2 channels");
    const r2 = resolveSelectionPlot(originData, new Set([0, 3]), NO_AXIS, "replace");
    expect(r2.summary).toContain("X updated");
    const r3 = resolveSelectionPlot(plain, new Set([1]), NO_AXIS, "add");
    expect(r3.summary).toBe("Add to plot: 1 channel"); // singular, no X change (no designations at all)
  });
});
