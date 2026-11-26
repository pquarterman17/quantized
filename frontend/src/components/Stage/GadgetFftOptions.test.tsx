// The plot FFT gadget's output choice, through the real store path: the choice
// reaches /api/spectral/fft, re-arms the region, and the committed spectrum
// carries the right label and unit. The default request is unchanged.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  fftSpectral: vi.fn(),
}));

import { fftSpectral } from "../../lib/api";
import type { Dataset } from "../../lib/types";
import { useGadgetFftOptions } from "../../store/gadgetFftOptions";
import { useApp } from "../../store/useApp";
import GadgetFftOptions from "./GadgetFftOptions";

const N = 64;
const source = (): Dataset => ({
  id: "src", name: "scan.dat",
  data: {
    time: Array.from({ length: N }, (_, i) => i * 0.5), values: Array.from({ length: N }, (_, i) => [Math.sin(i)]),
    labels: ["A"], units: ["V"], metadata: { xUnit: "s" },
  },
});
const outputs = () => useApp.getState().datasets.filter((d) => d.id !== "src");

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(fftSpectral).mockImplementation(async (body) => (
    body.output_type === "psd"
      ? { freq: [0, 1, 2, 3], psd: [1, 2, 3, 4], scaling: body.scaling ?? "density", windowName: "hann" }
      : { freq: [0, 1, 2, 3], magnitude: [1, 2, 3, 4], windowName: "hann" }) as never);
  useGadgetFftOptions.setState({ output: "magnitude" });
  useApp.setState({
    datasets: [source()], activeId: "src", xKey: null, yKeys: [0], seriesOrder: null, hiddenChannels: [], status: "", analysisResults: [],
    history: [], future: [], staleDatasets: [], staleFits: [], recalcMode: "manual", gadgetMode: "fit", qfitRoi: null, gadgetFftPreview: null,
  });
  await useApp.getState().runQuickFit(); // warm the lazy compute body
  useApp.getState().setGadgetMode("fft");
});

const arm = async () => {
  useApp.getState().setQfitRoi([2, 20]);
  await waitFor(() => expect(useApp.getState().gadgetFftPreview).not.toBeNull());
};

describe("FFT gadget output", () => {
  it("default: the request and the committed spectrum are what they always were", async () => {
    await arm();
    expect(vi.mocked(fftSpectral).mock.calls.at(-1)![0]).toEqual({ x: expect.any(Array), y: expect.any(Array) });
    act(() => useApp.getState().commitGadgetFft());
    await waitFor(() => expect(outputs()).toHaveLength(1));
    expect(outputs()[0]!.data.labels).toEqual(["magnitude"]);
    expect(outputs()[0]!.data.units).toEqual([""]);
    expect(outputs()[0]!.data.metadata).not.toHaveProperty("fftOutput");
  });

  it("choosing PSD density, then power, re-arms the region and the committed unit follows", async () => {
    await arm();
    render(<GadgetFftOptions />);
    expect(screen.getByLabelText("FFT output")).toHaveValue("magnitude");
    fireEvent.change(screen.getByLabelText("FFT output"), { target: { value: "psd" } });
    await waitFor(() => expect(useApp.getState().gadgetFftPreview?.psd).toBeDefined(), { timeout: 3000 });
    expect(vi.mocked(fftSpectral).mock.calls.at(-1)![0]).toMatchObject({ output_type: "psd" });
    expect(vi.mocked(fftSpectral).mock.calls.at(-1)![0]).not.toHaveProperty("scaling");
    act(() => useApp.getState().commitGadgetFft());
    await waitFor(() => expect(outputs()).toHaveLength(1));
    expect(outputs()[0]!.data).toMatchObject({ labels: ["psd"], units: ["V²·s"], metadata: { fftOutput: "psd" } });

    expect((useApp.getState().analysisResults[0]!.parameters as { settings: Record<string, unknown> }).settings["fftOutput"]).toBe("psd");
    // The added spectrum became the active worksheet; go back to the source and its region.
    act(() => { useApp.setState({ activeId: "src" }); useApp.getState().setQfitRoi([2, 20]); });
    fireEvent.change(screen.getByLabelText("FFT output"), { target: { value: "power" } });
    await waitFor(() => expect(useApp.getState().gadgetFftPreview?.scaling).toBe("spectrum"), { timeout: 3000 });
    expect(vi.mocked(fftSpectral).mock.calls.at(-1)![0]).toMatchObject({ output_type: "psd", scaling: "spectrum" });
    act(() => useApp.getState().commitGadgetFft());
    // Another output of the same region is a different computation: a second spectrum, not a duplicate.
    await waitFor(() => expect(outputs()).toHaveLength(2));
    expect(outputs()[1]!.data).toMatchObject({ labels: ["power"], units: ["V²"], metadata: { fftOutput: "power" } });
  });

  it("the spectrum shown is dropped while the new output computes", async () => {
    await arm();
    render(<GadgetFftOptions />);
    // The added spectrum became the active worksheet; go back to the source and its region.
    act(() => { useApp.setState({ activeId: "src" }); useApp.getState().setQfitRoi([2, 20]); });
    fireEvent.change(screen.getByLabelText("FFT output"), { target: { value: "power" } });
    expect(useApp.getState().gadgetFftPreview).toBeNull();
  });
});
