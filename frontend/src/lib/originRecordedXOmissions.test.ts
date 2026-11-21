import { describe, expect, it } from "vitest";

import { recordedXOmissions } from "./originRecordedX";
import type { Dataset, OriginFigure } from "./types";

const book = (name: string, text: Record<string, string[]> = {}) => ({
  id: name, name,
  data: {
    time: [0, 1], values: [[1, 2], [3, 4]], labels: ["B", "C"], units: ["", ""],
    metadata: {
      origin_book: name, origin_column_names: ["B", "C"], x_column_name: "A", column_designations: { A: "X" },
      origin_text_columns: text,
    },
  },
}) as unknown as Dataset;
const ds = book("Book1");
const fig = (curves: unknown[]) => ({ curves } as unknown as OriginFigure);

describe("recordedXOmissions", () => {
  it("fires for a curve whose RECORDED X did not import", () => {
    expect(recordedXOmissions(fig([{ book: "Book1", x: "Q", y: "B", xRecorded: true }]), ds))
      .toEqual(["Book1 column B (X Q did not import)"]);
  });
  it("is silent for an INFERRED X (no xRecorded)", () => {
    expect(recordedXOmissions(fig([{ book: "Book1", x: "Q", y: "B" }]), ds)).toEqual([]);
  });
  it("names an imported TEXT X as such, not as a column that did not import", () => {
    const withText = book("Book1", { D: ["a", "b"] });
    const mixed = fig([
      { book: "Book1", x: "D", y: "B", xRecorded: true },
      { book: "Book1", x: "A", y: "C", xRecorded: true },
    ]);
    expect(recordedXOmissions(mixed, withText)).toEqual(["Book1 column B (text X D: the layer's X is not one category axis)"]);
    const allText = fig([{ book: "Book1", x: "D", y: "B", xRecorded: true }, { book: "Book1", x: "D", y: "C", xRecorded: true }]);
    expect(recordedXOmissions(allText, withText)).toEqual([]); // drawn over its categories
  });
  it("reports a cross-book layer's other books too", () => {
    const b1 = book("Book1", { D: ["a", "b"] });
    const b2 = book("Book2", { D: ["x", "y"] }); // different cells: not one category axis
    const layer = fig([
      { book: "Book1", x: "D", y: "B", xRecorded: true },
      { book: "Book2", x: "D", y: "B", xRecorded: true },
      { book: "Book2", x: "Q", y: "C", xRecorded: true },
    ]);
    expect(recordedXOmissions(layer, [b1, b2])).toEqual([
      "Book1 column B (text X D: the layer's X is not one category axis)",
      "Book2 column B (text X D: the layer's X is not one category axis)",
      "Book2 column C (X Q did not import)",
    ]);
    const same = book("Book2", { D: ["a", "b"] });
    expect(recordedXOmissions(fig([
      { book: "Book1", x: "D", y: "B", xRecorded: true }, { book: "Book2", x: "D", y: "C", xRecorded: true },
    ]), [b1, same])).toEqual([]);
  });
});
