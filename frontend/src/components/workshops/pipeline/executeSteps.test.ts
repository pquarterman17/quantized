// executeSteps "fit" replay (#6) — the shared step executor must reproduce the
// fit's RECORDED channels + weighting (not time/values[0], unweighted), so a
// recorded pipeline / template batch reproduces the interactive fit. Mocks
// lib/api.fitModel and asserts the EXACT { x, y, dy } it receives per recipe.
// Legacy {model}-only steps (old templates) must keep the old behavior — a
// regression pin lives here too.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset, DataStruct } from "../../../lib/types";
import { makeStep, type PipelineStep } from "../../../lib/pipeline";
import { useApp } from "../../../store/useApp";
import { executeSteps } from "./executeSteps";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  fitModel: vi.fn(),
}));

import { fitModel } from "../../../lib/api";

const data = (): DataStruct => ({
  time: [0, 1, 2, 3],
  values: [
    [100, 10, 0.5],
    [200, 20, 0.6],
    [300, 30, 0.7],
    [400, 40, 0.8],
  ],
  labels: ["field", "moment", "sigma"],
  units: ["Oe", "emu", ""],
  metadata: {},
});

const ds = (over: Partial<Dataset> = {}): Dataset => ({
  id: "a",
  name: "a",
  data: data(),
  ...over,
});

/** A "fit" step carrying `params` (the recorded recipe). */
const fitStep = (params: Record<string, unknown>): PipelineStep =>
  makeStep("fit", "Fit", "qz.fit()", params);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fitModel).mockResolvedValue({ params: [1, 0], R2: 0.9 });
  useApp.setState({
    datasets: [ds()],
    activeId: "a",
    xKey: null,
    yKeys: null,
    seriesOrder: null,
  });
});

async function runFit(step: PipelineStep, target = "a") {
  const { fits, log } = await executeSteps([step], target);
  return { fit: fits[0], entry: log[step.id] };
}

describe("executeSteps fit replay (#6)", () => {
  it("reproduces the recorded xKey/yKey channels (not time/values[0])", async () => {
    await runFit(fitStep({ model: "Linear", xKey: 0, yKey: 1 }));
    expect(fitModel).toHaveBeenCalledWith({
      model: "Linear",
      x: [100, 200, 300, 400],
      y: [10, 20, 30, 40],
    });
  });

  it("passes dy when the recorded weighting resolves against a valid error column", async () => {
    await runFit(fitStep({ model: "Linear", xKey: 0, yKey: 1, weight: { mode: "yerr", errKey: 2 } }));
    expect(fitModel).toHaveBeenCalledWith({
      model: "Linear",
      x: [100, 200, 300, 400],
      y: [10, 20, 30, 40],
      dy: [0.5, 0.6, 0.7, 0.8],
    });
  });

  it("honors the TARGET's row exclusions (analysisData) on replay", async () => {
    useApp.setState({ datasets: [ds({ excludedRows: [1] })] });
    await runFit(fitStep({ model: "Linear", xKey: 0, yKey: 1, weight: { mode: "yerr", errKey: 2 } }));
    expect(fitModel).toHaveBeenCalledWith({
      model: "Linear",
      x: [100, 300, 400],
      y: [10, 30, 40],
      dy: [0.5, 0.7, 0.8],
    });
  });

  it("fits unweighted and notes it when the weight column can't resolve on the target", async () => {
    const { entry } = await runFit(
      fitStep({ model: "Linear", xKey: 0, yKey: 1, weight: { mode: "yerr", errKey: 9 } }),
    );
    // errKey 9 is out of range on the target -> no dy passed.
    expect(fitModel).toHaveBeenCalledWith({
      model: "Linear",
      x: [100, 200, 300, 400],
      y: [10, 20, 30, 40],
    });
    expect(entry.status).toBe("ok");
    expect(entry.note).toMatch(/unweighted/);
  });

  it("falls back to the live plotted selection when the recorded channel is gone", async () => {
    // yKey 9 no longer exists after a column change -> fitDataForSpec falls back
    // to the live selection (live yKeys [1] over the `time` axis).
    useApp.setState({ xKey: null, yKeys: [1], seriesOrder: null });
    await runFit(fitStep({ model: "Linear", xKey: 0, yKey: 9 }));
    expect(fitModel).toHaveBeenCalledWith({
      model: "Linear",
      x: [0, 1, 2, 3],
      y: [10, 20, 30, 40],
    });
  });

  it("regression pin: a legacy {model}-only step fits time vs values[0], unweighted", async () => {
    // Old templates recorded params = { model } only. Their outputs must NOT
    // change under the new channel-aware path.
    await runFit(fitStep({ model: "Linear" }));
    expect(fitModel).toHaveBeenCalledWith({
      model: "Linear",
      x: [0, 1, 2, 3],
      y: [100, 200, 300, 400],
    });
  });

  it("surfaces R² in the step log note", async () => {
    const { entry } = await runFit(fitStep({ model: "Linear", xKey: 0, yKey: 1 }));
    expect(entry).toEqual({ status: "ok", note: "fit R²=0.9000" });
  });
});
