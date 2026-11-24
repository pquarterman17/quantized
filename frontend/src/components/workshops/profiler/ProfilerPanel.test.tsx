import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsContour, statsProfile, type ProfileResponse, type ProfilerModel } from "../../../lib/api/modelEvaluate";
import { useProfilerStore } from "../../../store/profiler";
import { ProfilerPanel } from "./ProfilerPanel";

vi.mock("../../../lib/api/modelEvaluate", () => ({
  statsProfile: vi.fn(), statsContour: vi.fn(), statsDesirability: vi.fn(),
}));

class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

const MODEL = {
  response: "a",
  factors: [{ name: "T", kind: "continuous", mean: 600 }, { name: "P", kind: "continuous", mean: 2 }, { name: "g", kind: "nominal", levels: ["Si", "MgO"] }],
  terms: [["T"], ["P"], ["g"]], center_polynomials: true, parameters: [], coefficients: [], covariance: [], df_error: 8, rmse: 0.1,
  ranges: { T: [300, 900], P: [1, 3] },
} as unknown as ProfilerModel;

// Predicted = 3 + T / 1000 so the readout is checkable for any slider value.
function profileFor(current: Record<string, number | string | null>): ProfileResponse {
  const t = Number(current["T"]);
  const pred = 3 + t / 1000;
  const xs = [300, 600, 900];
  return {
    response: "a", alpha: 0.05, t_crit: 2, df_error: 8, rmse: 0.1,
    current: { settings: current, predicted: pred, se: 0.05, lower: pred - 0.1, upper: pred + 0.1 },
    factors: [
      { name: "T", kind: "continuous", x: xs, range: [300, 900], predicted: xs.map((x) => 3 + x / 1000), se: [0.05, 0.05, 0.05],
        lower: xs.map((x) => 2.9 + x / 1000), upper: xs.map((x) => 3.1 + x / 1000) },
      { name: "P", kind: "continuous", x: [1, 2, 3], range: [1, 3], predicted: [pred, pred, pred], se: [0.05, 0.05, 0.05], lower: [pred - 0.1, pred - 0.1, pred - 0.1], upper: [pred + 0.1, pred + 0.1, pred + 0.1] },
      { name: "g", kind: "nominal", levels: ["Si", "MgO"], predicted: [pred, pred + 0.2], se: [0.05, 0.05], lower: [pred - 0.1, pred + 0.1], upper: [pred + 0.1, pred + 0.3] },
    ],
  };
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.mocked(statsProfile).mockReset().mockImplementation((body) => Promise.resolve(profileFor(body.current)));
  vi.mocked(statsContour).mockReset().mockResolvedValue({
    x_factor: "T", y_factor: "P", x: [300, 900], y: [1, 3], z: [[1, 2], [3, 4]], se: [[0, 0], [0, 0]], current: {},
  });
  useProfilerStore.setState({ open: true, request: { model: MODEL, label: "a" } });
});

describe("ProfilerPanel", () => {
  it("shows the prediction readout, one panel per factor, and updates it from a keyboard-operable slider", async () => {
    render(<ProfilerPanel />);
    const readout = await screen.findByText(/a = 3\.6 ± 0\.1/);
    expect(readout.textContent).toContain("95% CI 3.5 to 3.7");
    expect(screen.getByLabelText("T prediction trace")).toBeTruthy();
    expect(screen.getByLabelText("g step plot")).toBeTruthy();
    const slider = screen.getByLabelText("T setting") as HTMLInputElement;
    expect(slider.type).toBe("range");
    fireEvent.change(slider, { target: { value: "900" } });
    await waitFor(() => expect(screen.getByTestId("profiler-readout").textContent).toContain("a = 3.9"));
    // The request carries the dragged setting; a drag never fans out per point.
    const last = vi.mocked(statsProfile).mock.calls.at(-1)![0];
    expect(last.current["T"]).toBe(900);
    expect(last.n_points).toBeUndefined();
  });

  it("debounces a burst of drag events into one request", async () => {
    render(<ProfilerPanel />);
    await screen.findByTestId("profiler-readout");
    await waitFor(() => expect(screen.getByTestId("profiler-readout").textContent).toContain("3.6"));
    const before = vi.mocked(statsProfile).mock.calls.length;
    const slider = screen.getByLabelText("T setting");
    for (const v of ["400", "450", "500", "550"]) fireEvent.change(slider, { target: { value: v } });
    await waitFor(() => expect(screen.getByTestId("profiler-readout").textContent).toContain("a = 3.55 ±"));
    expect(vi.mocked(statsProfile).mock.calls.length - before).toBe(1);
    expect(vi.mocked(statsProfile).mock.calls.at(-1)![0].current["T"]).toBe(550);
  });

  it("picks a categorical level from its level picker", async () => {
    render(<ProfilerPanel />);
    await screen.findByTestId("profiler-readout");
    await waitFor(() => expect(screen.getByTestId("profiler-readout").textContent).toContain("3.6"));
    fireEvent.change(screen.getByLabelText("g level"), { target: { value: "MgO" } });
    await waitFor(() => expect(vi.mocked(statsProfile).mock.calls.at(-1)![0].current["g"]).toBe("MgO"));
  });

  it("opens the contour view and requests a grid over the first two continuous factors", async () => {
    render(<ProfilerPanel />);
    await screen.findByTestId("profiler-readout");
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Contour" })); });
    await screen.findByLabelText("a contour over T and P");
    await screen.findByText(/a 1 to 4\./);
    const body = vi.mocked(statsContour).mock.calls.at(-1)![0];
    expect([body.x_factor, body.y_factor]).toEqual(["T", "P"]);
    expect(Object.keys(body.current)).toEqual(["g"]);
  });

  it("refuses a model with no stored range instead of guessing one", async () => {
    const { ranges: _ranges, ...old } = MODEL;
    useProfilerStore.setState({ request: { model: old as ProfilerModel, label: "old" } });
    render(<ProfilerPanel />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/Fit Model again/);
    expect(statsProfile).not.toHaveBeenCalled();
  });
});
