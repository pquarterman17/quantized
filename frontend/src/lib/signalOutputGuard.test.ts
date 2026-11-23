// Signal Processing's interactive Create adds nothing on a repeat (result audit
// row 25, criterion 11); a replay (no skipDuplicate) is a recorded run and still
// creates its output.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useApp } from "../store/useApp";
import type { Dataset } from "./types";

const { applyMock } = vi.hoisted(() => ({ applyMock: vi.fn() }));
vi.mock("./api", async (importOriginal) => ({ ...(await importOriginal<typeof import("./api")>()), applyCorrections: applyMock }));

const { runTransform } = await import("./transformRun");

const source: Dataset = {
  id: "source", name: "scan",
  data: { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["Y"], units: ["V"], metadata: {} },
};
const params = {
  op: "signal" as const,
  recipe: {
    kind: "signal-correction" as const, version: 1 as const, xUnit: "", operation: "Detrend",
    channels: [{ index: 0, label: "Y", unit: "V" }], params: { signalChannels: [0], detrendOrder: 1 },
  },
};
const outputs = () => useApp.getState().datasets.filter((d) => d.id !== "source");

beforeEach(() => {
  vi.clearAllMocks();
  applyMock.mockResolvedValue({ ...source.data, values: [[-1], [0], [1]] });
  useApp.setState({
    datasets: [source], activeId: "source", selectedIds: ["source"], macroRecording: true, macroSteps: [],
    analysisResults: [], history: [], future: [], staleDatasets: [],
  });
});

describe("runTransform signal skipDuplicate", () => {
  it("a repeat of the identical Create adds nothing and says so", async () => {
    const first = await runTransform(useApp.getState, params, "source", undefined, undefined, undefined, true);
    expect(first?.existing).toBeUndefined();
    const steps = useApp.getState().macroSteps.length;
    const again = await runTransform(useApp.getState, params, "source", undefined, undefined, undefined, true);
    expect(again).toMatchObject({ id: first!.id, existing: true });
    expect(outputs()).toHaveLength(1);
    expect(useApp.getState().analysisResults).toHaveLength(1);
    expect(useApp.getState().macroSteps).toHaveLength(steps);
    expect(useApp.getState().status).toMatch(/already added as “scan \(Detrend\)”; nothing was duplicated/);
  });

  it("different numbers, or an Out of date earlier output, are not duplicates", async () => {
    const first = await runTransform(useApp.getState, params, "source", undefined, undefined, undefined, true);
    applyMock.mockResolvedValue({ ...source.data, values: [[5], [5], [5]] });
    await runTransform(useApp.getState, params, "source", undefined, undefined, undefined, true);
    expect(outputs()).toHaveLength(2);
    applyMock.mockResolvedValue({ ...source.data, values: [[-1], [0], [1]] });
    useApp.setState({ staleDatasets: [first!.id] });
    await runTransform(useApp.getState, params, "source", undefined, undefined, undefined, true);
    expect(outputs()).toHaveLength(3);
  });

  it("replay (no skipDuplicate) is a recorded run and always creates its output", async () => {
    await runTransform(useApp.getState, params, "source");
    await runTransform(useApp.getState, params, "source");
    expect(outputs()).toHaveLength(2);
  });
});
