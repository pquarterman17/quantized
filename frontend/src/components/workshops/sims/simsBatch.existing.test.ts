// A SIMS batch over profiles whose output is already added reports each as
// "already added" (a failure row with that reason), never as created, and adds
// nothing (result audit row 25).
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { runSimsBatch } from "./simsBatch";

const { process } = vi.hoisted(() => ({ process: vi.fn() }));
vi.mock("../../../lib/api/sims", () => ({ processSims: process }));

const profile = (id: string): Dataset => ({
  id, name: `${id}.dat`,
  data: { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["B"], units: ["counts"], metadata: {} },
});
const outputs = () => useApp.getState().datasets.filter((d) => !["a", "b"].includes(d.id));

beforeEach(() => {
  process.mockResolvedValue({
    dataset: { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["B"], units: ["counts"], metadata: {} }, warnings: [],
  });
  useApp.setState({
    datasets: [profile("a"), profile("b")], activeId: "a", selectedIds: ["a"], macroRecording: true, macroSteps: [],
    analysisResults: [], history: [], future: [], staleDatasets: [], recalcMode: "manual",
  });
});

describe("runSimsBatch", () => {
  const run = () => runSimsBatch({
    store: useApp.getState, params: { op: "sims" }, items: [{ id: "a", name: "a.dat" }, { id: "b", name: "b.dat" }],
    previewedId: "a", signal: new AbortController().signal, onProgress: () => undefined,
  });

  it("creates each profile once, then reports a repeat as already added", async () => {
    const first = await run();
    expect(first?.map((r) => r.status)).toEqual(["created", "created"]);
    expect(outputs()).toHaveLength(2);
    const again = await run();
    expect(again?.map((r) => r.status)).toEqual(["failed", "failed"]);
    expect(again?.[0]).toMatchObject({ reason: expect.stringMatching(/already added/) });
    expect(outputs()).toHaveLength(2);
  });
});
