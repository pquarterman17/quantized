// "Publish to peak table" through the real usePeakWizard -> useModelFit ->
// store path (audit P2.1): a converged, current model fit lands in the active
// dataset's durable table with its errors; a stale or non-converged one is
// refused with its reason and writes nothing. Waits are on STATE.

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PeakModelFitResponse } from "../../../lib/api/peaks";
import type { DataStruct, Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { modelFitResponse } from "./modelFit.testkit";
import * as run from "./modelFitPublishRun";
import { usePeakWizard } from "./usePeakWizard";

/** A lazy-book reference; its shape never matters here (nothing fetches). */
const PENDING = { kind: "origin", path: "x.opju", book: "Book1" } as unknown as NonNullable<Dataset["pending"]>;

const N = 60;
const DATA: DataStruct = {
  time: Array.from({ length: N }, (_, i) => i / 10),
  values: Array.from({ length: N }, (_, i) => [1 + Math.exp(-((i - 20) ** 2) / 8) + 0.5 * Math.exp(-((i - 40) ** 2) / 8)]),
  labels: ["I"],
  units: ["cts"],
  metadata: { x_column_name: "2-Theta", x_column_unit: "deg" },
};

function stubFit(res: PeakModelFitResponse) {
  vi.stubGlobal("fetch", () =>
    Promise.resolve(new Response(JSON.stringify(res), { status: 200, headers: { "Content-Type": "application/json" } })));
}

beforeEach(() => {
  localStorage.clear();
  useApp.setState({
    datasets: [{ id: "d1", name: "scan", data: DATA }],
    activeId: "d1", xKey: null, yKeys: null, seriesOrder: null,
    peakOverlay: null, baselineOverlay: null, fitOverlay: null, peakWizardEdit: null,
    history: [], future: [],
  });
});
afterEach(() => vi.unstubAllGlobals());

async function fitted(res: PeakModelFitResponse) {
  stubFit(res);
  const hook = renderHook(() => usePeakWizard());
  act(() => hook.result.current.addPeakAt(2));
  act(() => hook.result.current.addPeakAt(4));
  await act(() => hook.result.current.model.run());
  await waitFor(() => expect(hook.result.current.model.result).not.toBeNull());
  return hook;
}

describe("useModelFit — publish to the durable peak table", () => {
  it("writes the fit, its standard errors and provenance into the active dataset", async () => {
    const { result } = await fitted(modelFitResponse());
    expect(result.current.model.publishBlock).toBeNull();
    await act(() => result.current.model.publish());
    const t = useApp.getState().datasets[0].peakTable;
    expect(t?.provenance).toMatchObject({ producer: "model_fit", datasetId: "d1", xLabel: "2-Theta", xUnit: "deg" });
    expect(t?.provenance.recipe).toMatch(/full range · baseline /);
    expect(t?.peaks.map((p) => p.centerErr)).toEqual([0.004, null]);
    expect(t?.peaks[1].errReasons?.center).toMatch(/^fixed/);
    expect(useApp.getState().history.map((h) => h.label)).toEqual(["publish model fit"]);
  });

  it("refuses a stale fit — the table changed since — and writes nothing", async () => {
    const { result } = await fitted(modelFitResponse());
    act(() => result.current.model.patch("p0.height", { value: 9 }));
    await waitFor(() => expect(result.current.model.stale).toBe(true));
    expect(result.current.model.publishBlock).toMatch(/Re-fit/);
    await act(() => result.current.model.publish());
    expect(useApp.getState().datasets[0].peakTable).toBeUndefined();
    expect(result.current.model.error).toMatch(/Re-fit/);
  });

  it("a failing publish is shown to the user, never swallowed", async () => {
    const spy = vi.spyOn(run, "publishModelFit").mockImplementation(() => {
      throw new Error("chunk failed to load");
    });
    try {
      const { result } = await fitted(modelFitResponse());
      await act(() => result.current.model.publish());
      expect(result.current.model.error).toMatch(/could not publish to the peak table — chunk failed to load/);
      expect(useApp.getState().datasets[0].peakTable).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });

  it("activating a lazy book does NOT resolve it synchronously (why the next test exists)", () => {
    // setActive -> ensureBookData only STARTS the fetch; hold it open.
    vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
    useApp.setState({ datasets: [{ id: "d2", name: "book", data: DATA, pending: PENDING }] });
    useApp.getState().setActive("d2");
    expect(useApp.getState().datasets[0].pending).toBeDefined();
  });

  it("refuses to publish a fit made on a lazy book's PREVIEW, and says why", async () => {
    const { result } = await fitted(modelFitResponse());
    act(() => {
      useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, pending: PENDING })) }));
    });
    expect(result.current.model.publishBlock).toMatch(/full data is still loading.*preview/);
    await act(() => result.current.model.publish());
    expect(useApp.getState().datasets[0].peakTable).toBeUndefined();
    expect(result.current.model.error).toMatch(/still loading/);
  });

  it("refuses a fit that did not converge", async () => {
    const { result } = await fitted(modelFitResponse({ success: false }));
    expect(result.current.model.publishBlock).toMatch(/did not converge/);
    await act(() => result.current.model.publish());
    expect(useApp.getState().datasets[0].peakTable).toBeUndefined();
  });
});
