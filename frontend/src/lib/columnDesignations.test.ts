// Origin-replacement audit items 1 and 9: a book's default plot follows its
// column designations (Label/Disregard never plotted; a Y on a secondary X is
// never drawn against the first X; an X error belongs to the Y it follows),
// and the worksheet's "Set As" overrides feed the same readers.

import { describe, expect, it } from "vitest";

import { effectiveDesignations, ORIGIN_DESIGNATIONS } from "./columnmeta";
import { ownXSeries } from "./ownXSeries";
import { sanitizeColumnDesignations } from "./columnDesignationsSanitize";
import { bookDefaultHiddenChannels, buildErrorSpans, originErrKeys, originHiddenChannels } from "./errorbars";
import { originBookErrorRoles } from "./originBookRoles";
import { initialQuickFigureMapping } from "./quickFigureMappingActions";
import { hasDesignatedSeriesX } from "./quickPlot";
import { quickPlotSeriesXSeed } from "./quickPlotSeriesX";
import type { DataStruct, Dataset } from "./types";

// The audit's specimen layout: X(A) Signal(Y) SigErr(yErr) TimeErr(xErr)
// RunNo(Label) Junk(Disregard) X2(X) Signal2(Y).
const LABELS = ["Signal", "SigErr", "TimeErr", "RunNo", "Junk", "X2", "Signal2"];
const desig = (): DataStruct => ({
  time: [0, 1, 2],
  values: [
    [0, 0.1, 0.2, 1, 5, 10, 1],
    [1, 0.1, 0.2, 2, 6, 20, 0],
    [0, 0.1, 0.2, 3, 7, 30, -1],
  ],
  labels: LABELS,
  units: LABELS.map(() => "V"),
  metadata: {
    origin_book: "Desig",
    origin_column_names: ["B", "C", "D", "E", "F", "G", "H"],
    column_designations: {
      A: "X", B: "Y", C: "Y-error", D: "X-error", E: "label", F: "disregard", G: "X", H: "Y",
    },
  },
});
const plain = (): DataStruct => ({
  time: [0, 1],
  values: [
    [1, 2, 3, 4],
    [2, 3, 4, 5],
  ],
  labels: ["a", "b", "c", "d"],
  units: ["", "", "", ""],
  metadata: {},
});

describe("book default plot follows the designations (audit item 1)", () => {
  it("never plots Label or Disregard columns", () => {
    const hidden = originHiddenChannels(desig());
    expect(hidden).toContain(3); // RunNo, label
    expect(hidden).toContain(4); // Junk, disregard
    expect(hidden).not.toContain(0);
  });

  it("plots a Y that belongs to a secondary X (drawn on its own X, lib/perSeriesX.ts), hides the X itself", () => {
    const ds: Dataset = { id: "d", name: "desig", data: desig() };
    expect(ownXSeries(effectiveDesignations(ds.data))).toEqual({ 6: 5 });
    expect(bookDefaultHiddenChannels(ds)).toEqual([1, 2, 3, 4, 5]);
  });

  it("Quick Plot still draws that Y, against its OWN X", () => {
    const data = { ...desig(), metadata: { ...desig().metadata, technique: "transport" } };
    const ds: Dataset = { id: "d", name: "desig", data, ...originBookErrorRoles(data) };
    expect(hasDesignatedSeriesX(ds)).toBe(true);
    const seed = quickPlotSeriesXSeed(ds);
    expect(seed).not.toBeNull();
    expect(seed!.overlay.blocks).toEqual([null, 5]);
    // Signal on the shared X, Signal2 on X2 -- and neither RunNo nor Junk.
    expect(seed!.overlay.data.labels.slice(0, 2)).toEqual(["Signal", "Signal2"]);
  });

  it("generic data: the Quick Figure Builder pairs that Y with its own X, never Label/Disregard", () => {
    const ds: Dataset = { id: "d", name: "desig", data: desig(), ...originBookErrorRoles(desig()) };
    const mapping = initialQuickFigureMapping(ds);
    expect(mapping.xKeyByY).toEqual({ 6: 5 });
    expect(mapping.yKeys).toEqual([0, 6]);
  });

  it("draws an X error only on the series it belongs to", () => {
    const data = desig();
    const roles = originBookErrorRoles(data)!.errorRoles;
    const spans = buildErrorSpans(data, [0, 6], roles);
    expect(spans.get(1)?.map((s) => s.axis).sort()).toEqual(["x", "y"]); // Signal: its own yErr + xErr
    expect(spans.get(2)).toBeUndefined(); // Signal2: no x-whiskers borrowed from Signal
  });

  it("an axis-wide X error (target -1) still applies to every plotted series", () => {
    const data = desig();
    const spans = buildErrorSpans(data, [0, 6], [{ channel: 2, target: -1, axis: "x", side: "both" }]);
    expect(spans.get(1)?.[0].axis).toBe("x");
    expect(spans.get(2)?.[0].axis).toBe("x");
  });
});

describe("user Set As designations (audit item 9)", () => {
  it("override the book's own designations for every plotting default", () => {
    const data = desig();
    // Junk (disregard) -> Y; Signal2 -> label.
    const user = { 4: "Y", 6: "label" } as const;
    expect(effectiveDesignations(data, user)[4]).toBe("Y");
    const hidden = originHiddenChannels(data, user);
    expect(hidden).not.toContain(4);
    expect(hidden).toContain(6);
  });

  it("apply to a non-Origin dataset too", () => {
    const data = plain();
    expect(originHiddenChannels(data)).toEqual([]);
    const user = { 1: "Y-error", 2: "X" } as const;
    expect(originHiddenChannels(data, user)).toEqual([1, 2]);
    expect(originErrKeys(data, user)).toEqual({}); // channel 0 has no "Y" designation to pair
    expect(ownXSeries(effectiveDesignations(data, user))).toEqual({ 3: 2 });
  });

  it("the loader's designation list matches columnmeta's ORIGIN_DESIGNATIONS", () => {
    for (const d of ORIGIN_DESIGNATIONS) expect(sanitizeColumnDesignations({ 0: d }, 1)).toEqual({ 0: d });
  });

  it("are sanitized: unknown designations and out-of-range or non-integer keys drop", () => {
    expect(sanitizeColumnDesignations({ 0: "X", 1: "bogus", 9: "Y", "1.5": "Y", "-1": "Y" }, 4)).toEqual({ 0: "X" });
    expect(sanitizeColumnDesignations({ 5: "Y" }, 4)).toBeUndefined();
    expect(sanitizeColumnDesignations("nope", 4)).toBeUndefined();
    expect(sanitizeColumnDesignations([1, 2], 4)).toBeUndefined();
  });
});
