// Baseline reads its rows through the shared resolver (every worksheet row).
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ROW_POLICY, resolveAnalysisInputs } from "../../../lib/analysisInputs";
import type { Dataset } from "../../../lib/types";
import { baselineBinding, baselineInput, batchInput } from "./baselineInput";

vi.mock("../../../lib/analysisInputs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/analysisInputs")>();
  return { ...actual, resolveAnalysisInputs: vi.fn(actual.resolveAnalysisInputs) };
});

const DS: Dataset = {
  id: "b", name: "xrd.xy",
  data: { time: [1, 2, 3, 4], values: [[10], [20], [30], [40]], labels: ["I"], units: [""], metadata: {} },
  excludedRows: [1],
};

beforeEach(() => vi.clearAllMocks());

describe("baselineInput", () => {
  it("goes through the resolver and keeps every row, excluded rows included", () => {
    const input = baselineInput(DS, null, [0], null);
    expect(typeof input).not.toBe("string");
    expect(input).toMatchObject({ x: [1, 2, 3, 4], y: [10, 20, 30, 40] });
    expect(vi.mocked(resolveAnalysisInputs)).toHaveBeenCalledWith(
      expect.objectContaining({ policy: ROW_POLICY.fullWorksheet, yKeys: [0], xKey: null }),
    );
  });

  it("binding needs no rows (works on a lazy preview) but the run refuses one", () => {
    const lazy = { ...DS, pending: { kind: "test" } as never };
    expect(baselineBinding(lazy, null, [0], null)).toMatchObject({ yKey: 0, yLabel: "I" });
    expect(baselineInput(lazy, null, [0], null)).toMatch(/preview rows are not analysed/);
  });

  it("refuses with a message when no Y is plotted and when a batch sheet lacks the column", () => {
    const none = { ...DS, data: { ...DS.data, labels: [], values: [[], [], [], []], units: [] } };
    expect(baselineInput(none, null, null, null)).toMatch(/no usable primary Y channel/);
    const ref = baselineBinding(DS, null, [0], null);
    expect(batchInput({ ...DS, name: "other" }, ref)).toMatchObject({ y: [10, 20, 30, 40] });
    expect(batchInput({ ...DS, name: "other", data: { ...DS.data, labels: ["Z"] } }, ref)).toMatch(/no "I" column/);
  });
});
