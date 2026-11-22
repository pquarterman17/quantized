// Reflectivity DREAM, lane WB5 audit: nothing to change. A DREAM run is always
// OF a stored fit record: it re-sends exactly the record's parameters and data
// (refused when the data moved: useReflDream.test), writes the posterior back to
// THAT record, and the live bands belong to exactly that stored posterior. So the
// live form (parameter table, bindings) moving on, or the sampling controls being
// edited, neither changes the run nor marks the stored posterior. Pinned here.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { cancelReflJob, pollReflJob, reflDream, reflFit, reflPresets } from "../../../lib/api/reflectivity";
import { usePendingOps } from "../../../store/pendingOps";
import { useApp } from "../../../store/useApp";
import { dreamResult, fitResponse, TEST_PRESETS, xrrDataset } from "./reflFit.testkit";
import { recordsFor } from "./reflFitRecord";
import { useReflFit } from "./useReflFit";
import { useReflectivity } from "./useReflectivity";

vi.mock("uplot", async () => ({ default: (await import("./reflFit.testkit")).UPlotStub }));
vi.mock("../../../lib/api/reflectivity", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/api/reflectivity")>("../../../lib/api/reflectivity");
  return {
    reflPresets: vi.fn(), reflSimulate: vi.fn(), reflSldProfile: vi.fn(), reflFit: vi.fn(), reflDream: vi.fn(),
    pollReflJob: vi.fn(), cancelReflJob: vi.fn(), ReflJobCancelled: actual.ReflJobCancelled,
  };
});

function useBoth() {
  const refl = useReflectivity();
  const fit = useReflFit(refl);
  return { refl, fit };
}

beforeEach(() => {
  vi.resetAllMocks();
  usePendingOps.setState({ ops: [] });
  vi.mocked(reflPresets).mockResolvedValue({ presets: TEST_PRESETS });
  vi.mocked(cancelReflJob).mockResolvedValue({});
  vi.mocked(reflDream).mockResolvedValue({ job_id: "j1", plan: { n_free: 3, n_chains: 12, n_generations: 1033, n_evaluations: 12500, band_draws: 200 } });
  vi.mocked(pollReflJob).mockResolvedValue(dreamResult() as never);
  useApp.setState({ datasets: [xrrDataset("xrr")], activeId: "xrr", status: "", fitOverlay: null, reflectivitySeed: null });
});

async function fitted() {
  vi.mocked(reflFit).mockResolvedValueOnce(fitResponse());
  const view = renderHook(() => useBoth());
  await waitFor(() => expect(view.result.current.refl.presets).toHaveLength(TEST_PRESETS.length));
  await act(async () => { await view.result.current.fit.run(); });
  return view;
}

describe("reflectivity DREAM is scoped to its stored record", () => {
  it("a live form edited after the fit does not change what DREAM samples, and the stored posterior is not marked", async () => {
    const { result } = await fitted();
    const record = recordsFor(useApp.getState().datasets[0])[0]!;
    const row = result.current.fit.params.find((p) => p.name === "L1.thickness")!;
    act(() => result.current.fit.setParam("L1.thickness", { vary: !row.vary }));
    expect(result.current.fit.stale).toBe(true); // the live fit result is out of date...
    await act(async () => { await result.current.fit.dream.run(record); });
    // ...but the run re-sent the RECORD's parameters, not the edited table.
    expect(vi.mocked(reflDream).mock.calls[0]![0].parameters).toEqual(record.request.parameters);
    const stored = recordsFor(useApp.getState().datasets[0])[0]!;
    expect(stored.posterior).toBeDefined();
    expect(result.current.fit.dream.hasBands(stored)).toBe(true);
  });

  it("editing the sampling controls leaves a stored posterior and its bands as they were", async () => {
    const { result } = await fitted();
    const record = recordsFor(useApp.getState().datasets[0])[0]!;
    await act(async () => { await result.current.fit.dream.run(record); });
    const drawn = recordsFor(useApp.getState().datasets[0])[0]!.posterior;
    act(() => result.current.fit.dream.setSettings({ samples: 500 }));
    const after = recordsFor(useApp.getState().datasets[0])[0]!;
    expect(after.posterior).toBe(drawn);
    expect(result.current.fit.dream.hasBands(after)).toBe(true);
  });
});
