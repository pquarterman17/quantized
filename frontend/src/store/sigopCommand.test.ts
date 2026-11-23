// The filter / Reduce XY bridge: a repeat of the same filter on the same data
// adds nothing and says so (result audit row 25); a different one is created.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SigopParams } from "../lib/transformSigop";
import type { Dataset } from "../lib/types";
import { createSigopFromApp } from "./sigopCommand";
import { useToasts } from "./toasts";
import { useApp } from "./useApp";

const { sigop } = vi.hoisted(() => ({ sigop: vi.fn() }));
vi.mock("../lib/api/sigopByHandle", () => ({ sigopOf: sigop }));

const sheet: Dataset = {
  id: "a", name: "a.dat",
  data: { time: [0, 1, 2, 3, 4, 5], values: [1, 5, 2, 8, 3, 9].map((y) => [y]), labels: ["Y"], units: ["V"], metadata: {} },
};
const outputs = () => useApp.getState().datasets.filter((d) => d.id !== "a");

beforeEach(() => {
  sigop.mockResolvedValue({
    dataset: { time: [0, 1], values: [[1], [2]], labels: ["Y"], units: ["V"], metadata: {} }, flagged: {}, warnings: [],
  });
  useToasts.setState({ toasts: [] });
  useApp.setState({
    datasets: [sheet], activeId: "a", selectedIds: ["a"], macroRecording: true, macroSteps: [],
    analysisResults: [], history: [], future: [], staleDatasets: [], recalcMode: "manual",
  });
});

describe("createSigopFromApp", () => {
  it("creates once, then reports the identical repeat instead of duplicating; redo restores", async () => {
    const params: SigopParams = { op: "sigop", method: "median", channels: [0], args: { window: 3 } };
    expect(await createSigopFromApp(params, "a")).toBe(true);
    expect(outputs()).toHaveLength(1);
    expect(await createSigopFromApp(params, "a")).toBe(true);
    expect(outputs()).toHaveLength(1);
    expect(useApp.getState().macroSteps).toHaveLength(1);
    expect(useApp.getState().status).toMatch(/already added/);
    expect(JSON.stringify(useToasts.getState().toasts)).toMatch(/already added/);
    useApp.getState().undo();
    expect(outputs()).toHaveLength(0);
    useApp.getState().redo();
    expect(outputs()).toHaveLength(1);
    expect(useApp.getState().analysisResults).toHaveLength(1);
  });
});
