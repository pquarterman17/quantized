// Extract rows commits through the shared result contract (reopen gaps lane,
// writer outside the audit): one undo step with a Library result linked to its
// source, no duplicate on a repeat, out of date when the source changes.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../../lib/types";
import { useApp } from "../../store/useApp";
import Worksheet from "./Worksheet";

vi.mock("../../lib/api", () => ({ applyCorrections: vi.fn(), uploadFile: vi.fn() }));
vi.mock("../../lib/api/statsDescriptive", () => ({ statsDescriptive: vi.fn(async () => ({ mean: 0, std: 0, min: 0, max: 0, median: 0, N: 0 })) }));

const data: DataStruct = { time: [1, 2, 3], values: [[10, 20], [40, 50], [11, 12]], labels: ["A", "B"], units: ["u1", "u2"], metadata: {} };

beforeEach(() => {
  useApp.setState({
    datasets: [{ id: "d1", name: "scan.dat", data }], activeId: "d1", worksheetId: null, status: "", selection: null,
    analysisResults: [], history: [], future: [], staleDatasets: [], recalcMode: "manual",
  });
});

const extract = () => {
  fireEvent.change(screen.getByLabelText("filter column"), { target: { value: "0" } });
  fireEvent.change(screen.getByLabelText("filter value"), { target: { value: "15" } });
  fireEvent.click(screen.getByRole("button", { name: /Extract/ }));
};

describe("Extract rows through the result contract", () => {
  it("is one undo step with its Library result", () => {
    render(<Worksheet />);
    extract();
    const state = useApp.getState();
    expect(state.datasets.map((d) => d.name)).toEqual(["scan.dat", "scan (subset)"]);
    expect(state.analysisResults).toHaveLength(1);
    expect(state.analysisResults[0]!.producer.id).toBe("worksheet-subset");
    expect(state.analysisResults[0]!.sources[0]!.datasetId).toBe("d1");
    expect(state.history).toHaveLength(1);
    useApp.getState().undo();
    expect(useApp.getState().datasets).toHaveLength(1);
    expect(useApp.getState().analysisResults).toHaveLength(0);
  });

  it("a repeat of the same extract adds nothing and says so", () => {
    render(<Worksheet />);
    extract();
    act(() => useApp.getState().setActive("d1"));
    fireEvent.change(screen.getByLabelText("filter column"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("filter value"), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: /Extract/ }));
    expect(useApp.getState().datasets).toHaveLength(2);
    expect(useApp.getState().analysisResults).toHaveLength(1);
    expect(useApp.getState().status).toContain("nothing was duplicated");
  });

  it("goes out of date when the source changes", () => {
    render(<Worksheet />);
    extract();
    const outputId = useApp.getState().datasets[1]!.id;
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "d1" ? { ...d, data: { ...d.data, time: [1, 2, 9] } } : d)) }));
    useApp.getState().touchDataset("d1");
    expect(useApp.getState().staleDatasets).toEqual([outputId]);
  });
});
