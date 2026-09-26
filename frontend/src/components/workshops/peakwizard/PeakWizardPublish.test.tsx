// "Publish to peak table" in the Peak Analyzer's fit step (audit P2.1
// uncertainties, via the P2.4 model engine), driven through the panel: the
// published durable table carries values, standard errors, null-error
// reasons, shapes and provenance; a stale, non-converged or data-changed fit
// is refused with the reason and writes nothing. Waits are on rendered STATE.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PeakModelFitResponse } from "../../../lib/api/peaks";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { modelFitResponse } from "./modelFit.testkit";
import PeakWizardPanel from "./PeakWizardPanel";

const { findMock, confirmMock } = vi.hoisted(() => ({ findMock: vi.fn(), confirmMock: vi.fn() }));
vi.mock("../../../lib/api/peaks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/peaks")>()),
  findPeaks: findMock,
}));
vi.mock("../../../store/confirmDialog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../store/confirmDialog")>()),
  askConfirm: confirmMock,
}));

const N = 60;
const ds: Dataset = {
  id: "d1",
  name: "xrd scan",
  data: {
    time: Array.from({ length: N }, (_, i) => i / 10),
    // Column 0 is plotted and fitted; column 1 is not (its edit does not
    // change the fit's inputs, but it DOES change the data fingerprint).
    values: Array.from({ length: N }, (_, i) => [
      0.2 + Math.exp(-((i - 20) ** 2) / 8) + 0.6 * Math.exp(-((i - 40) ** 2) / 8),
      i,
    ]),
    labels: ["I", "T"],
    units: ["cts", "K"],
    metadata: {},
  },
};

function stubModelFit(payload: PeakModelFitResponse) {
  vi.stubGlobal("fetch", () =>
    Promise.resolve(new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } })));
}

// Some tests hold or replace `resolveDataset`; every test starts from the real one.
const realResolve = useApp.getState().resolveDataset;

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ resolveDataset: realResolve });
  localStorage.clear();
  findMock.mockResolvedValue({
    peaks: [
      { center: 2, height: 1, bg: 0.2, fwhm: 0.5, prominence: 1, localSNR: 20, area: null },
      { center: 4, height: 0.6, bg: 0.2, fwhm: 0.5, prominence: 0.6, localSNR: 12, area: null },
    ],
    background: [],
  });
  useApp.setState({
    datasets: [ds], activeId: "d1", peakWizardOpen: true, xKey: null, yKeys: [0], seriesOrder: null,
    peakOverlay: null, baselineOverlay: null, fitOverlay: null, history: [], future: [],
  });
});
afterEach(() => vi.unstubAllGlobals());

const step = (name: string) => fireEvent.click(screen.getByText(name, { selector: ".qzk-wizard-step" }));
const publishBtn = () => screen.getByRole("button", { name: "Publish to peak table" });

async function fit(res: PeakModelFitResponse) {
  render(<PeakWizardPanel />);
  step("Find peaks");
  fireEvent.click(screen.getByRole("button", { name: "Find peaks" }));
  await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(2));
  stubModelFit(res);
  step("Fit & review");
  fireEvent.click(screen.getByRole("button", { name: "Fit" }));
  await screen.findByLabelText("fit metrics");
}

describe("Peak Analyzer — Publish to peak table", () => {
  it("writes one durable row per peak with values, errors, reasons and provenance", async () => {
    await fit(modelFitResponse());
    fireEvent.click(publishBtn());
    await screen.findByText(/published 2 peaks with their errors/);
    const t = useApp.getState().datasets[0].peakTable!;
    expect(t.provenance).toMatchObject({ producer: "model_fit", engine: "peak_model_fit", datasetId: "d1", objective: "ssr" });
    expect(t.peaks.map((p) => [p.center, p.centerErr, p.model])).toEqual([[2.01, 0.004, "pseudo_voigt"], [4, null, "gaussian"]]);
    expect(t.peaks[1].errReasons?.center).toMatch(/^fixed/);
    // background under each centre on the plotted trace: the model's constant
    // 0.5 (no step-① baseline in this test)
    expect(t.peaks.map((p) => p.bg)).toEqual([0.5, 0.5]);
    expect(useApp.getState().history.map((h) => h.label)).toEqual(["publish model fit to peak table"]);
  });

  it("stays disabled once published, until an Undo takes the table back", async () => {
    await fit(modelFitResponse());
    fireEvent.click(publishBtn());
    await screen.findByText(/published 2 peaks/);
    expect(publishBtn()).toBeDisabled();
    expect(publishBtn()).toHaveAttribute("title", expect.stringMatching(/already published/));
    expect(screen.queryByText(/Not publishable/)).not.toBeInTheDocument();
    act(() => useApp.getState().undo());
    expect(useApp.getState().datasets[0].peakTable).toBeUndefined();
    expect(screen.queryByText(/published 2 peaks/)).not.toBeInTheDocument();
    expect(publishBtn()).toBeEnabled();
  });

  it("publishes once per click burst: a double click is one undo step", async () => {
    await fit(modelFitResponse());
    fireEvent.click(publishBtn());
    fireEvent.click(publishBtn());
    await screen.findByText(/published 2 peaks/);
    expect(useApp.getState().history.map((h) => h.label)).toEqual(["publish model fit to peak table"]);
    expect(confirmMock).not.toHaveBeenCalled(); // nothing to replace
  });

  it("asks before REPLACING an existing table; cancelling keeps it untouched", async () => {
    await fit(modelFitResponse());
    fireEvent.click(publishBtn());
    await screen.findByText(/published 2 peaks/);
    const first = useApp.getState().datasets[0].peakTable;

    confirmMock.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "Re-fit" }));
    await waitFor(() => expect(screen.queryByText(/published 2 peaks/)).not.toBeInTheDocument());
    await screen.findByLabelText("fit metrics");
    fireEvent.click(publishBtn());
    await waitFor(() => expect(publishBtn()).toBeEnabled());
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(String(confirmMock.mock.calls[0][1])).toMatch(/already has a 2-peak table \(a Peak Analyzer model fit/);
    expect(useApp.getState().datasets[0].peakTable).toBe(first);

    confirmMock.mockResolvedValueOnce(true);
    fireEvent.click(publishBtn());
    await screen.findByText(/published 2 peaks/);
    expect(useApp.getState().datasets[0].peakTable).not.toBe(first);
  });

  it("drops the 'published' note once the table is edited (the fit went stale)", async () => {
    await fit(modelFitResponse());
    fireEvent.click(publishBtn());
    await screen.findByText(/published 2 peaks/);
    step("Model");
    fireEvent.click(screen.getAllByRole("checkbox", { name: /vary/ })[0]);
    step("Fit & review");
    expect(screen.queryByText(/published 2 peaks/)).not.toBeInTheDocument();
  });

  it("refuses a non-converged fit, naming why, and writes nothing", async () => {
    await fit(modelFitResponse({ success: false }));
    expect(publishBtn()).toBeDisabled();
    expect(screen.getByText(/Not publishable: an unconverged fit is not a result/)).toBeInTheDocument();
    expect(useApp.getState().datasets[0].peakTable).toBeUndefined();
  });

  it("refuses a STALE fit (the table changed since) until a re-fit", async () => {
    await fit(modelFitResponse());
    step("Model");
    fireEvent.click(screen.getAllByRole("checkbox", { name: /vary/ })[0]);
    step("Fit & review");
    expect(publishBtn()).toBeDisabled();
    expect(screen.getByText(/Not publishable: the parameters changed since this fit/)).toBeInTheDocument();
  });

  it("refuses when the dataset's data changed after the fit, even outside the fitted columns", async () => {
    await fit(modelFitResponse());
    const edited = { ...ds, data: { ...ds.data, values: ds.data.values.map((r, i) => (i === 0 ? [r[0], 99] : r)) } };
    act(() => useApp.setState({ datasets: [edited] }));
    fireEvent.click(publishBtn());
    await screen.findByText(/not published — the dataset's data changed since this fit/);
    expect(useApp.getState().datasets[0].peakTable).toBeUndefined();
  });

  it("a re-fit/reset during an in-flight publish CANCELS the write, and Fit is blocked meanwhile", async () => {
    await fit(modelFitResponse());
    let release!: () => void;
    useApp.setState({
      resolveDataset: (id: string) => new Promise((r) => {
        release = () => r(useApp.getState().datasets.find((d) => d.id === id));
      }),
    });
    fireEvent.click(publishBtn());
    await waitFor(() => expect(publishBtn()).toBeDisabled()); // publishing
    expect(screen.getByRole("button", { name: "Re-fit" })).toBeDisabled();
    // A reset while the publish awaits: un-include a peak (the content key moves).
    step("Find peaks");
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    await act(async () => release());
    step("Fit & review");
    await screen.findByText(/not published — a newer fit, reset or dataset change superseded it/);
    expect(useApp.getState().datasets[0].peakTable).toBeUndefined();
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("a refusal SURVIVES the reset that resolving a preview causes: the user always sees why", async () => {
    await fit(modelFitResponse());
    // Resolving swaps in the full record (one more row), which moves the
    // content key and resets the hook — after the refusal has been decided.
    const full = { ...ds, data: { ...ds.data, time: [...ds.data.time, 6], values: [...ds.data.values, [0.2, 60]] } };
    useApp.setState({
      resolveDataset: async () => {
        useApp.setState({ datasets: [full] });
        return full;
      },
    });
    fireEvent.click(publishBtn());
    await screen.findByText(/not published — the dataset's data changed since this fit/);
    await waitFor(() => expect(screen.queryByLabelText("fit metrics")).not.toBeInTheDocument()); // the reset ran
    expect(screen.getByText(/not published — the dataset's data changed since this fit/)).toBeInTheDocument();
    expect(useApp.getState().datasets[0].peakTable).toBeUndefined();
  });

  it("a refusal stays on screen through a LATER reset (it is not the reset-cleared note)", async () => {
    await fit(modelFitResponse());
    // Refused without moving the content key: only the unfitted T column changed.
    const edited = { ...ds, data: { ...ds.data, values: ds.data.values.map((r, i) => (i === 0 ? [r[0], 99] : r)) } };
    act(() => useApp.setState({ datasets: [edited] }));
    fireEvent.click(publishBtn());
    await screen.findByText(/not published — the dataset's data changed since this fit/);
    // NOW a reset: un-include a peak (the key moves; the result goes).
    step("Find peaks");
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    step("Fit & review");
    await waitFor(() => expect(screen.queryByLabelText("fit metrics")).not.toBeInTheDocument());
    expect(screen.getByText(/not published — the dataset's data changed since this fit/)).toBeInTheDocument();
  });
});
