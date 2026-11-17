// The default Summary X of a finished batch: the number in the name, but only
// when that is a trend, and never over a choice the user made (UX9-C review).

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SummaryXChoice } from "../../../lib/batchSummaryX";
import type { Dataset } from "../../../lib/types";
import { captureAnalysisSelection } from "../../../lib/analysisSelection";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { useApp } from "../../../store/useApp";
import { usePendingOps } from "../../../store/pendingOps";
import AnalysisBatchControls, { type AnalysisBatchRow } from "./AnalysisBatchControls";

vi.mock("../../../store/analysisResultActions", () => ({ registerAnalysisResult: vi.fn() }));

const seed = (names: string[]) => {
  const datasets: Dataset[] = names.map((name, i) => ({
    id: `d${i}`, name, data: { time: [0, 1], values: [[1], [2]], labels: ["Y"], units: [""], metadata: {} },
  }));
  const ids = datasets.map((d) => d.id);
  useApp.setState({
    datasets, activeId: ids[0]!, selectedIds: ids, analysisResults: [], history: [], future: [],
    resolveDataset: async (id: string) => datasets.find((d) => d.id === id),
  });
  useAnalysisSelection.setState({
    toolId: "batch-test",
    selection: captureAnalysisSelection({
      datasets, activeId: ids[0]!, selectedIds: ids, xKey: null, yKeys: [0],
      seriesOrder: null, errKeys: {}, selection: null, range: null,
    }, "library"),
  });
};

const run = async (): Promise<ReturnType<typeof vi.fn<(rows: readonly AnalysisBatchRow[], x: SummaryXChoice) => void>>> => {
  const onSummarySheet = vi.fn<(rows: readonly AnalysisBatchRow[], x: SummaryXChoice) => void>();
  render(<AnalysisBatchControls toolId="batch-test" label="Test batch" summaryColumns={["N"]} runItem={async () => ({ values: [2] })} onSummarySheet={onSummarySheet} />);
  fireEvent.click(screen.getByRole("button", { name: /Batch/ }));
  fireEvent.click(screen.getByRole("button", { name: "Run Test batch batch" }));
  await screen.findByRole("button", { name: "Create summary worksheet" });
  return onSummarySheet;
};
const choiceNow = (onSummarySheet: Awaited<ReturnType<typeof run>>): SummaryXChoice => {
  fireEvent.click(screen.getByRole("button", { name: "Create summary worksheet" }));
  return onSummarySheet.mock.calls.at(-1)![1];
};
const INDEX = { source: { kind: "index" }, sort: false };

beforeEach(() => usePendingOps.setState({ ops: [] }));

describe("AnalysisBatchControls — default summary X", () => {
  it("defaults to the unit-carrying number in the name (run3_010K is 10 K)", async () => {
    seed(["run3_010K", "run3_050K"]);
    expect(choiceNow(await run())).toEqual({ source: { kind: "name" }, sort: true });
  });

  it("stays on input order when the names give no trend or look like dates", async () => {
    seed(["sample1_run2", "sample1_run2b"]);
    expect(choiceNow(await run())).toEqual(INDEX);
  });

  it("stays on input order for date-like names", async () => {
    seed(["2024-01-15_a", "2024-01-16_a"]);
    expect(choiceNow(await run())).toEqual(INDEX);
  });

  it("keeps a deliberate Input order pick across a re-run", async () => {
    seed(["decay_010K", "decay_050K"]);
    const onSummarySheet = await run();
    expect(choiceNow(onSummarySheet).source.kind).toBe("name");
    fireEvent.change(screen.getByLabelText("summary X from"), { target: { value: "index" } });
    expect(choiceNow(onSummarySheet)).toEqual({ source: { kind: "index" }, sort: true });
    fireEvent.click(screen.getByLabelText("Sort rows by X")); // sort off: exactly INDEX_X
    fireEvent.click(screen.getByRole("button", { name: "Run Test batch batch" }));
    await screen.findByRole("button", { name: "Create summary worksheet" });
    expect(choiceNow(onSummarySheet)).toEqual(INDEX);
  });
});
