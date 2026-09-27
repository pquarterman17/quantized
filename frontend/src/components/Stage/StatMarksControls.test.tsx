// P2.6 box 1 — the marks controls on the REAL Statistics stage and the real
// store: a choice is written to the plot's persisted `PlotView.statMarks`
// (the draw it reaches: statMarksParity.test.ts) and undone by the app's undo. Keyboard
// reach is exercised the way a user would (Tab into a control, Space on a
// checkbox). Every wait is on rendered or stored STATE, never on a mock call.

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsBox } from "../../lib/api";
import type { DataStruct, Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import StatStage from "./StatStage";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  statsBox: vi.fn(),
}));

class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5],
  values: [
    [0, 1],
    [0, 2],
    [0, 9],
    [1, 10],
    [1, 11],
    [1, 12],
  ],
  labels: ["grp", "y"],
  units: ["", ""],
  metadata: {},
  cat_levels: { 0: ["A", "B"] },
};
const DS: Dataset = { id: "ds", name: "ds", data: DATA };

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.mocked(statsBox).mockRejectedValue(new Error("offline"));
  useApp.setState({
    theme: "dark", accent: "violet", datasets: [DS], activeId: "ds", selection: null,
    yKeys: [1], xKey: null, seriesOrder: null, statStageSeed: null, statMarks: {}, history: [], future: [],
  });
});

const combo = (name: string) => screen.getByRole("combobox", { name });

describe("StatMarksControls on the real stage", () => {
  it("a choice persists on the plot and undo takes it back", async () => {
    render(<StatStage />);
    await userEvent.selectOptions(combo("summary marker"), "mean");
    await waitFor(() => expect(useApp.getState().statMarks.box).toEqual({ summary: "mean" }));
    // Error bars come alive with the mean marker.
    await waitFor(() => expect(combo("error bars")).toBeEnabled());
    await userEvent.selectOptions(combo("error bars"), "sd");
    await waitFor(() => expect(combo("error bars")).toHaveValue("sd"));
    expect(useApp.getState().statMarks.box).toEqual({ summary: "mean", errorBars: "sd" });
    act(() => useApp.getState().undo());
    await waitFor(() => expect(combo("error bars")).toHaveValue("ci95"));
    act(() => useApp.getState().undo());
    await waitFor(() => expect(combo("summary marker")).toHaveValue("none"));
    await waitFor(() => expect(combo("error bars")).toBeDisabled());
  });

  it("is reachable in tab order and operable from the keyboard", async () => {
    render(<StatStage />);
    // Tab from the toolbar's first button reaches the points control (no
    // pointer, no tabindex tricks: native controls in document order).
    screen.getByTitle("Back to a cartesian plot").focus();
    const points = combo("raw points");
    for (let i = 0; i < 20 && document.activeElement !== points; i++) await userEvent.tab();
    expect(points).toHaveFocus();
    // jsdom does not open a native <select> on arrow keys; a focused select's
    // change is what the browser emits for them.
    await userEvent.selectOptions(points, "none");
    await waitFor(() => expect(useApp.getState().statMarks.box?.points).toBe("none"));
    // Onward to the wrap checkbox; Space toggles it.
    const wrap = screen.getByRole("checkbox", { name: /wrap/ });
    for (let i = 0; i < 20 && document.activeElement !== wrap; i++) await userEvent.tab();
    expect(wrap).toHaveFocus();
    await userEvent.keyboard(" ");
    await waitFor(() => expect(useApp.getState().statMarks.box?.labelWrap).toBe(true));
  });

  it("choosing every point brings in the jitter control", async () => {
    render(<StatStage />);
    expect(screen.queryByRole("combobox", { name: "jitter width" })).toBeNull();
    await userEvent.selectOptions(combo("raw points"), "all");
    const jitter = await screen.findByRole("combobox", { name: "jitter width" });
    expect(jitter).toHaveValue("0.7");
    await userEvent.selectOptions(jitter, "off");
    await waitFor(() => expect(useApp.getState().statMarks.box).toEqual({ points: "all", jitter: false }));
    await waitFor(() => expect(combo("jitter width")).toHaveValue("off"));
  });
});
