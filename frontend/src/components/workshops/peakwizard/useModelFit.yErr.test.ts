// Peak Analyzer model fit: the primary channel's designated error column
// (the view's `errKeys`, the same pick the curve-fit workshop's "Y error
// column" weighting makes) rides along as `y_err`, cut to the fitted segment.
// No designation, or an unusable column, keeps the fit unweighted. Waits are on
// hook STATE, never on a mock.

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { modelFitResponse } from "./modelFit.testkit";
import { usePeakWizard } from "./usePeakWizard";

const N = 60;
const sigma = (i: number) => 0.1 + i / 1000;
const DATA: DataStruct = {
  time: Array.from({ length: N }, (_, i) => i / 10),
  values: Array.from({ length: N }, (_, i) => [
    1 + Math.exp(-((i - 20) ** 2) / 8) + 0.5 * Math.exp(-((i - 40) ** 2) / 8),
    // Negative on purpose: an error column's sign carries no meaning (|dy|).
    i % 2 ? sigma(i) : -sigma(i),
  ]),
  labels: ["I", "dI"],
  units: ["cts", "cts"],
  metadata: {},
};

let bodies: Record<string, unknown>[] = [];

beforeEach(() => {
  bodies = [];
  localStorage.clear();
  vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(init.body as string) as Record<string, unknown>);
    return Promise.resolve(
      new Response(JSON.stringify(modelFitResponse()), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
  });
  useApp.setState({
    datasets: [{ id: "d1", name: "scan", data: DATA }],
    activeId: "d1",
    xKey: null,
    yKeys: [0],
    seriesOrder: null,
    errKeys: { 0: 1 },
    peakOverlay: null,
    baselineOverlay: null,
    fitOverlay: null,
    peakWizardEdit: null,
  });
});
afterEach(() => vi.unstubAllGlobals());

async function fitTwoPeaks() {
  const hook = renderHook(() => usePeakWizard());
  act(() => hook.result.current.addPeakAt(2));
  act(() => hook.result.current.addPeakAt(4));
  act(() => hook.result.current.patchRecipe({ range: { lo: 0.5 } }));
  await act(() => hook.result.current.model.run());
  await waitFor(() => expect(hook.result.current.model.result).not.toBeNull());
  return hook;
}

describe("useModelFit — y_err from the designated error column", () => {
  it("sends |error column| over exactly the fitted segment's rows", async () => {
    await fitTwoPeaks();
    const body = bodies.at(-1)!;
    const x = body.x as number[];
    expect(x[0]).toBe(0.5);
    const rows = x.map((t) => Math.round(t * 10));
    expect(body.y_err).toEqual(rows.map((i) => sigma(i)));
  });

  it("no designated error column: the request carries no y_err", async () => {
    useApp.setState({ errKeys: {} });
    await fitTwoPeaks();
    expect(bodies.at(-1)).not.toHaveProperty("y_err");
  });

  it("a column with a zero or invalid sigma fits unweighted, like the curve fit", async () => {
    const values = DATA.values.map((r, i) => (i === 7 ? [r[0], 0] : r));
    useApp.setState({ datasets: [{ id: "d1", name: "scan", data: { ...DATA, values } }] });
    await fitTwoPeaks();
    expect(bodies.at(-1)).not.toHaveProperty("y_err");
  });

  it("changing the error designation invalidates a landed fit", async () => {
    const { result } = await fitTwoPeaks();
    act(() => useApp.setState({ errKeys: {} }));
    await waitFor(() => expect(result.current.model.result).toBeNull());
  });
});
