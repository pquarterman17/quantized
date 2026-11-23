// Spin asymmetry on the shared commit contract (lane RL4). Fail-before: a repeat
// run wrote a second identical SA worksheet, the output carried no result
// envelope, and a change to either channel's worksheet never marked it stale.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useSpinAsymmetry } from "./useSpinAsymmetry";

const { saMock } = vi.hoisted(() => ({ saMock: vi.fn() }));
vi.mock("../../../lib/api/reductions", () => ({ spinAsymmetry: saMock }));

const chan = (r: number[]): DataStruct => ({
  time: [0.01, 0.02, 0.03], values: r.map((v) => [v]), labels: ["R"], units: [""], metadata: {},
});

const outputs = () => useApp.getState().datasets.filter((d) => d.id !== "pp" && d.id !== "mm");

beforeEach(() => {
  vi.clearAllMocks();
  saMock.mockResolvedValue({ asymmetry: [0.1, 0.2, 0.3], d_asymmetry: [0, 0, 0], n_valid: 3 });
  useApp.setState({
    datasets: [{ id: "pp", name: "rpp", data: chan([3, 2, 1]) }, { id: "mm", name: "rmm", data: chan([2, 1, 0.5]) }],
    activeId: "pp", status: "", analysisResults: [], history: [], future: [], staleDatasets: [], staleFits: [], recalcMode: "manual",
  });
});

describe("useSpinAsymmetry commit contract", () => {
  it("a repeat run creates no duplicate and says so", async () => {
    const { result } = renderHook(() => useSpinAsymmetry());
    await act(async () => { await result.current.compute(); });
    expect(outputs()).toHaveLength(1);
    await act(async () => { await result.current.compute(); });
    expect(outputs()).toHaveLength(1);
    expect(useApp.getState().analysisResults).toHaveLength(1);
    expect(result.current.done).toContain("already added");
  });

  it("is one undo step (worksheet and result together) and adds again after Undo", async () => {
    const { result } = renderHook(() => useSpinAsymmetry());
    await act(async () => { await result.current.compute(); });
    act(() => useApp.getState().undo());
    expect(outputs()).toHaveLength(0);
    expect(useApp.getState().analysisResults).toHaveLength(0);
    await act(async () => { await result.current.compute(); });
    expect(outputs()).toHaveLength(1);
  });

  it("lists both channels as sources: a change to R-- marks the output stale (manual mode)", async () => {
    const { result } = renderHook(() => useSpinAsymmetry());
    await act(async () => { await result.current.compute(); });
    const out = outputs()[0].id;
    expect(useApp.getState().analysisResults[0].sources.map((s) => s.datasetId).sort()).toEqual(["mm", "pp"]);
    act(() => useApp.getState().touchDataset("mm"));
    expect(useApp.getState().staleDatasets).toContain(out);
  });

  it("records the Q axis both channels were read against as each input's X range (acceptance C9)", async () => {
    const { result } = renderHook(() => useSpinAsymmetry());
    await act(async () => { await result.current.compute(); });
    expect(useApp.getState().analysisResults[0].parameters?.["inputs"]).toMatchObject({
      items: [{ datasetId: "pp", xRange: [0.01, 0.03] }, { datasetId: "mm", xRange: [0.01, 0.03] }],
    });
  });
});
