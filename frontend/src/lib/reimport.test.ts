import { describe, expect, it, vi } from "vitest";

import type { DataStruct, Dataset } from "./types";

const fetchBookData = vi.fn();
vi.mock("./api", () => ({
  fetchBookData: (...args: unknown[]) => fetchBookData(...args),
}));

const { datasetBookId, findBook, reimportShapeChanged, resolveFreshData } = await import("./reimport");

function ds(over: Partial<Dataset> = {}): Dataset {
  return {
    id: "a",
    name: "sample.dat",
    data: {
      time: [0, 1, 2],
      values: [[10], [20], [30]],
      labels: ["m"],
      units: ["emu"],
      metadata: {},
    },
    ...over,
  };
}

const struct = (over: Partial<DataStruct> = {}): DataStruct => ({
  time: [0, 1, 2],
  values: [[11], [21], [31]],
  labels: ["m"],
  units: ["emu"],
  metadata: {},
  ...over,
});

describe("datasetBookId", () => {
  it("reads metadata.origin_book when present", () => {
    expect(datasetBookId(ds({ data: { ...ds().data, metadata: { origin_book: "Book4" } } }))).toBe("Book4");
  });

  it("is null for a non-Origin dataset", () => {
    expect(datasetBookId(ds())).toBeNull();
  });
});

describe("findBook", () => {
  it("finds a primary marker by id", () => {
    const fresh = struct({
      books: [{ lazy: false, primary: true, id: "Book1", labels: ["m"], units: ["emu"], metadata: {}, rows: 3, cols: 1 }],
    });
    expect(findBook(fresh, "Book1")?.id).toBe("Book1");
  });

  it("returns undefined when the book no longer exists", () => {
    const fresh = struct({ books: [] });
    expect(findBook(fresh, "Book9")).toBeUndefined();
  });
});

describe("reimportShapeChanged", () => {
  it("is false when rows and base columns match", () => {
    expect(reimportShapeChanged(ds(), struct())).toBe(false);
  });

  it("is true on a row-count change", () => {
    expect(reimportShapeChanged(ds(), struct({ time: [0, 1], values: [[1], [2]] }))).toBe(true);
  });

  it("is true on a column-count change", () => {
    expect(
      reimportShapeChanged(ds(), struct({ labels: ["m", "T"], units: ["emu", "K"], values: [[1, 2], [3, 4], [5, 6]] })),
    ).toBe(true);
  });

  it("compares against BASE columns, ignoring the dataset's own computed formula columns", () => {
    const withFormula = ds({
      data: {
        time: [0, 1, 2],
        values: [[10, 100], [20, 200], [30, 300]],
        labels: ["m", "computed"],
        units: ["emu", ""],
        metadata: {},
      },
      formulas: [{ name: "computed", expr: "A*10" }],
    });
    // fresh raw has only the ONE base column — matches once the formula
    // column is excluded from the comparison.
    expect(reimportShapeChanged(withFormula, struct())).toBe(false);
  });
});

describe("resolveFreshData", () => {
  it("returns the fresh top-level data for a non-Origin dataset", async () => {
    const fresh = struct();
    const result = await resolveFreshData(ds(), fresh);
    expect(result).toEqual({ time: fresh.time, values: fresh.values, labels: fresh.labels, units: fresh.units, metadata: fresh.metadata });
    expect(fetchBookData).not.toHaveBeenCalled();
  });

  it("matches a primary book marker inline (no fetch needed)", async () => {
    const bookDs = ds({ data: { ...ds().data, metadata: { origin_book: "Book1" } } });
    const fresh = struct({
      books: [
        { lazy: false, primary: true, id: "Book1", labels: ["x"], units: ["V"], metadata: { origin_book: "Book1" }, rows: 3, cols: 1 },
      ],
    });
    const result = await resolveFreshData(bookDs, fresh);
    expect(result.labels).toEqual(["x"]);
    expect(fetchBookData).not.toHaveBeenCalled();
  });

  it("fetches a lazy (non-primary) book's full data via the book source", async () => {
    const bookDs = ds({ data: { ...ds().data, metadata: { origin_book: "Book2" } } });
    const fresh = struct({
      book_source: { kind: "path", path: "/data/proj.opj" },
      books: [
        {
          lazy: true,
          id: "Book2",
          labels: ["y"],
          units: ["Oe"],
          metadata: {},
          rows: 500,
          cols: 1,
          preview: { time: [0], values: [[1]] },
        },
      ],
    });
    const full = struct({ labels: ["y"], values: [[7], [8], [9]] });
    fetchBookData.mockResolvedValueOnce(full);
    const result = await resolveFreshData(bookDs, fresh);
    expect(fetchBookData).toHaveBeenCalledWith({
      kind: "path",
      path: "/data/proj.opj",
      bookId: "Book2",
      rows: 500,
      cols: 1,
    });
    expect(result).toBe(full);
  });

  it("throws when the dataset's book no longer exists in the refreshed file", async () => {
    const bookDs = ds({ data: { ...ds().data, metadata: { origin_book: "Book9" } } });
    const fresh = struct({
      books: [
        { lazy: false, primary: true, id: "Book1", labels: ["m"], units: ["emu"], metadata: {}, rows: 3, cols: 1 },
      ],
    });
    await expect(resolveFreshData(bookDs, fresh)).rejects.toThrow(/no longer exists/);
  });

  it("throws when a lazy book's file is missing its book source reference", async () => {
    const bookDs = ds({ data: { ...ds().data, metadata: { origin_book: "Book2" } } });
    const fresh = struct({
      books: [
        { lazy: true, id: "Book2", labels: ["y"], units: ["Oe"], metadata: {}, rows: 500, cols: 1, preview: { time: [0], values: [[1]] } },
      ],
    });
    await expect(resolveFreshData(bookDs, fresh)).rejects.toThrow(/book source/);
  });
});
