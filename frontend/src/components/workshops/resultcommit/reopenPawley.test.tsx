// "Open in Pawley refinement" (OPEN_ITEMS row 12, writers 8 and 9): the recorded
// settings AND the column they ran on come back exactly, for the single run and
// for a batch's model worksheets; a result saved before they were recorded, a
// deleted source, a changed column set and an incomplete record all fail closed
// (nothing seeded, Replace off, the reason shown).

import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalysisResultValue } from "../../../lib/analysisResult";
import { planReopen } from "../../../lib/committedOutputReopen";
import { pawleySeed } from "../../../lib/pawleyReopenSeed";
import type { PawleyResult } from "../../../lib/reductionTypes";
import type { DataStruct } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { usePendingOps } from "../../../store/pendingOps";
import { useToolReopen } from "../../../store/toolReopen";
import { openCommittedResultInTool } from "../../../store/toolReopenOpen";
import { useApp } from "../../../store/useApp";
import PawleySection from "../reductions/PawleySection";
import { usePawley } from "../reductions/usePawley";

const { pawleyMock } = vi.hoisted(() => ({ pawleyMock: vi.fn() }));
vi.mock("../../../lib/api/reductions", () => ({
  pawleyRefine: pawleyMock, fftThickness: vi.fn(), reflectivityFft: vi.fn(),
  xrdPhases: vi.fn(async () => ({ phases: [], default_wavelength: 1.5406 })),
}));

const scan = (labels: string[]): DataStruct => ({
  time: [20, 30, 40, 50], values: [[1, 9], [2, 8], [3, 7], [4, 6]], labels, units: ["", ""],
  metadata: { x_column_name: "2-Theta", x_column_unit: "deg" },
});
const reset = (labels = ["Intensity", "Other"]) => useApp.setState({
  datasets: [{ id: "src", name: "powder.xy", data: scan(labels) }], activeId: "src", selectedIds: ["src"], status: "",
  analysisResults: [], history: [], future: [], staleDatasets: [], staleFits: [], recalcMode: "manual", reductionsOpen: false,
  xKey: null, yKeys: [0], resolveDataset: async (id: string) => useApp.getState().datasets.find((d) => d.id === id),
});

beforeEach(() => {
  vi.clearAllMocks();
  // The backend echoes the starting cell it was sent.
  pawleyMock.mockImplementation(async (req: unknown): Promise<PawleyResult> => {
    const body = req as Record<string, number | string>;
    const n = (k: string): number => Number(body[k]);
    return {
      cell: [5.42, 5.42, 5.42, 90, 90, 90],
      cell_initial: [n("a"), body["tie"] === "none" ? n("b") : n("a"), body["tie"] === "abc" ? n("a") : n("c"), n("alpha"), n("beta"), n("gamma")],
      scale: null, peaks: [], background: [0, 0, 0, 0], model: [1, 2, 3, 4], residual: [0, 0, 0, 0],
      rwp: 0.05, rwp_initial: 0.2, rwp_background: 0.5, converged: true, tie: "none", hkl_max: 8, n_peaks: 1,
    };
  });
  useToolReopen.setState({ sessions: {} });
  useAnalysisSelection.setState({ toolId: null, selection: null });
  usePendingOps.setState({ ops: [] });
  reset();
});

const results = () => useApp.getState().analysisResults.filter((r) => r.producer.id === "pawley");
const session = () => useToolReopen.getState().sessions["pawley"]!;

const expected = {
  col: 1, tie: "none", symmetry: "I", refineCell: false,
  fields: { a: "4.1", b: "4.2", c: "4.3", alpha: "90", beta: "91", gamma: "90", wavelength: "1.789", fwhm: "0.3" },
};
const defaults = {
  col: 0, tie: "abc", symmetry: "P", refineCell: true,
  fields: { a: "5.43", b: "5.43", c: "5.43", alpha: "90", beta: "90", gamma: "90", wavelength: "1.5406", fwhm: "0.12" },
};

async function commitOnce(): Promise<void> {
  const hook = renderHook(() => usePawley());
  act(() => {
    const s = hook.result.current;
    s.setCol(1); s.setTie("none"); s.setSymmetry("I"); s.setRefineCell(false);
    s.setField("a", "4.1"); s.setField("b", "4.2"); s.setField("c", "4.3"); s.setField("beta", "91");
    s.setField("wavelength", "1.789"); s.setField("fwhm", "0.3");
  });
  await act(async () => { await hook.result.current.compute(); });
  act(() => hook.result.current.toLibrary());
  hook.unmount();
}
function read() {
  const { result } = renderHook(() => usePawley());
  const { col, tie, symmetry, refineCell, fields } = result.current;
  return { col, tie, symmetry, refineCell, fields };
}
const dropExtra = (): void => useApp.setState((s) => ({
  analysisResults: s.analysisResults.map((r) => {
    const { extra: _gone, ...reopen } = r.parameters!["reopen"] as Record<string, unknown>;
    return { ...r, parameters: { ...r.parameters, reopen: reopen as AnalysisResultValue } };
  }),
}));

describe("Open in Pawley refinement", () => {
  it("restores the exact recorded settings and column, with Replace preselected", async () => {
    expect(read()).toEqual(defaults); // a plain open starts from the defaults
    await commitOnce();
    expect(results()).toHaveLength(1);
    act(() => { expect(openCommittedResultInTool(results()[0]!.id)).toBe(true); });
    expect(useApp.getState().reductionsOpen).toBe(true);
    expect(useApp.getState().reductionsMethod).toBe("pawley");
    expect(read()).toEqual(expected);
    expect(session().mode).toBe("replace");
  });

  it("an old result without the recorded settings refuses with the existing reason, and nothing opens", async () => {
    await commitOnce();
    const old = { ...results()[0]!, producer: { ...results()[0]!.producer, version: 1 } };
    const plan = planReopen(old, useApp.getState().datasets);
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.reason).toMatch(/saved before its settings were recorded, so it cannot be reopened/);
    useApp.setState({ analysisResults: [old] });
    act(() => { expect(openCommittedResultInTool(old.id)).toBe(false); });
    expect(useApp.getState().reductionsOpen).toBe(false);
    expect(useToolReopen.getState().sessions["pawley"]).toBeUndefined();
  });

  it("the recorded picks stay outside identity: the key ignores them and an identical re-run matches a v1 result", async () => {
    await commitOnce();
    const v2 = results()[0]!;
    const { extra: _gone, ...reopen } = v2.parameters!["reopen"] as Record<string, unknown>;
    const v1 = { ...v2, producer: { ...v2.producer, version: 1 }, parameters: { ...v2.parameters, reopen: reopen as AnalysisResultValue } };
    useApp.setState({ analysisResults: [v1], activeId: "src" }); // the add made its output the active sheet
    const keyBefore = v2.parameters!["commitKey"];
    expect(String(keyBefore)).not.toContain("picks");
    await commitOnce();
    expect(results()).toHaveLength(1);
    expect(results()[0]!.parameters!["commitKey"]).toBe(keyBefore);
  });

  it("a v2 result whose column picks are missing opens WITHOUT settings and cannot replace", async () => {
    await commitOnce();
    dropExtra();
    act(() => { expect(openCommittedResultInTool(results()[0]!.id)).toBe(true); });
    expect(session().seed).toBeNull();
    expect(session().notice).toContain("were not recorded");
    expect(session().replaceBlocked).toContain("were not recorded");
    expect(session().mode).toBe("new");
    expect(read()).toEqual(defaults);
  });

  it("an incomplete settings record is never half-seeded: no settings, the reason, Replace off", async () => {
    await commitOnce();
    useApp.setState((s) => ({
      analysisResults: s.analysisResults.map((r) => {
        const { fwhm: _gone, ...settings } = r.parameters!["settings"] as Record<string, AnalysisResultValue>;
        return { ...r, parameters: { ...r.parameters, settings } };
      }),
    }));
    act(() => { expect(openCommittedResultInTool(results()[0]!.id)).toBe(true); });
    expect(session().seed).toBeNull();
    expect(session().notice).toContain("recorded settings are incomplete");
    expect(session().replaceBlocked).toContain("incomplete");
    expect(session().mode).toBe("new");
    expect(read()).toEqual(defaults);
  });

  it("a deleted source opens WITHOUT settings and cannot replace", async () => {
    await commitOnce();
    act(() => useApp.setState((s) => ({ datasets: s.datasets.filter((d) => d.id !== "src") })));
    act(() => { expect(openCommittedResultInTool(results()[0]!.id)).toBe(true); });
    expect(session().seed).toBeNull();
    expect(session().sourceId).toBeNull();
    expect(session().notice).toMatch(/no longer exists/);
    expect(session().replaceBlocked).toBeTruthy();
    expect(session().mode).toBe("new");
    expect(read()).toEqual(defaults);
  });

  it("a moved pick (changed column set) is NOT guessed: no settings, the reason shown, Replace off", async () => {
    await commitOnce();
    act(() => useApp.setState((st) => ({
      datasets: st.datasets.map((d) => ({ ...d, data: { ...d.data, labels: ["Intensity", "Temperature"] } })),
    })));
    act(() => { expect(openCommittedResultInTool(results()[0]!.id)).toBe(true); });
    expect(session().seed).toBeNull();
    expect(session().extra).toBeNull();
    expect(session().notice).toContain("“Other” is no longer at its place in “powder.xy”");
    expect(session().replaceBlocked).toContain("“Other”");
    expect(session().mode).toBe("new");
    expect(read()).toEqual(defaults);
  });

  it("the strict reader returns null unless every field is present and well typed", () => {
    const full = { col: 0, tie: "abc", symmetry: "P", refineCell: true, wavelength: 1.5, fwhm: 0.1, cellInitial: [5, 5, 5, 90, 90, 90] };
    expect(pawleySeed(full)).not.toBeNull();
    for (const key of Object.keys(full)) {
      const { [key]: _gone, ...rest } = full as Record<string, AnalysisResultValue>;
      expect(pawleySeed(rest), `without ${key}`).toBeNull();
    }
    expect(pawleySeed({ ...full, tie: "xyz" })).toBeNull();
    expect(pawleySeed({ ...full, cellInitial: [5, 5, 5, 90, 90] })).toBeNull();
    expect(pawleySeed({ ...full, cellInitial: [5, 5, 5, 90, 90, null] })).toBeNull();
    expect(pawleySeed({ ...full, refineCell: "yes" })).toBeNull();
  });
});

describe("Open in Pawley refinement from a batch's model worksheet", () => {
  it("a model worksheet made by the batch records the column and reopens with the batch's settings", async () => {
    render(<PawleySection />);
    const axes = screen.getAllByRole("combobox").find((el) => Array.from((el as HTMLSelectElement).options).some((o) => o.value === "none"))!;
    fireEvent.change(axes, { target: { value: "none" } });
    fireEvent.click(screen.getByRole("button", { name: /Batch over selected worksheets/ }));
    fireEvent.click(screen.getByRole("button", { name: "Run Pawley batch" }));
    await waitFor(() => expect(useApp.getState().status).toMatch(/batch finished/));
    fireEvent.click(await screen.findByRole("button", { name: /Create model worksheets/ }));
    expect(results()).toHaveLength(1);
    expect(results()[0]!.producer.version).toBe(2);
    act(() => { expect(openCommittedResultInTool(results()[0]!.id)).toBe(true); });
    expect(session().seed).not.toBeNull();
    expect(session().mode).toBe("replace");
    expect(read()).toMatchObject({ col: 0, tie: "none", symmetry: "P", refineCell: true });
  });
});
