// Lane RL2: Frequency count commits its worksheet through the shared contract
// (one undo step with a Library result, no duplicate on a repeat run, out of
// date when the source changes). Row statistics adds formula columns to the
// SAME worksheet (no output worksheet), so it is not part of the contract.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../lib/types";
import { useApp } from "./useApp";

const { askParamsMock } = vi.hoisted(() => ({ askParamsMock: vi.fn() }));
vi.mock("./paramDialog", () => ({ askParams: askParamsMock }));
vi.mock("./toasts", () => ({ toast: vi.fn() }));

import { runFrequencyCount } from "./worksheetStatsRun";

const sheet: Dataset = {
  id: "w", name: "scan", workbookId: "B",
  data: { time: [1, 2, 3, 4], values: [[1], [2], [3], [10]], labels: ["M1"], units: ["emu"], metadata: {} },
};

beforeEach(() => {
  askParamsMock.mockReset();
  askParamsMock.mockResolvedValue({ column: "A: M1", bins: "2", width: "", min: "", max: "" });
  useApp.setState({ datasets: [sheet], activeId: "w", history: [], future: [], status: "", analysisResults: [], staleDatasets: [], recalcMode: "manual" });
});

describe("Frequency count commits through the shared contract", () => {
  it("is one undo step with its Library result, in the source's book", async () => {
    await runFrequencyCount();
    expect(useApp.getState().datasets).toHaveLength(2);
    expect(useApp.getState().datasets[1].workbookId).toBe("B");
    expect(useApp.getState().analysisResults).toHaveLength(1);
    expect(useApp.getState().history).toHaveLength(1);
    useApp.getState().undo();
    expect(useApp.getState().datasets).toHaveLength(1);
    expect(useApp.getState().analysisResults).toHaveLength(0);
  });

  it("a repeat run creates no duplicate; different settings do", async () => {
    await runFrequencyCount();
    useApp.getState().setActive("w"); // the output became active: go back to the source
    await runFrequencyCount();
    expect(useApp.getState().datasets).toHaveLength(2);
    expect(useApp.getState().analysisResults).toHaveLength(1);
    useApp.getState().setActive("w");
    askParamsMock.mockResolvedValue({ column: "A: M1", bins: "3", width: "", min: "", max: "" });
    await runFrequencyCount();
    expect(useApp.getState().datasets).toHaveLength(3);
  });

  it("goes out of date when the source changes", async () => {
    await runFrequencyCount();
    const outputId = useApp.getState().datasets[1].id;
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => d.id === "w" ? { ...d, data: { ...d.data, time: [1, 2, 3, 9] } } : d) }));
    useApp.getState().touchDataset("w");
    expect(useApp.getState().staleDatasets).toEqual([outputId]);
  });

  it("refuses a still-loading source and writes nothing", async () => {
    useApp.setState({ datasets: [{ ...sheet, pending: { kind: "path", bookId: "b", rows: 9, cols: 1 } }] });
    await runFrequencyCount();
    expect(useApp.getState().datasets).toHaveLength(1);
  });

  it("records the counted column's range as the input (acceptance C9), not the worksheet's time axis", async () => {
    await runFrequencyCount();
    expect(useApp.getState().analysisResults[0].parameters?.["inputs"]).toMatchObject({ items: [{ datasetId: "w", xRange: [1, 10] }] });
  });
});
