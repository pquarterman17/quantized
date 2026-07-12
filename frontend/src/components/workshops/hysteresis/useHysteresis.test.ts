import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hysteresisAnalysis } from "../../../lib/api";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useHysteresis } from "./useHysteresis";

vi.mock("../../../lib/api", () => ({ hysteresisAnalysis: vi.fn() }));

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
