// CompareModelsSection on the workbench shell (lane WB4): the table says
// "Out of date" once the picks change, a refusal is its own alert kind.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { compareModels } from "../../../lib/api/fitStats";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import CompareModelsSection from "./CompareModelsSection";

vi.mock("../../../lib/api/fitStats", () => ({ compareModels: vi.fn() }));

const DATA: DataStruct = {
  time: [0, 1, 2], values: [[1, 10], [2, 20], [3, 30]], labels: ["x", "y"], units: ["", ""], metadata: {},
};
const OPTIONS = [{ value: "Linear", label: "Linear" }, { value: "Quadratic", label: "Quadratic" }, { value: "Cubic", label: "Cubic" }];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(compareModels).mockResolvedValue({ n: 3, reference: "Linear", results: [] });
  useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1", xKey: 0, yKeys: [1], seriesOrder: null });
});

describe("CompareModelsSection", () => {
  it("marks the table Out of date when a model is added after the comparison, and Compare again clears it", async () => {
    render(<CompareModelsSection options={OPTIONS} current="Linear" customModels={[]} />);
    fireEvent.change(screen.getByLabelText("Add a model to compare"), { target: { value: "Quadratic" } });
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    await screen.findByRole("table", { name: "Model comparison" });
    expect(screen.queryByText(/Out of date/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Add a model to compare"), { target: { value: "Cubic" } });
    expect(await screen.findByText(/Out of date/)).toBeInTheDocument();
    expect(compareModels).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    await screen.findByRole("table", { name: "Model comparison" });
    expect(screen.queryByText(/Out of date/)).toBeNull();
  });

  it("a request failure is an error alert", async () => {
    vi.mocked(compareModels).mockRejectedValueOnce(new Error("boom"));
    render(<CompareModelsSection options={OPTIONS} current="Linear" customModels={[]} />);
    fireEvent.change(screen.getByLabelText("Add a model to compare"), { target: { value: "Quadratic" } });
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-kind", "error");
    expect(alert).toHaveTextContent("boom");
  });
});
