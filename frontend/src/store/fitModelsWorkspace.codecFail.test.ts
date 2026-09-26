// PR #432 review: a project's readable fit models live only in
// `projectFitModels` until the lazy codec merges them — and a save reads just
// the library plus the carry. If the codec chunk will not load, the merge
// cannot run, so the models must be CARRIED, or the next save drops them from
// the file. Its own file because it mocks the codec loader for every test.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildCustomFitModel } from "../lib/fitmodels";
import { parseWorkspace, serializeWorkspace } from "../lib/workspace";
import { useApp } from "./useApp";

vi.mock("../lib/workspaceCodecLazy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/workspaceCodecLazy")>()),
  // The real one toasts the failure and resolves null.
  workspaceCodecOrReport: vi.fn(() => Promise.resolve(null)),
}));

const model = buildCustomFitModel({ name: "Only in the file", equation: "y = a", params: ["a"], guesses: [1], lower: [null], upper: [null] });

beforeEach(() => {
  localStorage.clear();
  useApp.getState().clearAll();
});

describe("the fit-model merge when the codec chunk will not load", () => {
  it("carries the project's models, so a save still writes them", async () => {
    const doc = JSON.parse(serializeWorkspace({ datasets: [{ id: "d1", name: "d1", data: { time: [0], values: [[1]], labels: ["y"], units: [""], metadata: {} } }] }));
    useApp.getState().loadWorkspace(parseWorkspace(JSON.stringify({ ...doc, customFitModels: [model] })));
    await vi.waitFor(() => expect(useApp.getState().fitModelCarry).toEqual([model]));
    const saved = JSON.parse(serializeWorkspace(useApp.getState())) as { customFitModels?: unknown[] };
    expect(saved.customFitModels).toEqual([model]);
  });
});
