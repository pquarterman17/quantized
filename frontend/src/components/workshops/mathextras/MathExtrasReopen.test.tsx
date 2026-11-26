// Math extras: scattered-interpolation query points from another worksheet's
// columns, and "Open in Math extras" (restore the job, options and columns of a
// committed result; Replace in place; fail closed when the columns moved or the
// result predates its recorded settings).

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { planReopen, REOPEN_TOOLS } from "../../../lib/committedOutputReopen";
import type { DataStruct } from "../../../lib/types";
import { toolWindowOf } from "../../../lib/windowLayout/toolCatalog";
import { useAnalysisExtras } from "../../../store/analysisExtras";
import { useToolReopen } from "../../../store/toolReopen";
import { openCommittedResultInTool } from "../../../store/toolReopenOpen";
import { useApp } from "../../../store/useApp";
import MathExtrasPanel from "./MathExtrasPanel";
import { emptyForm } from "./mathExtrasForm";
import { formSettings, mathSeed } from "./mathExtrasSeed";

const api = vi.hoisted(() => ({
  polygonArea: vi.fn(), surfaceArea: vi.fn(), traceInterp: vi.fn(), bsplineResample: vi.fn(),
  scatterInterp: vi.fn(), correlateMaps: vi.fn(), solveRoot: vi.fn(), optimizeBox: vi.fn(),
}));
vi.mock("../../../lib/api/mathExtras", () => api);

const sheet = (labels = ["Y", "W"]): DataStruct => ({
  time: [0, 1, 1, 0], values: [[0, 5], [0, 6], [1, 7], [1, 8]], labels, units: ["mm", "V"],
  metadata: { x_column_name: "X", x_column_unit: "mm" },
});
const grid: DataStruct = {
  time: [0.5, 2, 9], values: [[0.5, 1], [2, 2], [9, 3]], labels: ["qa", "qb"], units: ["", ""], metadata: { x_column_name: "t" },
};
const OUT = (): DataStruct => ({ time: [0, 1], values: [[0], [1]], labels: ["Y"], units: ["mm"], metadata: { math_extras: { total_length: 3, outside: 0, n_points: 4 } } });

const pickMode = (value: string) => fireEvent.change(screen.getByLabelText("Math job"), { target: { value } });
const click = (name: RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const outputs = () => useApp.getState().datasets.filter((d) => !["s", "q"].includes(d.id));
const results = () => useApp.getState().analysisResults;

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  api.traceInterp.mockImplementation(async () => OUT());
  api.scatterInterp.mockImplementation(async () => OUT());
  useToolReopen.setState({ sessions: {} });
  useAnalysisExtras.setState({ open: [] });
  useApp.setState({
    datasets: [{ id: "s", name: "loop.dat", data: sheet() }, { id: "q", name: "grid.dat", data: grid }],
    activeId: "s", analysisResults: [], history: [], future: [], staleDatasets: [], status: "",
  });
});

describe("scattered interpolation: query points from a worksheet", () => {
  it("reads the points from another worksheet's columns and records both sources", async () => {
    render(<MathExtrasPanel />);
    pickMode("scatter");
    fireEvent.change(screen.getByLabelText("Query points from"), { target: { value: "sheet" } });
    fireEvent.change(screen.getByLabelText("Query worksheet"), { target: { value: "q" } });
    fireEvent.change(screen.getByLabelText("Query X column"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Query Y column"), { target: { value: "1" } });
    click(/Apply/);
    await waitFor(() => expect(outputs()).toHaveLength(1));
    const body = api.scatterInterp.mock.calls[0]![0];
    expect(body.queries).toEqual([[0.5, 1], [2, 2], [9, 3]]);
    expect(body.points).toEqual([[0, 0], [1, 0], [1, 1], [0, 1]]);
    const r = results()[0]!;
    expect(r.sources.map((s) => s.datasetId)).toEqual(["s", "q"]);
    expect((r.parameters as { settings: Record<string, unknown> }).settings["queryFrom"]).toMatchObject({ id: "q", picks: [0, 1], labels: ["qa", "qb"] });
  });

  it("typed points are still the default and need no worksheet", async () => {
    render(<MathExtrasPanel />);
    pickMode("scatter");
    expect(screen.getByLabelText("Query points from")).toHaveValue("typed");
    fireEvent.change(screen.getByLabelText("Query points"), { target: { value: "0.5 0.5" } });
    click(/Apply/);
    await waitFor(() => expect(outputs()).toHaveLength(1));
    expect(results()[0]!.sources.map((s) => s.datasetId)).toEqual(["s"]);
  });

  it("refuses the same column twice for the points", async () => {
    render(<MathExtrasPanel />);
    pickMode("scatter");
    fireEvent.change(screen.getByLabelText("Query points from"), { target: { value: "sheet" } });
    fireEvent.change(screen.getByLabelText("Query worksheet"), { target: { value: "q" } });
    fireEvent.change(screen.getByLabelText("Query X column"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Query Y column"), { target: { value: "0" } });
    click(/Apply/);
    expect(await screen.findByRole("alert")).toHaveTextContent(/different columns/);
    expect(api.scatterInterp).not.toHaveBeenCalled();
  });
});

describe("Open in Math extras", () => {
  const makeTrace = async () => {
    const view = render(<MathExtrasPanel />);
    pickMode("trace");
    fireEvent.change(screen.getByLabelText("Output sizing"), { target: { value: "spacing" } });
    fireEvent.change(screen.getByLabelText("Spacing"), { target: { value: "0.5" } });
    fireEvent.change(screen.getByLabelText("Interpolation"), { target: { value: "pchip" } });
    click(/Apply/);
    await waitFor(() => expect(outputs()).toHaveLength(1));
    view.unmount();
  };
  const reopen = (): boolean => { let ok = false; act(() => { ok = openCommittedResultInTool(results()[0]!.id); }); return ok; };

  it("is in the reopen registry and the window-layout catalog", () => {
    expect(REOPEN_TOOLS["math-extras"]).toBe("Math extras");
    expect(toolWindowOf("math-extras")).toBe("math-extras");
  });

  it("restores the job and options, and Replace swaps the output in place", async () => {
    await makeTrace();
    useApp.setState({ activeId: "q" });
    expect(reopen()).toBe(true);
    expect(useApp.getState().activeId).toBe("s"); // the recorded source, not the active sheet
    expect(useAnalysisExtras.getState().open).toContain("math-extras");
    render(<MathExtrasPanel />);
    expect(screen.getByLabelText("Math job")).toHaveValue("trace");
    expect(screen.getByLabelText("Output sizing")).toHaveValue("spacing");
    expect(screen.getByLabelText("Spacing")).toHaveValue("0.5");
    expect(screen.getByLabelText("Interpolation")).toHaveValue("pchip");
    expect(screen.getByRole("region", { name: "Editing a committed result" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Spacing"), { target: { value: "0.25" } });
    api.traceInterp.mockImplementation(async () => ({ ...OUT(), time: [0, 0.5, 1], values: [[0], [0.5], [1]] }));
    click(/Apply/);
    await waitFor(() => expect(api.traceInterp.mock.calls.at(-1)![0]).toMatchObject({ spacing: 0.25, kind: "pchip" }));
    await waitFor(() => expect(outputs()[0]!.data.time).toEqual([0, 0.5, 1]));
    expect(outputs()).toHaveLength(1); // replaced, not added
    expect(results()).toHaveLength(1);
  });

  it("opens without the settings, and says why, when a recorded column moved", async () => {
    await makeTrace();
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "s" ? { ...d, data: sheet(["Z", "W"]) } : d)) }));
    expect(reopen()).toBe(true);
    render(<MathExtrasPanel />);
    expect(screen.getByText(/moved or been renamed/)).toBeInTheDocument();
    expect(screen.getByLabelText("Math job")).toHaveValue("polygon-area");
  });

  it("a result saved before its settings were recorded does not reopen", async () => {
    await makeTrace();
    useApp.setState((s) => ({ analysisResults: s.analysisResults.map((r) => ({ ...r, producer: { ...r.producer, version: 1 } })) }));
    const plan = planReopen(results()[0]!, useApp.getState().datasets);
    expect(plan.ok).toBe(false);
    expect(reopen()).toBe(false);
  });

  it("scatter from a worksheet reopens with that worksheet and its columns", async () => {
    render(<MathExtrasPanel />);
    pickMode("scatter");
    fireEvent.change(screen.getByLabelText("Query points from"), { target: { value: "sheet" } });
    fireEvent.change(screen.getByLabelText("Query worksheet"), { target: { value: "q" } });
    fireEvent.change(screen.getByLabelText("Query X column"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Query Y column"), { target: { value: "0" } });
    click(/Apply/);
    await waitFor(() => expect(outputs()).toHaveLength(1));
    cleanup();
    expect(reopen()).toBe(true);
    render(<MathExtrasPanel />);
    expect(screen.getByLabelText("Math job")).toHaveValue("scatter");
    expect(screen.getByLabelText("Query points from")).toHaveValue("sheet");
    expect(screen.getByLabelText("Query worksheet")).toHaveValue("q");
    expect(screen.getByLabelText("Query X column")).toHaveValue("1");
    expect(screen.getByLabelText("Query Y column")).toHaveValue("0");
  });
});

describe("mathSeed", () => {
  const base = { mode: "trace", form: formSettings("trace", { ...emptyForm(), kind: "cubic" }), picks: [-1, 0], pickLabels: ["X", "Y"] };
  it("reads back what a commit records, with unrecorded fields at their defaults", () => {
    const seed = mathSeed(base);
    expect(seed?.mode).toBe("trace");
    expect(seed?.form).toMatchObject({ kind: "cubic", sizing: "n", n: "200", dims: "2" });
  });
  it("is null for an unknown job, a missing field, or a column record that does not pair up", () => {
    expect(mathSeed({ ...base, mode: "root" })).toBeNull();
    expect(mathSeed({ ...base, form: { sizing: "n" } })).toBeNull();
    expect(mathSeed({ ...base, pickLabels: ["X"] })).toBeNull();
    expect(mathSeed(null)).toBeNull();
    expect(mathSeed({ ...base, mode: "scatter", form: formSettings("scatter", { ...emptyForm(), queriesFrom: "sheet" }) })).toBeNull(); // sheet without its record
  });
});
