// "Open in Spin asymmetry" (lane RO2): a two-source output reopens with BOTH
// recorded channels and their recorded columns, fails closed when a source is
// missing or changed, and a re-run REPLACES the old output in one undo step
// (through the layout verdict), or adds a new one on request.

import { act, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { useToolReopen } from "../../../store/toolReopen";
import { openCommittedResultInTool } from "../../../store/toolReopenOpen";
import { useApp } from "../../../store/useApp";
import { useSpinAsymmetry } from "../reflectivity/useSpinAsymmetry";
import SpinAsymmetryView from "../reflectivity/SpinAsymmetryView";

const { saMock } = vi.hoisted(() => ({ saMock: vi.fn() }));
vi.mock("../../../lib/api/reductions", () => ({ spinAsymmetry: saMock }));

const chan = (r: number[], extra = false): DataStruct => ({
  time: [0.01, 0.02, 0.03], values: r.map((v) => (extra ? [v, v / 10] : [v])),
  labels: extra ? ["R", "dR"] : ["R"], units: extra ? ["", ""] : [""], metadata: {},
});

const outputs = () => useApp.getState().datasets.filter((d) => d.id !== "pp" && d.id !== "mm");
const resultId = () => useApp.getState().analysisResults[0]!.id;

beforeEach(() => {
  vi.clearAllMocks();
  saMock.mockResolvedValue({ asymmetry: [0.1, 0.2, 0.3], d_asymmetry: [0, 0, 0], n_valid: 3 });
  useToolReopen.setState({ sessions: {} });
  useApp.setState({
    datasets: [{ id: "pp", name: "rpp", data: chan([3, 2, 1], true) }, { id: "mm", name: "rmm", data: chan([2, 1, 0.5], true) }],
    activeId: "pp", status: "", analysisResults: [], history: [], future: [], staleDatasets: [], staleFits: [], recalcMode: "manual",
    reflectivityOpen: false,
  });
});

/** Commit once with R-- on its dR column, then close the tool. */
async function commitOnce(): Promise<void> {
  const first = renderHook(() => useSpinAsymmetry());
  act(() => first.result.current.setMm({ errCol: 1 }));
  await act(async () => { await first.result.current.compute(); });
  expect(outputs()).toHaveLength(1);
  first.unmount();
}

describe("Spin asymmetry: reopen, adjust, replace", () => {
  it("reopens with BOTH recorded sources and columns, Replace preselected", async () => {
    await commitOnce();
    act(() => { expect(openCommittedResultInTool(resultId())).toBe(true); });
    expect(useApp.getState().reflectivityOpen).toBe(true);
    expect(useApp.getState().activeId).toBe("pp");
    const { result } = renderHook(() => useSpinAsymmetry());
    expect(result.current.pp).toEqual({ id: "pp", col: 0, errCol: 1 });
    expect(result.current.mm).toEqual({ id: "mm", col: 0, errCol: 1 });
    const session = useToolReopen.getState().sessions["spin-asymmetry"]!;
    expect(session.sourceIds).toEqual(["pp", "mm"]);
    expect(session.mode).toBe("replace");
  });

  it("a re-run replaces the old output in ONE undo step; Undo restores it and its result", async () => {
    await commitOnce();
    const [old] = outputs();
    const oldResult = useApp.getState().analysisResults[0];
    act(() => { openCommittedResultInTool(resultId()); });
    const { result } = renderHook(() => useSpinAsymmetry());
    saMock.mockResolvedValue({ asymmetry: [0.5, 0.6, 0.7], d_asymmetry: [0, 0, 0], n_valid: 3 });
    await act(async () => { await result.current.compute(); });
    expect(result.current.done).toContain("Replaced");
    expect(outputs()).toHaveLength(1);
    expect(outputs()[0]!.id).toBe(old!.id);
    expect(useApp.getState().analysisResults).toHaveLength(1);
    expect(useApp.getState().analysisResults[0]!.id).toBe(oldResult!.id);
    expect(useApp.getState().history).toHaveLength(2);
    act(() => useApp.getState().undo());
    expect(outputs()[0]!.data).toEqual(old!.data);
    expect(useApp.getState().analysisResults).toEqual([oldResult]);
  });

  it("Add as new keeps the old output and adds a second result", async () => {
    await commitOnce();
    act(() => { openCommittedResultInTool(resultId()); });
    act(() => useToolReopen.getState().setMode("spin-asymmetry", "new"));
    const { result } = renderHook(() => useSpinAsymmetry());
    saMock.mockResolvedValue({ asymmetry: [0.5, 0.6, 0.7], d_asymmetry: [0, 0, 0], n_valid: 3 });
    await act(async () => { await result.current.compute(); });
    expect(outputs()).toHaveLength(2);
    expect(useApp.getState().analysisResults).toHaveLength(2);
  });

  it("a missing source opens WITHOUT the settings, with a notice, and cannot replace", async () => {
    await commitOnce();
    act(() => useApp.setState((s) => ({ datasets: s.datasets.filter((d) => d.id !== "mm") })));
    act(() => { expect(openCommittedResultInTool(resultId())).toBe(true); });
    const session = useToolReopen.getState().sessions["spin-asymmetry"]!;
    expect(session.seed).toBeNull();
    expect(session.sourceId).toBeNull();
    expect(session.notice).toMatch(/1 of the 2 recorded source worksheets/);
    expect(session.mode).toBe("new");
  });

  it("a changed R-- source keeps the settings but says so, naming it", async () => {
    await commitOnce();
    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "mm" ? { ...d, data: chan([9, 9, 9], true) } : d)) })));
    act(() => { openCommittedResultInTool(resultId()); });
    const session = useToolReopen.getState().sessions["spin-asymmetry"]!;
    expect(session.seed).not.toBeNull();
    expect(session.notice).toContain("“rmm” changed after this result was computed");
    expect(session.notice).not.toContain("“rpp”");
  });

  it("the banner names the result and the notice, inside the view", async () => {
    await commitOnce();
    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "mm" ? { ...d, data: chan([9, 9, 9], true) } : d)) })));
    act(() => { openCommittedResultInTool(resultId()); });
    render(<SpinAsymmetryView />);
    expect(screen.getByText(/Opened from the result/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("“rmm” changed");
  });
});
