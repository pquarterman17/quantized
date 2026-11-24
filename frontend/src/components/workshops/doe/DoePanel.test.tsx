import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { doeEffects, doeFractions, doeGenerate } from "../../../lib/api/doe";
import { designData } from "../../../lib/doeTestData";
import { useDoeStore } from "../../../store/doe";
import { useFitModelStore } from "../../../store/fitModel";
import { useApp } from "../../../store/useApp";
import DoePanel from "./DoePanel";

vi.mock("../../../lib/api/doe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/doe")>()),
  doeGenerate: vi.fn(),
  doeFractions: vi.fn(),
  doeEffects: vi.fn(),
}));

class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.mocked(doeFractions).mockImplementation(async (k) => ({
    k,
    fractions: k === 4 ? [{ p: 1, runs: 8, resolution: 4, generators: ["D = ABC"] }] : [],
    center_points: { ccd: 6, ccd_fractional: 7, box_behnken: 3 },
  }));
  vi.mocked(doeGenerate).mockResolvedValue({ dataset: designData() });
  vi.mocked(doeEffects).mockResolvedValue({
    n_runs: 4, pse: null, me: null, sme: null,
    effects: [
      { term: "A (coded)", effect: 6, abs_effect: 6, half_normal_q: 1.2, t_ratio: null, significant: null },
      { term: "B (coded)", effect: 1, abs_effect: 1, half_normal_q: 0.3, t_ratio: null, significant: null },
    ],
  });
  useApp.setState({ datasets: [], activeId: null, selection: null, analysisResults: [], history: [], future: [] });
  useDoeStore.setState({ open: true });
  useFitModelStore.setState({ open: false, request: null });
});

describe("DoePanel", () => {
  it("sends the form, adds the returned design as a worksheet and shows it", async () => {
    render(<DoePanel />);
    fireEvent.change(screen.getByLabelText("Number of factors"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Factor 1 name"), { target: { value: "Temp" } });
    fireEvent.change(screen.getByLabelText("Factor 1 low"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Factor 1 high"), { target: { value: "200" } });
    fireEvent.change(screen.getByLabelText("Seed (blank = new)"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate worksheet" }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(1));
    const body = vi.mocked(doeGenerate).mock.calls[0]![0];
    expect(body.design).toBe("full_factorial");
    expect(body.factors[0]).toEqual({ name: "Temp", low: 100, high: 200, unit: "" });
    expect(body.randomize).toBe(true);
    expect(body.seed).toBe(5);
    expect(body.center_points).toBeNull(); // the published default is the server's
    expect(useApp.getState().datasets[0]!.name).toBe("DOE 2^2 full factorial");
    expect(await screen.findByText("2^2 full factorial: 4 runs")).toBeInTheDocument();
  });

  it("refuses an unusable form instead of sending it", () => {
    render(<DoePanel />);
    fireEvent.change(screen.getByLabelText("Factor 2 name"), { target: { value: "A" } });
    expect(screen.getByRole("button", { name: "Generate worksheet" })).toBeDisabled();
    expect(screen.getByText("Factor and response names must be different.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Factor 2 name"), { target: { value: "B" } });
    fireEvent.change(screen.getByLabelText("Factor 1 high"), { target: { value: "-1" } });
    expect(screen.getByText(/low and high must be two different numbers/)).toBeInTheDocument();
  });

  it("shows a server refusal", async () => {
    vi.mocked(doeGenerate).mockRejectedValueOnce(new Error("no published 2^(3-2) fraction"));
    render(<DoePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Generate worksheet" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no published 2^(3-2) fraction");
    expect(useApp.getState().datasets).toHaveLength(0);
  });

  it("Analyze design is disabled until the responses are filled, then opens Fit Model with the design's model", async () => {
    const empty = { id: "d1", name: "DOE", data: designData() };
    useApp.setState({ datasets: [empty], activeId: "d1" });
    const { rerender } = render(<DoePanel />);
    expect(screen.getByRole("button", { name: "Analyze design" })).toBeDisabled();
    expect(screen.getByText(/saturated for its model/)).toBeInTheDocument();
    useApp.setState({ datasets: [{ ...empty, data: designData([5, 11, 6, 12]) }] });
    rerender(<DoePanel />);
    const btn = screen.getByRole("button", { name: "Analyze design" });
    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);
    const { open, request } = useFitModelStore.getState();
    expect(open).toBe(true);
    expect(request).toEqual({ responseCol: 6, terms: [[2], [3], [2, 3]], kinds: { 2: "continuous", 3: "continuous" }, center: true });
    expect(await screen.findByRole("img", { name: "Half-normal plot of effects" })).toBeInTheDocument();
    expect(vi.mocked(doeEffects).mock.calls.at(-1)![0].response).toEqual([5, 11, 6, 12]);
  });

  it("offers the published fractions for the factor count", async () => {
    render(<DoePanel />);
    fireEvent.change(screen.getByLabelText("Design"), { target: { value: "fractional_factorial" } });
    fireEvent.change(screen.getByLabelText("Number of factors"), { target: { value: "4" } });
    expect(await screen.findByText("2^(4-1): 8 runs, resolution IV")).toBeInTheDocument();
    const generate = screen.getByRole("button", { name: "Generate worksheet" });
    await waitFor(() => expect(generate).toBeEnabled()); // enabled once the fraction (p) is chosen
    fireEvent.click(generate);
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(1));
    expect(vi.mocked(doeGenerate).mock.calls[0]![0]).toMatchObject({ design: "fractional_factorial", p: 1 });
  });
});
