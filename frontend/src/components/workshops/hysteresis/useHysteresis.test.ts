import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { act } from "@testing-library/react";

import {
  hysteresisAnalysis,
  subtractHysteresisBackground,
} from "../../../lib/api/magnetometry";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useHysteresis } from "./useHysteresis";

vi.mock("../../../lib/api/magnetometry", () => ({
  hysteresisAnalysis: vi.fn(),
  subtractHysteresisBackground: vi.fn(),
}));

const DATA: DataStruct = {
  time: [-2, -1, 0, 1, 2], // H
  values: [[-1], [-0.5], [0], [0.5], [1]], // M
  labels: ["M"],
  units: ["emu"],
  metadata: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(hysteresisAnalysis).mockResolvedValue({ Hc: 0.1, Mr: 0.2, Ms: 1.0 });
  useApp.setState({
    datasets: [{ id: "d1", name: "mvsh.dat", data: DATA }],
    activeId: "d1",
    xKey: null,
    yKeys: null,
    seriesOrder: null,
  });
});

describe("useHysteresis", () => {
  it("runs the M-H analysis on the full loop when nothing is excluded", async () => {
    const { result } = renderHook(() => useHysteresis());
    await waitFor(() => expect(result.current.result).not.toBeNull());
    expect(hysteresisAnalysis).toHaveBeenCalledWith({
      h: [-2, -1, 0, 1, 2],
      m: [-1, -0.5, 0, 0.5, 1],
    });
    expect(result.current.result?.Hc).toBe(0.1);
  });

  it("uses the plotted H (X) and M (primary Y) on multi-column data (audit P1 #1)", async () => {
    const multi: DataStruct = {
      time: [0, 1, 2, 3], // a timestamp column — NOT the field
      values: [[-2, -1], [-1, -0.5], [1, 0.5], [2, 1]], // [Field, Moment]
      labels: ["Field", "Moment"],
      units: ["Oe", "emu"],
      metadata: {},
    };
    useApp.setState({
      datasets: [{ id: "d1", name: "mvsh.dat", data: multi }],
      activeId: "d1",
      xKey: 0, // Field
      yKeys: [1], // Moment
      seriesOrder: null,
    });
    const { result } = renderHook(() => useHysteresis());
    await waitFor(() => expect(result.current.result).not.toBeNull());
    expect(hysteresisAnalysis).toHaveBeenCalledWith({
      h: [-2, -1, 1, 2], // Field channel, NOT the timestamp
      m: [-1, -0.5, 0.5, 1], // Moment channel, NOT values[0]=Field
    });
  });

  it("honors row exclusion (#50): a masked outlier drops from Hc/Mr/Ms", async () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "mvsh.dat", data: DATA, excludedRows: [2] }],
      activeId: "d1",
    });
    const { result } = renderHook(() => useHysteresis());
    await waitFor(() => expect(result.current.result).not.toBeNull());
    expect(hysteresisAnalysis).toHaveBeenCalledWith({
      h: [-2, -1, 1, 2], // H=0 row dropped
      m: [-1, -0.5, 0.5, 1],
    });
  });
});

// BUG-021 finding 2: the owner's gapped loop 422'd here too. `JSON.stringify`
// writes a NaN as `null`, pydantic `list[float]` rejects each one, and THIS
// effect fires automatically on dataset activation — so the workshop failed
// before it could show anything.
const GAPPED: DataStruct = {
  time: [-2, -1, 0, 1, 2],
  values: [[-1], [Number.NaN], [0], [0.5], [1]],
  labels: ["M"],
  units: ["emu"],
  metadata: {},
};

describe("useHysteresis — gaps (NaN) never reach the wire", () => {
  it("the auto-analysis drops gap rows instead of sending null", async () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "mvsh.dat", data: GAPPED }],
      activeId: "d1",
    });
    const { result } = renderHook(() => useHysteresis());
    await waitFor(() => expect(result.current.result).not.toBeNull());
    const body = vi.mocked(hysteresisAnalysis).mock.calls[0][0];
    expect(body).toEqual({ h: [-2, 0, 1, 2], m: [-1, 0, 0.5, 1] });
    expect(JSON.stringify(body)).not.toContain("null");
  });

  it("TELLS the user rows were excluded — it never drops them silently", async () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "mvsh.dat", data: GAPPED }],
      activeId: "d1",
    });
    const { result } = renderHook(() => useHysteresis());
    await waitFor(() => expect(result.current.result).not.toBeNull());
    expect(result.current.warning).toContain("1 of 5 rows are gaps");
  });

  it("says nothing when there is nothing to say (a gap-free loop)", async () => {
    const { result } = renderHook(() => useHysteresis());
    await waitFor(() => expect(result.current.result).not.toBeNull());
    expect(result.current.warning).toBeNull();
  });

  it("the background subtract drops gaps and restores them on their own rows", async () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "mvsh.dat", data: GAPPED }],
      activeId: "d1",
    });
    vi.mocked(subtractHysteresisBackground).mockResolvedValue({
      corrected: [-1.1, 0.1, 0.6, 1.1],
      slope: 1,
      offset: 2,
    });
    const { result } = renderHook(() => useHysteresis());
    await waitFor(() => expect(result.current.result).not.toBeNull());
    await act(async () => {
      await result.current.subtractBackground();
    });

    const body = vi.mocked(subtractHysteresisBackground).mock.calls[0][0];
    expect(body.m).toEqual([-1, 0, 0.5, 1]);
    expect(JSON.stringify(body)).not.toContain("null");

    const out = useApp.getState().datasets[1].data;
    expect(out.time).toEqual(GAPPED.time); // the full original field column
    expect(out.values[0]).toEqual([-1.1]);
    expect(Number.isNaN(out.values[1][0])).toBe(true); // the gap is still a gap
    expect(out.values[2]).toEqual([0.1]);
    expect(out.values[4]).toEqual([1.1]);
  });

  it("refuses before the request when too little finite data remains", async () => {
    useApp.setState({
      datasets: [
        {
          id: "d1",
          name: "mvsh.dat",
          data: { ...GAPPED, values: [[Number.NaN], [Number.NaN], [Number.NaN], [Number.NaN], [1]] },
        },
      ],
      activeId: "d1",
    });
    const { result } = renderHook(() => useHysteresis());
    await waitFor(() => expect(result.current.result).not.toBeNull());
    await act(async () => {
      await result.current.subtractBackground();
    });
    expect(subtractHysteresisBackground).not.toHaveBeenCalled();
    expect(result.current.error).toContain("1 of 5 rows");
    expect(useApp.getState().datasets).toHaveLength(1);
  });
});
