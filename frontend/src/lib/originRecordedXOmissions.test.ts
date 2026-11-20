import { describe, expect, it } from "vitest";

import { recordedXOmissions } from "./originRecordedX";
import type { Dataset, OriginFigure } from "./types";

const ds = {
  id: "d1", name: "Book1",
  data: {
    time: [0, 1], values: [[1, 2], [3, 4]], labels: ["B", "C"], units: ["", ""],
    metadata: { origin_book: "Book1", origin_column_names: ["B", "C"], x_column_name: "A", column_designations: { A: "X" } },
  },
} as unknown as Dataset;
const fig = (curves: unknown[]) => ({ curves } as unknown as OriginFigure);

describe("recordedXOmissions", () => {
  it("fires for a curve whose RECORDED X did not import", () => {
    expect(recordedXOmissions(fig([{ book: "Book1", x: "Q", y: "B", xRecorded: true }]), ds)).toEqual(["Book1 column B (X Q)"]);
  });
  it("is silent for an INFERRED X (no xRecorded)", () => {
    expect(recordedXOmissions(fig([{ book: "Book1", x: "Q", y: "B" }]), ds)).toEqual([]);
  });
});
