// OG20: the commit button of a tool reads the SAME key the commit writes, including the row range. After a
// ranged commit the button says "already added" for that window only: clearing the range (a different
// computation, so a different key) re-enables it, and setting the window again disables it again.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import type { Dataset } from "../../../lib/types";
import type { AnalysisOutputCommit } from "../../../store/analysisOutputCommit";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { useApp } from "../../../store/useApp";
import { openWorksheetRowRange } from "../../../store/worksheetAnalysisHandoff";
import { useAnalysisCommit } from "./useAnalysisCommit";

const SHEET: Dataset = {
  id: "d1", name: "run.csv",
  data: { time: [0, 1, 2, 3, 4, 5], values: [[1], [2], [3], [4], [5], [6]], labels: ["v"], units: [""], metadata: {} },
};
const request: AnalysisOutputCommit = {
  producer: { id: "tabulate", label: "Tabulate", version: 1 }, sourceId: "d1", computedOn: analysisDataFingerprint(SHEET),
  settings: { a: 1 }, output: () => ({ name: "out", data: { time: [0], values: [[1]], labels: ["o"], units: [""], metadata: {} } }),
};

beforeEach(() => {
  useAnalysisSelection.setState({ toolId: null, selection: null });
  useApp.setState({ datasets: [SHEET], activeId: "d1", analysisResults: [], history: [], future: [], status: "", staleDatasets: [] });
});

describe("the commit button follows the row range", () => {
  it("is disabled as already added only for the window that was committed", () => {
    act(() => openWorksheetRowRange("d1", [1, 2, 3]));
    const { result } = renderHook(() => useAnalysisCommit(request));
    expect(result.current.disabledReason).toBeNull();
    act(() => { expect(result.current.commit()).toMatchObject({ kind: "created" }); });
    expect(result.current.disabledReason).toMatch(/Already added/);
    act(() => useAnalysisSelection.getState().updateItem("d1", { rowRange: null }));
    expect(result.current.disabledReason).toBeNull(); // every row is another computation
    act(() => useAnalysisSelection.getState().updateItem("d1", { rowRange: { from: 1, to: 3 } }));
    expect(result.current.disabledReason).toMatch(/Already added/);
  });
});
