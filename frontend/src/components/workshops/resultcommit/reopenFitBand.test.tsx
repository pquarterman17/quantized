// "Open in Curve Fit" for a fit band (lane RO3). The band result records a
// digest of the fit it was drawn from; reopening restores the band's level and
// prediction setting on the recorded source, and Replace stays available only
// while the live fit IS the recorded one (otherwise Add as a new output, with
// the reason). A result saved before the digest was recorded does not reopen.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitBands, type BandsResult } from "../../../lib/api/fitStats";
import type { Dataset } from "../../../lib/types";
import { rememberCurveFitOverlay } from "../../../store/curveFitOverlay";
import { bandPrefs } from "../../../store/curveFitSession";
import { useToolReopen } from "../../../store/toolReopen";
import { openCommittedResultInTool } from "../../../store/toolReopenOpen";
import { useApp } from "../../../store/useApp";
import { useFitBands, type FitBandsTarget } from "../curvefit/useFitBands";

vi.mock("../../../lib/api/fitStats", () => ({ fitBands: vi.fn() }));

const DS: Dataset = {
  id: "d1", name: "run.dat",
  data: { time: [0, 1, 2, 3, 4], values: [[1], [3], [5], [7], [9]], labels: ["M"], units: ["emu"], metadata: {} },
};
const TARGET: FitBandsTarget = {
  dataset: DS, model: "Linear",
  result: { params: [2, 1], covar: [[0.01, 0], [0, 0.02]], nPoints: 5, nFree: 2, MSE: 0.04 },
  fitData: { x: [0, 1, 2, 3, 4], y: [1, 3, 5, 7, 9], xKey: null, yKey: 0 },
};
const OTHER_FIT: FitBandsTarget = { ...TARGET, result: { ...TARGET.result, params: [2.1, 1], covar: [[0.02, 0], [0, 0.02]] } };

const bandFor = (x: number[], level: number): BandsResult => ({
  yFit: x.map((v) => 2 * v + 1), ciLo: x.map((v) => 2 * v + 0.5), ciHi: x.map((v) => 2 * v + 1.5),
  piLo: x.map((v) => 2 * v), piHi: x.map((v) => 2 * v + 2), level,
});

const outputs = () => useApp.getState().datasets.filter((d) => d.id !== "d1");
const results = () => useApp.getState().analysisResults;
const session = () => useToolReopen.getState().sessions["fit-band"]!;

/** Draw the band for `target` and plot it, then close the section. */
async function plotBand(target: FitBandsTarget, level = 0.68, prediction = false): Promise<void> {
  const hook = renderHook(() => useFitBands(target));
  act(() => { hook.result.current.setOn(true); hook.result.current.setLevel(level); hook.result.current.setPrediction(prediction); });
  await waitFor(() => expect(hook.result.current.halfWidth).toBe(0.5));
  await waitFor(() => expect(hook.result.current.busy).toBe(false));
  act(() => hook.result.current.plot());
  hook.unmount();
}

beforeEach(async () => {
  vi.clearAllMocks();
  Object.assign(bandPrefs, { on: false, level: 0.95, prediction: false });
  rememberCurveFitOverlay(null);
  vi.mocked(fitBands).mockImplementation((req) => Promise.resolve(bandFor(req.x, req.level ?? 0.95)));
  useToolReopen.setState({ sessions: {} });
  useApp.setState({
    datasets: [DS], activeId: "d1", fitOverlay: null, analysisResults: [], history: [], future: [], staleDatasets: [], staleFits: [],
    recalcMode: "manual", curveFitOpen: false, status: "", plotWindows: [], focusedWindowId: null,
  });
  await plotBand(TARGET);
  Object.assign(bandPrefs, { on: false, level: 0.95, prediction: false }); // the user's saved preferences, not the setup's
  expect(outputs()).toHaveLength(1);
});

describe("Fit band: reopen, adjust, replace", () => {
  it("records producer version 2 and a digest of the fit beside the model, level and prediction flag", () => {
    const result = results()[0]!;
    expect(result.producer).toMatchObject({ id: "fit-band", version: 2 });
    const settings = result.parameters!["settings"] as Record<string, unknown>;
    expect(settings).toMatchObject({ model: "Linear", level: 0.68, prediction: false });
    expect(String(settings["fit"])).toMatch(/^[0-9a-f]{16}-[0-9a-f]{16}$/);
  });

  it("reopens Curve Fit on the recorded source with the band ON at its level and prediction setting", () => {
    act(() => { expect(openCommittedResultInTool(results()[0]!.id)).toBe(true); });
    expect(useApp.getState().curveFitOpen).toBe(true);
    expect(session().notice).toContain("fit “Linear” on this worksheet again");
    const { result } = renderHook(() => useFitBands(TARGET));
    expect(result.current.on).toBe(true);
    expect(result.current.level).toBe(0.68);
    expect(result.current.prediction).toBe(false);
    expect(bandPrefs).toMatchObject({ on: false, level: 0.95 }); // the saved preferences are untouched
    expect(session().mode).toBe("replace");
  });

  it("Replace on the SAME fit rewrites the output in ONE undo step, keeping its id and the result id", async () => {
    const [old] = outputs();
    const oldResult = results()[0]!;
    act(() => { openCommittedResultInTool(oldResult.id); });
    const before = useApp.getState().history.length;
    const hook = renderHook(() => useFitBands(TARGET));
    act(() => hook.result.current.setLevel(0.9));
    await waitFor(() => expect(hook.result.current.halfWidth).toBe(0.5));
    await waitFor(() => expect(hook.result.current.busy).toBe(false));
    expect(hook.result.current.plotDisabledReason).toBeNull();
    act(() => hook.result.current.plot());
    expect(outputs()).toHaveLength(1);
    expect(outputs()[0]!.id).toBe(old!.id);
    expect(results()).toHaveLength(1);
    expect(results()[0]!.id).toBe(oldResult.id);
    expect((results()[0]!.parameters!["settings"] as { level: number }).level).toBe(0.9);
    expect(useApp.getState().history.length).toBe(before + 1);
    act(() => useApp.getState().undo());
    expect(results()).toEqual([oldResult]);
    expect(outputs()[0]!.data).toEqual(old!.data);
  });

  it("a different live fit turns Replace into Add as new, with the reason, and adds beside the old band", async () => {
    act(() => { openCommittedResultInTool(results()[0]!.id); });
    const hook = renderHook(() => useFitBands(OTHER_FIT));
    act(() => hook.result.current.setLevel(0.9));
    await waitFor(() => expect(hook.result.current.halfWidth).toBe(0.5));
    await waitFor(() => expect(session().layoutBlocked).toContain("current fit differs from the one this band was drawn from"));
    expect(session().mode).toBe("new");
    await waitFor(() => expect(hook.result.current.busy).toBe(false));
    act(() => hook.result.current.plot());
    expect(outputs()).toHaveLength(2);
    expect(results()).toHaveLength(2);
  });

  it("a different model is named in the reason", async () => {
    act(() => { openCommittedResultInTool(results()[0]!.id); });
    renderHook(() => useFitBands({ ...TARGET, model: "Quadratic" }));
    await waitFor(() => expect(session().layoutBlocked).toContain("current fit is “Quadratic”, not the “Linear”"));
  });

  it("a result saved before the fit was recorded (producer version 1) refuses with a one-sentence reason", () => {
    useApp.setState((s) => ({ analysisResults: s.analysisResults.map((r) => ({ ...r, producer: { ...r.producer, version: 1 } })) }));
    act(() => { expect(openCommittedResultInTool(results()[0]!.id)).toBe(false); });
    expect(useApp.getState().status).toContain("saved before its settings were recorded, so it cannot be reopened");
    expect(useApp.getState().curveFitOpen).toBe(false);
    expect(useToolReopen.getState().sessions).toEqual({});
  });

  it("a deleted source opens Curve Fit with no settings, a notice and no Replace", () => {
    useApp.setState((s) => ({ datasets: s.datasets.filter((d) => d.id !== "d1") }));
    act(() => { expect(openCommittedResultInTool(results()[0]!.id)).toBe(true); });
    expect(session().seed).toBeNull();
    expect(session().notice).toContain("no longer exists");
    expect(session().mode).toBe("new");
  });
});
