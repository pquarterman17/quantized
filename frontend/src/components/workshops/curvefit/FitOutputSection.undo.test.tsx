// "Output to worksheet" -> linked columns: the fitted and residual columns
// are ONE undo step (the status line says "Undo removes"). They used to be
// two separate "add column" entries, so one Undo left the fitted column
// behind. Runs the real derived-column path (no mock).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import FitOutputSection from "./FitOutputSection";

const DS: Dataset = {
  id: "d1",
  name: "run.dat",
  data: { time: [0, 1, 2], values: [[1], [3], [5]], labels: ["M"], units: [""], metadata: {} },
  fitSpec: { model: "Linear", params: [2, 1] },
};
const RESULT = { params: [2, 1], errors: [0.1, 0.1], yFit: [1, 3, 5], residuals: [0, 0, 0], nPoints: 3, nFree: 2 };
const FIT = { x: [0, 1, 2], y: [1, 3, 5], xKey: null, yKey: 0, dy: null };

beforeEach(() => {
  useApp.setState({ datasets: [DS], activeId: "d1", history: [], future: [] });
});

describe("FitOutputSection — linked columns undo", () => {
  it("adds both columns as one undo step", async () => {
    render(<FitOutputSection dataset={DS} model="Linear" paramNames={["m", "b"]} result={RESULT} fitData={FIT} />);
    fireEvent.click(screen.getByText("Output to worksheet"));
    fireEvent.click(screen.getByRole("button", { name: "Write to worksheet" }));
    await waitFor(() => expect(useApp.getState().datasets[0]!.data.labels).toEqual(["M", "M fit", "M residual"]));
    expect(useApp.getState().datasets[0]!.data.values).toEqual([[1, 1, 0], [3, 3, 0], [5, 5, 0]]);
    useApp.getState().undo();
    expect(useApp.getState().datasets[0]!.data.labels).toEqual(["M"]);
  });
});
