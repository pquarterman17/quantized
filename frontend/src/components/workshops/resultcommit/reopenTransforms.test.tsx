// "Open in Resample" and "Open in Average curves" (OPEN_ITEMS row 12,
// reopen-seven lane): both transforms record their COMPLETE parameters
// (`settings.params`), so the dialog reopens refilled from them and a Replace
// commits into the old output (same output and result id, one undo step).
// FAIL CLOSED: a "match another dataset's x" resample (two sources), an
// incomplete record, an averaged column that is no longer shared and a deleted
// source open without settings and with Replace off (or refuse, with the reason).

import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ResampleRequest, ResampleResult } from "../../../lib/api/resample";
import type { AnalysisResult } from "../../../lib/analysisResult";
import { averageSeed, resampleSeed } from "../../../lib/transformReopenSeed";
import type { DataStruct } from "../../../lib/types";
import { commitTransformOutput } from "../../../store/commitTransformOutput";
import { useResampleDialog } from "../../../store/resampleDialog";
import { useToolReopen } from "../../../store/toolReopen";
import { openCommittedResultInTool } from "../../../store/toolReopenOpen";
import { useApp } from "../../../store/useApp";
import DatasetMathPanel from "../datasetmath/DatasetMathPanel";
import ResamplePanel from "../resample/ResamplePanel";

vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));
vi.mock("../../../lib/api/resample", () => ({ resampleDataset: vi.fn() }));
vi.mock("../../../lib/api/curveAverage", () => ({ averageCurves: vi.fn() }));
const { resampleDataset } = await import("../../../lib/api/resample");
const { averageCurves } = await import("../../../lib/api/curveAverage");

const scan = (k: number): DataStruct => ({ time: [0, 1, 2, 3], values: [[k], [k + 1], [k + 2], [k + 3]], labels: ["I"], units: ["cps"], metadata: { x_column_unit: "K" } });
const fakeResample = (body: ResampleRequest): Promise<ResampleResult> => Promise.resolve({
  dataset: { time: [0, 1, 2, 3], values: body.dataset.values, labels: body.dataset.labels, units: body.dataset.units, metadata: { resampled: true } },
  warnings: [], source_range: [0, 3], rows_in: 4, rows_out: 4,
});
const averaged: DataStruct = {
  time: [0, 1, 2, 3], values: [[2, 1, 0.5, 2], [3, 1, 0.5, 2], [4, 1, 0.5, 2], [5, 1, 0.5, 2]],
  labels: ["I mean", "I SD", "I SEM", "N"], units: ["cps", "cps", "cps", ""], metadata: {},
};

const results = () => useApp.getState().analysisResults;
const outputs = () => useApp.getState().datasets.filter((d) => !["d1", "d2", "d3"].includes(d.id));
const reopen = (): boolean => { let ok = false; act(() => { ok = openCommittedResultInTool(results()[0]!.id); }); return ok; };
const session = (tool: string) => useToolReopen.getState().sessions[tool]!;
const editSettings = (fn: (params: Record<string, unknown>) => void) =>
  useApp.setState((s) => ({
    analysisResults: s.analysisResults.map((r): AnalysisResult => {
      const settings = JSON.parse(JSON.stringify(r.parameters!["settings"])) as { params: Record<string, unknown> };
      fn(settings.params);
      return { ...r, parameters: { ...r.parameters, settings } as AnalysisResult["parameters"] };
    }),
  }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resampleDataset).mockImplementation(fakeResample);
  vi.mocked(averageCurves).mockResolvedValue({ dataset: averaged, warnings: [], overlap: [0, 3], channels: ["I", "I"] });
  useToolReopen.setState({ sessions: {} });
  useResampleDialog.setState({ seed: null });
  useApp.setState({
    datasets: [{ id: "d1", name: "a.xy", data: scan(1) }, { id: "d2", name: "b.xy", data: scan(3) }, { id: "d3", name: "c.xy", data: scan(9) }],
    folders: [], activeId: "d1", selectedIds: [], analysisResults: [], history: [], future: [], staleDatasets: [], recalcMode: "manual",
    macroRecording: false, macroSteps: [], datasetMathOpen: false, datasetMathMode: "combine", status: "",
  });
});

describe("Resample: reopen and replace", () => {
  const params = { op: "resample" as const, mode: "range" as const, start: 0.5, stop: 2.5, step: 0.25, method: "pchip" as const, outOfRange: "clip" as const, sortUnsorted: true };
  beforeEach(async () => {
    await commitTransformOutput(useApp.getState, params, "d1");
    expect(outputs()).toHaveLength(1);
    useApp.setState({ activeId: "d3" });
  });

  it("reopens the dialog on the recorded source with the exact recorded grid, method and options", () => {
    expect(reopen()).toBe(true);
    expect(useResampleDialog.getState().seed).toEqual(["d1"]);
    expect(useApp.getState().activeId).toBe("d1");
    expect(session("resample").mode).toBe("replace");
    render(<ResamplePanel />);
    expect(screen.getByRole("combobox", { name: "Target grid" })).toHaveValue("range");
    expect(screen.getByRole("textbox", { name: "Start" })).toHaveValue("0.5");
    expect(screen.getByRole("textbox", { name: "Stop" })).toHaveValue("2.5");
    expect(screen.getByRole("textbox", { name: "Step" })).toHaveValue("0.25");
    expect(screen.getByRole("combobox", { name: "Interpolation" })).toHaveValue("pchip");
    expect(screen.getByRole("combobox", { name: "Target points outside the data" })).toHaveValue("clip");
    expect(screen.getByRole("checkbox", { name: /Sort x that reverses direction/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "a.xy" })).toBeChecked();
  });

  it("Replace commits into the old output: one result, the same output id", async () => {
    const outputId = outputs()[0]!.id;
    const resultId = results()[0]!.id;
    expect(reopen()).toBe(true);
    // The new computation differs, so a commit that did nothing could not pass for a replace.
    vi.mocked(resampleDataset).mockImplementation(async (body) => {
      const base = await fakeResample(body);
      return { ...base, dataset: { ...base.dataset, values: base.dataset.values.map((row) => row.map((v) => v + 100)) } };
    });
    render(<ResamplePanel />);
    const create = await screen.findByRole("button", { name: "Create resampled dataset" });
    await waitFor(() => expect(create).toBeEnabled());
    act(() => create.click());
    await waitFor(() => expect(useApp.getState().datasets.find((d) => d.id === outputId)?.data.values[0]?.[0]).toBe(101));
    expect(outputs().map((d) => d.id)).toEqual([outputId]);
    expect(results().map((r) => r.id)).toEqual([resultId]);
  });

  it("a plain open of the dialog starts at the defaults (the seed is the reopen's only)", () => {
    useToolReopen.setState({ sessions: {} });
    useResampleDialog.setState({ seed: ["d1"] });
    render(<ResamplePanel />);
    expect(screen.getByRole("combobox", { name: "Target grid" })).toHaveValue("n_points");
    expect(screen.getByRole("combobox", { name: "Interpolation" })).toHaveValue("linear");
  });

  it("an incomplete record is NOT guessed: the dialog opens at its defaults and Replace is off", () => {
    editSettings((p) => { delete p["step"]; });
    expect(reopen()).toBe(true);
    expect(session("resample").seed).toBeNull();
    expect(session("resample").replaceBlocked).toContain("incomplete");
    expect(session("resample").mode).toBe("new");
    render(<ResamplePanel />);
    expect(screen.getByRole("combobox", { name: "Target grid" })).toHaveValue("n_points");
  });

  it("a deleted source opens without settings and with Replace off", () => {
    useApp.setState((s) => ({ datasets: s.datasets.filter((d) => d.id !== "d1") }));
    expect(reopen()).toBe(true);
    expect(session("resample").seed).toBeNull();
    expect(session("resample").mode).toBe("new");
  });

  it("a 'match another dataset's x' resample (two sources) refuses with the reason", async () => {
    useApp.setState({ datasets: useApp.getState().datasets.filter((d) => d.id !== outputs()[0]!.id), analysisResults: [] });
    await commitTransformOutput(useApp.getState, { op: "resample", mode: "match", with: { id: "d2", name: "b.xy" }, method: "linear", outOfRange: "nan", sortUnsorted: false }, "d1");
    expect(results()[0]!.sources).toHaveLength(2);
    expect(reopen()).toBe(false);
    expect(useApp.getState().status).toContain("one source worksheet only");
    expect(useResampleDialog.getState().seed).toBeNull();
  });

  it("the strict reader needs every field of the recorded mode", () => {
    expect(resampleSeed({ params })).toMatchObject({ mode: "range", start: 0.5, step: 0.25 });
    expect(resampleSeed({ params: { ...params, step: 0 } })).toBeNull();
    expect(resampleSeed({ params: { ...params, method: "cubic" } })).toBeNull();
    expect(resampleSeed({ params: { ...params, sortUnsorted: undefined } as never })).toBeNull();
    expect(resampleSeed({ params: { op: "resample", mode: "n_points", nPoints: 1.5, method: "linear", outOfRange: "nan", sortUnsorted: false } })).toBeNull();
    expect(resampleSeed({ params: { ...params, mode: "match" } })).toBeNull();
    expect(resampleSeed(null)).toBeNull();
  });
});

describe("Average curves: reopen and replace", () => {
  const params = { op: "average" as const, channel: "I", grid: "step" as const, step: 0.5, sortUnsorted: true, with: [{ id: "d2", name: "b.xy" }] };
  beforeEach(async () => {
    await commitTransformOutput(useApp.getState, params, "d1");
    expect(outputs()).toHaveLength(1);
    useApp.setState({ activeId: "d3", selectedIds: ["d3"] });
  });

  it("reopens the Average tab on the recorded worksheets with the recorded column, grid, step and options", () => {
    expect(reopen()).toBe(true);
    expect(useApp.getState().datasetMathOpen).toBe(true);
    expect(useApp.getState().datasetMathMode).toBe("average");
    expect(useApp.getState().activeId).toBe("d1");
    // The Average output carries the tool's own column designations (SEM as the error), which the shared
    // replace rule cannot tell from a user's edits, so a reopened Average commits as a new output only.
    expect(session("average-curves").mode).toBe("new");
    expect(session("average-curves").replaceBlocked).toContain("worksheet edits (columnDesignations)");
    render(<DatasetMathPanel />);
    expect(screen.getByRole("checkbox", { name: "a.xy" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "b.xy" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "c.xy" })).not.toBeChecked();
    expect(screen.getByRole("combobox", { name: "Y column to average" })).toHaveValue("I");
    expect(screen.getByRole("radio", { name: "Step over overlap" })).toBeChecked();
    expect(screen.getByRole("textbox", { name: "Grid step" })).toHaveValue("0.5");
    expect(screen.getByRole("checkbox", { name: "Sort x that reverses direction" })).toBeChecked();
  });

  it("Average from a reopen adds a NEW output and leaves the old result untouched", async () => {
    const old = { output: outputs()[0]!.id, result: results()[0]!.id };
    expect(reopen()).toBe(true);
    render(<DatasetMathPanel />);
    vi.mocked(averageCurves).mockResolvedValue({ dataset: { ...averaged, values: averaged.values.map((r) => r.map((v) => v + 1)) }, warnings: [], overlap: [0, 3], channels: ["I", "I"] });
    act(() => screen.getByRole("button", { name: /Average → new dataset/ }).click());
    await waitFor(() => expect(outputs()).toHaveLength(2));
    expect(results()).toHaveLength(2);
    expect(outputs().map((d) => d.id)).toContain(old.output);
    expect(results().map((r) => r.id)).toContain(old.result);
  });

  it("a column that is no longer shared is NOT dropped to 'first column of each': no settings, Replace off", () => {
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "d2" ? { ...d, data: { ...d.data, labels: ["J"] } } : d)) }));
    expect(reopen()).toBe(true);
    expect(session("average-curves").seed).toBeNull();
    expect(session("average-curves").replaceBlocked).toContain("“I” is no longer in “b.xy”");
    expect(session("average-curves").mode).toBe("new");
  });

  it("an incomplete record is NOT guessed", () => {
    editSettings((p) => { p["with"] = []; });
    expect(reopen()).toBe(true);
    expect(session("average-curves").seed).toBeNull();
    expect(session("average-curves").replaceBlocked).toContain("incomplete");
  });

  it("a deleted source opens without settings and with Replace off", () => {
    useApp.setState((s) => ({ datasets: s.datasets.filter((d) => d.id !== "d2") }));
    expect(reopen()).toBe(true);
    expect(session("average-curves").seed).toBeNull();
    expect(session("average-curves").mode).toBe("new");
    expect(session("average-curves").notice).toContain("no longer exist");
  });

  it("the strict reader needs the worksheets to match the recorded list", () => {
    expect(averageSeed({ params }, ["d1", "d2"])).toMatchObject({ channel: "I", grid: "step", step: 0.5, picked: ["d1", "d2"] });
    expect(averageSeed({ params }, ["d1", "d3"])).toBeNull();
    expect(averageSeed({ params: { ...params, step: -1 } }, ["d1", "d2"])).toBeNull();
    expect(averageSeed({ params: { ...params, grid: "union" } }, ["d1", "d2"])).toBeNull();
    expect(averageSeed({ params }, ["d1"])).toBeNull();
  });
});
