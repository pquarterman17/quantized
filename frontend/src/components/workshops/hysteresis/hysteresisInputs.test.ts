// Hysteresis reads H / M through the shared resolver: the analysis view, plus
// the reviewed selection's rows / range when one is given.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ROW_POLICY, resolveAnalysisInputs } from "../../../lib/analysisInputs";
import type { AnalysisSelectionItem } from "../../../lib/analysisSelection";
import type { Dataset } from "../../../lib/types";
import { hysteresisInputs } from "./useHysteresis";

vi.mock("../../../lib/analysisInputs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/analysisInputs")>();
  return { ...actual, resolveAnalysisInputs: vi.fn(actual.resolveAnalysisInputs) };
});

const DS: Dataset = {
  id: "h", name: "loop.dat",
  data: {
    time: [-2, -1, 0, 1, 2], values: [[-1], [-0.5], [0], [0.5], [1]], labels: ["M"], units: ["emu"],
    metadata: { x_column_name: "Magnetic Field", x_column_unit: "Oe" },
  },
  excludedRows: [0],
};
const item = (over: Partial<AnalysisSelectionItem>): AnalysisSelectionItem =>
  ({ datasetId: "h", xKey: null, yKeys: [0], rowIds: null, range: null, ...over }) as AnalysisSelectionItem;

beforeEach(() => vi.clearAllMocks());

describe("hysteresisInputs", () => {
  it("drops excluded rows under the analysis-view policy when there is no selection", () => {
    const input = hysteresisInputs(DS, null, [0], null);
    expect(input).toEqual({ ok: true, h: [-1, 0, 1, 2], m: [-0.5, 0, 0.5, 1], yKey: 0 });
    expect(vi.mocked(resolveAnalysisInputs)).toHaveBeenCalledWith(expect.objectContaining({ policy: ROW_POLICY.analysisView }));
  });

  it("narrows to the selection's rows and X range (excluded rows stay out)", () => {
    const rows = hysteresisInputs(DS, null, [0], null, item({ rowIds: [0, 1, 4] }));
    expect(rows).toMatchObject({ ok: true, h: [-1, 2] });
    const range = hysteresisInputs(DS, null, [0], null, item({ range: { lo: -0.5, hi: 1.5, source: "manual" } }));
    expect(range).toMatchObject({ ok: true, h: [0, 1] });
    expect(vi.mocked(resolveAnalysisInputs)).toHaveBeenCalledWith(expect.objectContaining({ policy: ROW_POLICY.selection }));
  });

  it("fails closed: empty row selection, no response, lazy preview, foreign selection", () => {
    expect(hysteresisInputs(DS, null, [0], null, item({ rowIds: [] }))).toMatchObject({ ok: false, reason: expect.stringMatching(/row selection is empty/) });
    expect(hysteresisInputs({ ...DS, data: { ...DS.data, labels: [], values: [[], [], [], [], []], units: [] } }, null, null, null))
      .toEqual({ ok: false, reason: "No response column is available to analyze." });
    expect(hysteresisInputs({ ...DS, pending: { kind: "test" } as never }, null, [0], null))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/preview rows are not analysed/) });
    expect(hysteresisInputs(DS, null, [0], null, item({ datasetId: "gone" }))).toMatchObject({ ok: false });
  });
});
