// Significance marks on the REAL Statistics stage and store (gap audit 8 lane
// SIG): the compare control persists the choice on the plot (one undo step),
// the footnote under the plot names the test and the correction on its own
// line, and turning the option off removes both. Waits are on rendered or
// stored STATE.

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsBox, statsTukey } from "../../lib/api";
import type { DataStruct, Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import StatStage from "./StatStage";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  statsBox: vi.fn(),
  statsTukey: vi.fn(),
}));

class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5],
  values: [[0, 1], [0, 2], [0, 3], [1, 10], [1, 11], [1, 12]],
  labels: ["grp", "y"],
  units: ["", ""],
  metadata: {},
  cat_levels: { 0: ["A", "B"] },
};
const DS: Dataset = { id: "ds", name: "ds", data: DATA };
const combo = (name: string) => screen.getByRole("combobox", { name });

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.mocked(statsBox).mockRejectedValue(new Error("offline"));
  vi.mocked(statsTukey).mockReset().mockResolvedValue({ pairs: [{ i: 0, j: 1, p: 0.0004 }] });
  useApp.setState({
    theme: "dark", accent: "violet", datasets: [DS], activeId: "ds", selection: null,
    yKeys: [1], xKey: null, seriesOrder: null, statStageSeed: null, statMarks: {}, history: [], future: [],
  });
});

describe("significance marks on the real stage", () => {
  it("is off until chosen, persists the choice, names the test under the plot, and undo takes it back", async () => {
    render(<StatStage />);
    await waitFor(() => expect(combo("significance marks")).toHaveValue("off"));
    expect(screen.queryByTestId("stat-error-note")).toBeNull();
    expect(statsTukey).not.toHaveBeenCalled();

    await userEvent.selectOptions(combo("summary marker"), "mean");
    await userEvent.selectOptions(combo("significance marks"), "brackets");
    await waitFor(() => expect(useApp.getState().statMarks.box).toEqual({ summary: "mean", comparisons: "brackets" }));
    await waitFor(() => expect(screen.getByTestId("stat-error-note")).toHaveTextContent("Tukey HSD"));
    // the error-bar note and the test note are separate lines
    expect(screen.getByTestId("stat-error-note").children).toHaveLength(2);
    expect(screen.getByTestId("stat-error-note")).toHaveTextContent("Error bars: 95% CI of the mean");
    expect(screen.getByTestId("stat-error-note")).toHaveTextContent("familywise alpha = 0.05");

    act(() => useApp.getState().undo());
    await waitFor(() => expect(combo("significance marks")).toHaveValue("off"));
    await waitFor(() => expect(screen.getByTestId("stat-error-note").children).toHaveLength(1));
    expect(screen.getByTestId("stat-error-note")).not.toHaveTextContent("Tukey");
  });

  it("states why letters cannot be drawn with Dunnett, and draws no note", async () => {
    render(<StatStage />);
    await userEvent.selectOptions(combo("significance marks"), "letters");
    await userEvent.selectOptions(combo("comparison test"), "dunnett");
    await waitFor(() => expect(screen.getByTestId("stat-compare-error")).toHaveTextContent("Tukey"));
    expect(screen.queryByTestId("stat-error-note")).toBeNull();
  });
});
