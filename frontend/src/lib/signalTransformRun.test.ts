import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "./types";
import { useApp } from "../store/useApp";
import { parseWorkspace, serializeWorkspace } from "./workspace";

const { applyMock } = vi.hoisted(() => ({ applyMock: vi.fn() }));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  applyCorrections: applyMock,
}));

const { runTransform } = await import("./transformRun");

const source: Dataset = {
  id: "source",
  name: "scan",
  workbookId: "book",
  folderId: "folder",
  data: {
    time: [0, 1, 2],
    values: [[1], [2], [3]],
    labels: ["Y"],
    units: ["V"],
    metadata: {},
  },
};

const params = {
  op: "signal" as const,
  recipe: {
    kind: "signal-correction" as const,
    version: 1 as const,
      xUnit: "",
    operation: "Detrend",
    channels: [{ index: 0, label: "Y", unit: "V" }],
    params: { signalChannels: [0], detrendOrder: 1 },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  applyMock.mockResolvedValue({ ...source.data, values: [[-1], [0], [1]] });
  useApp.setState({
    datasets: [source],
    activeId: source.id,
    selectedIds: [source.id],
    macroRecording: true,
    macroSteps: [],
    pipelineRunning: false,
    analysisResults: [],
    openAnalysisResultId: null,
    history: [],
    future: [],
  });
});

describe("Signal Processing transform commit", () => {
  it("creates a linked worksheet in the source workbook and records a replayable transform", async () => {
    const result = await runTransform(useApp.getState, params, source.id);
    const output = useApp.getState().datasets.find((dataset) => dataset.id === result?.id)!;
    expect(output).toMatchObject({
      name: "scan (Detrend)",
      workbookId: "book",
      folderId: "folder",
      raw: source.data,
      corrections: { signalChannels: [0], detrendOrder: 1 },
      analysisRecipe: params.recipe,
      derivedFrom: { datasetId: "source", pipeline: "Detrend" },
    });
    expect(output.data.metadata.worksheet_transform).toBe("signal");
    expect(useApp.getState().macroSteps[0]).toMatchObject({
      kind: "transform",
      params: { ...params, input: { id: "source", name: "scan" }, inputIsTarget: true },
    });

    const reopened = parseWorkspace(serializeWorkspace({
      datasets: useApp.getState().datasets,
      macroSteps: useApp.getState().macroSteps,
    }));
    expect(reopened.datasets.find((dataset) => dataset.id === output.id)).toMatchObject({
      raw: source.data,
      corrections: params.recipe.params,
      analysisRecipe: params.recipe,
      derivedFrom: { datasetId: "source", pipeline: "Detrend" },
    });
    expect(reopened.macroSteps[0]).toMatchObject({ kind: "transform", params: { op: "signal" } });
  });

  it("is removed by the existing session undo history", async () => {
    const result = await runTransform(useApp.getState, params, source.id);
    expect(useApp.getState().datasets.some((dataset) => dataset.id === result?.id)).toBe(true);

    useApp.getState().undo();

    expect(useApp.getState().datasets).toEqual([source]);
  });

  it("registers a durable result for a replayed signal step without opening it, and undo removes both", async () => {
    // PR #554 review: Pipeline/macro replay goes through replayTransform ->
    // runTransform, never the workbench command, so the result must be
    // registered there or replayed outputs have none.
    const { replayTransform } = await import("./transformReplay");
    const result = await replayTransform(useApp.getState, { ...params, inputIsTarget: true }, source.id);
    expect(useApp.getState().analysisResults).toEqual([expect.objectContaining({
      id: `analysis-${result.id}`,
      sources: [{ datasetId: "source", role: "input" }],
      outputs: [{ datasetId: result.id, role: "linked-worksheet" }],
    })]);
    expect(useApp.getState().openAnalysisResultId).toBeNull();

    useApp.getState().undo();
    expect(useApp.getState().datasets).toEqual([source]);
    expect(useApp.getState().analysisResults).toEqual([]);
  });

  it("fails closed without publishing an output when the source changes during compute", async () => {
    let settle!: (value: Dataset["data"]) => void;
    let announceStart!: () => void;
    const started = new Promise<void>((resolve) => { announceStart = resolve; });
    applyMock.mockImplementation(() => {
      announceStart();
      return new Promise((resolve) => { settle = resolve; });
    });
    const running = runTransform(useApp.getState, params, source.id);
    await started;
    useApp.setState({ datasets: [{ ...source, data: { ...source.data, values: [[9], [9], [9]] } }] });
    settle(source.data);
    await expect(running).rejects.toThrow(/source worksheet changed/);
    expect(useApp.getState().datasets).toHaveLength(1);
    expect(useApp.getState().macroSteps).toEqual([]);
  });

  it.each([
    ["assigns", [{ channel: 0, target: 0, axis: "y" as const, side: "both" as const }]],
    ["removes", undefined],
  ])("fails closed when the user %s an error role during compute", async (_label, nextRoles) => {
    const initial = _label === "removes"
      ? [{ channel: 0, target: 0, axis: "y" as const, side: "both" as const }]
      : undefined;
    useApp.setState({ datasets: [{ ...source, ...(initial ? { errorRoles: initial } : {}) }] });
    let settle!: (value: Dataset["data"]) => void;
    let announceStart!: () => void;
    const started = new Promise<void>((resolve) => { announceStart = resolve; });
    applyMock.mockImplementation(() => {
      announceStart();
      return new Promise((resolve) => { settle = resolve; });
    });
    const running = runTransform(useApp.getState, params, source.id);
    await started;
    useApp.setState({ datasets: [{ ...useApp.getState().datasets[0], errorRoles: nextRoles }] });
    settle(source.data);
    await expect(running).rejects.toThrow(/source worksheet changed/);
    expect(useApp.getState().datasets).toHaveLength(1);
  });

  it("rechecks error roles after interactive review before publishing", async () => {
    let finishReview!: (accepted: boolean) => void;
    let announceReview!: () => void;
    const reviewing = new Promise<void>((resolve) => { announceReview = resolve; });
    const running = runTransform(useApp.getState, params, source.id, () => {
      announceReview();
      return new Promise((resolve) => { finishReview = resolve; });
    });
    await reviewing;
    useApp.setState({
      datasets: [{
        ...source,
        errorRoles: [{ channel: 0, target: 0, axis: "y", side: "both" }],
      }],
    });
    finishReview(true);

    await expect(running).rejects.toThrow(/source worksheet changed/);
    expect(useApp.getState().datasets).toHaveLength(1);
  });

  it("passes cancellation to the backend and publishes no partial output", async () => {
    let announceStart!: () => void;
    const started = new Promise<void>((resolve) => { announceStart = resolve; });
    applyMock.mockImplementation((_request, signal: AbortSignal) => {
      announceStart();
      return new Promise((_resolve, reject) => signal.addEventListener(
        "abort",
        () => reject(new DOMException("cancelled", "AbortError")),
        { once: true },
      ));
    });
    const controller = new AbortController();
    const running = runTransform(useApp.getState, params, source.id, undefined, controller.signal);
    await started;

    controller.abort();

    await expect(running).rejects.toMatchObject({ name: "AbortError" });
    expect(useApp.getState().datasets).toEqual([source]);
    expect(useApp.getState().macroSteps).toEqual([]);
  });
});
