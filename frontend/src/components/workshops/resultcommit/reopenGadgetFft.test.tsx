// "Open in Gadget FFT" (OPEN_ITEMS row 12, reopen-seven lane): the plot's FFT
// gadget is re-armed with the recorded region on the recorded channel of the
// recorded source (producer version 2 records the channel by position AND
// name); its Add makes a NEW spectrum. FAIL CLOSED: a version-1 result refuses;
// a moved channel, an unreadable region and a deleted source leave the
// plot and the gadget untouched.

import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  fftSpectral: vi.fn(),
}));

import { fftSpectral } from "../../../lib/api";
import { gadgetFftSeed } from "../../../lib/gadgetFftReopenSeed";
import type { Dataset } from "../../../lib/types";
import { useToolReopen } from "../../../store/toolReopen";
import { openCommittedResultInTool } from "../../../store/toolReopenOpen";
import { useApp } from "../../../store/useApp";

const N = 64;
const source = (labels = ["A", "B"]): Dataset => ({
  id: "src", name: "scan.dat",
  data: {
    time: Array.from({ length: N }, (_, i) => i * 0.5), values: Array.from({ length: N }, (_, i) => [Math.sin(i), Math.cos(i)]),
    labels, units: ["V", "V"], metadata: {},
  },
});

const results = () => useApp.getState().analysisResults;
const outputs = () => useApp.getState().datasets.filter((d) => d.id !== "src");
const reopen = (): boolean => { let ok = false; act(() => { ok = openCommittedResultInTool(results()[0]!.id); }); return ok; };
const edit = (fn: (settings: Record<string, unknown>) => void) =>
  useApp.setState((s) => ({
    analysisResults: s.analysisResults.map((r) => {
      const settings = { ...(r.parameters!["settings"] as Record<string, unknown>) };
      fn(settings);
      return { ...r, parameters: { ...r.parameters, settings } as typeof r.parameters };
    }),
  }));

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(fftSpectral).mockResolvedValue({ freq: [0, 1, 2, 3], magnitude: [1, 2, 3, 4], windowName: "hann" } as never);
  useToolReopen.setState({ sessions: {} });
  useApp.setState({
    datasets: [source()], activeId: "src", xKey: null, yKeys: [1], seriesOrder: null, hiddenChannels: [], status: "", analysisResults: [],
    history: [], future: [], staleDatasets: [], staleFits: [], recalcMode: "manual", gadgetMode: "fit", qfitRoi: null, gadgetFftPreview: null,
  });
  // Warm the lazy compute body, then run the gadget the way the chip does and commit its spectrum.
  await useApp.getState().runQuickFit();
  useApp.getState().setGadgetMode("fft");
  useApp.getState().setQfitRoi([2, 20]);
  await waitFor(() => expect(useApp.getState().gadgetFftPreview).not.toBeNull());
  act(() => useApp.getState().commitGadgetFft());
  await waitFor(() => expect(outputs()).toHaveLength(1));
  // The user moves on: another channel, another mode, no region.
  useApp.getState().setQfitRoi(null);
  useApp.getState().setGadgetMode("integrate");
  useApp.setState({ yKeys: [0], history: [] });
});

describe("Gadget FFT reopen", () => {
  it("records producer version 2, the region and the channel by position and name", () => {
    const r = results()[0]!;
    expect(r.producer.version).toBe(2);
    expect(r.parameters!["settings"]).toMatchObject({ roi: [2, 20], xKey: null, yKey: 1 });
    expect((r.parameters!["reopen"] as { extra: unknown }).extra).toMatchObject({ channels: { yLabel: "B", yIndex: 1, xIndex: null, xLabel: null } });
  });

  it("re-arms the gadget: FFT mode, the recorded region, the recorded channel plotted as one undoable change", () => {
    expect(reopen()).toBe(true);
    const s = useApp.getState();
    expect(s.gadgetMode).toBe("fft");
    expect(s.qfitRoi).toEqual([2, 20]);
    expect(s.activeId).toBe("src");
    expect(s.yKeys).toEqual([1]);
    expect(s.history.at(-1)?.label).toContain("plot the recorded Gadget FFT channel");
    // No editing session: Add makes a new spectrum, never a silent replace.
    expect(useToolReopen.getState().sessions["gadget-fft"]).toBeUndefined();
  });

  it("Add after a reopen adds a NEW spectrum beside the old one (nothing is replaced)", async () => {
    expect(reopen()).toBe(true);
    await waitFor(() => expect(useApp.getState().gadgetFftPreview).not.toBeNull());
    vi.mocked(fftSpectral).mockResolvedValue({ freq: [0, 1, 2, 3], magnitude: [9, 8, 7, 6], windowName: "hann" } as never);
    act(() => useApp.getState().setQfitRoi([3, 21]));
    await waitFor(() => expect(useApp.getState().gadgetFftPreview?.magnitude?.[0]).toBe(9));
    act(() => useApp.getState().commitGadgetFft());
    await waitFor(() => expect(outputs()).toHaveLength(2));
    expect(results()).toHaveLength(2);
  });

  it("a result saved before the channel was recorded refuses with the existing reason", () => {
    useApp.setState((s) => ({ analysisResults: s.analysisResults.map((r) => ({ ...r, producer: { ...r.producer, version: 1 } })) }));
    expect(reopen()).toBe(false);
    expect(useApp.getState().status).toContain("saved before its settings were recorded, so it cannot be reopened");
    expect(useApp.getState().gadgetMode).toBe("integrate");
    expect(useApp.getState().qfitRoi).toBeNull();
  });

  const untouched = () => {
    expect(useApp.getState().gadgetMode).toBe("integrate");
    expect(useApp.getState().qfitRoi).toBeNull();
    expect(useApp.getState().yKeys).toEqual([0]);
  };

  it("a moved channel is NOT guessed: the gadget and the plot stay as they were, the status names it", () => {
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, data: { ...d.data, labels: ["B", "A"] } })) }));
    expect(reopen()).toBe(false);
    expect(useApp.getState().status).toContain("“B” is no longer at its place");
    untouched();
  });

  it("an unreadable region is NOT guessed", () => {
    edit((settings) => { settings["roi"] = [5, 5]; });
    expect(reopen()).toBe(false);
    expect(useApp.getState().status).toContain("incomplete");
    untouched();
  });

  it("settings that disagree with the recorded channel are NOT guessed", () => {
    edit((settings) => { settings["yKey"] = 0; });
    expect(reopen()).toBe(false);
    untouched();
  });

  it("a deleted source opens nothing and says why", () => {
    useApp.setState((s) => ({ datasets: s.datasets.filter((d) => d.id !== "src") }));
    expect(reopen()).toBe(false);
    expect(useApp.getState().status).toContain("no longer exists");
    expect(useApp.getState().gadgetMode).toBe("integrate");
  });

  it("the strict reader needs a finite ascending region and a recorded channel", () => {
    expect(gadgetFftSeed({ roi: [1, 2], xKey: null, yKey: 0 })).toEqual({ roi: [1, 2], xKey: null, yKey: 0 });
    expect(gadgetFftSeed({ roi: [2, 1], xKey: null, yKey: 0 })).toBeNull();
    expect(gadgetFftSeed({ roi: [1, null], xKey: null, yKey: 0 })).toBeNull();
    expect(gadgetFftSeed({ roi: [1, 2], xKey: 1.5, yKey: 0 })).toBeNull();
    expect(gadgetFftSeed({ roi: [1, 2], xKey: null, yKey: null })).toBeNull();
    expect(gadgetFftSeed(null)).toBeNull();
  });
});
