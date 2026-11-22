// Peak analyzer model fit on the workbench shell's out-of-date pattern (lane
// WB4). The engine already drops a result on a content-key change and marks a
// table edit stale (see useModelFit.test.ts); this pins what the lane relies on
// and adds the refusal / error distinction for WorkbenchMessage: an edit made
// while the fit is in flight lands stale (never current), and the preflight
// refusals are told apart from a backend failure.

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { modelFitResponse } from "./modelFit.testkit";
import { usePeakWizard } from "./usePeakWizard";

const N = 60;
const DATA: DataStruct = {
  time: Array.from({ length: N }, (_, i) => i / 10),
  values: Array.from({ length: N }, (_, i) => [1 + Math.exp(-((i - 20) ** 2) / 8) + 0.5 * Math.exp(-((i - 40) ** 2) / 8)]),
  labels: ["I"], units: ["cts"], metadata: {},
};

let pending: { resolve: (r: Response) => void }[] = [];
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function holdFetch() {
  vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => pending.push({ resolve })));
}

beforeEach(() => {
  pending = [];
  localStorage.clear();
  useApp.setState({
    datasets: [{ id: "d1", name: "scan", data: DATA }], activeId: "d1", xKey: null, yKeys: null, seriesOrder: null,
    peakOverlay: null, baselineOverlay: null, fitOverlay: null, peakWizardEdit: null,
  });
});
afterEach(() => vi.unstubAllGlobals());

function wizardWithTwoPeaks() {
  const hook = renderHook(() => usePeakWizard());
  act(() => hook.result.current.addPeakAt(2));
  act(() => hook.result.current.addPeakAt(4));
  return hook;
}

describe("useModelFit out of date", () => {
  it("forced race: a table edit made while the fit runs lands stale, off the plot, and blocks report / integrate", async () => {
    holdFetch();
    const { result } = wizardWithTwoPeaks();
    let run!: Promise<void>;
    act(() => { run = result.current.model.run(); });
    expect(result.current.model.busy).toBe(true);
    act(() => result.current.model.patch("p0.center", { min: 1 })); // a table edit, not a content-key change
    await act(async () => {
      pending[0]!.resolve(json(200, modelFitResponse()));
      await run;
    });
    expect(result.current.model.result).not.toBeNull();
    expect(result.current.model.stale).toBe(true);
    expect(result.current.canReportFit).toBe(false);
    expect(result.current.model.publishBlock).toMatch(/re-fit before publishing/);
    expect(useApp.getState().fitOverlay).toBeNull();
  });

  it("the preflight failures are refusals; a backend failure is not", async () => {
    const { result } = renderHook(() => usePeakWizard()); // no peaks yet
    await act(() => result.current.model.run());
    expect(result.current.model.error).toBe("include at least one peak first");
    expect(result.current.model.errorRefusal).toBe(true);

    const two = wizardWithTwoPeaks();
    vi.stubGlobal("fetch", () => Promise.resolve(json(422, { detail: "ASCII failure" })));
    await act(() => two.result.current.model.run());
    expect(two.result.current.model.error).toMatch(/ASCII failure/);
    expect(two.result.current.model.errorRefusal).toBe(false);
  });
});
