// Acceptance pass 15 C2: with no group column every plotted channel is a box, so the value axis is titled over
// all of them (the joint title other multi-channel plots use), on screen and in the export.
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsBox } from "../../lib/api";
import { exportCategoricalFigure, exportStatplotFigure } from "../../lib/api/figures";
import type { DataStruct, Dataset } from "../../lib/types";
import { useStatStage, type UseStatStageParams } from "./useStatStage";

vi.mock("../../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/api")>()), statsBox: vi.fn() }));
vi.mock("../../lib/api/figures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api/figures")>()),
  exportStatplotFigure: vi.fn(),
  exportCategoricalFigure: vi.fn(),
}));

const data = (units: string[]): DataStruct => ({
  time: [0, 1, 2, 3, 4, 5],
  values: [[3, 7, 9], [4, 8, 9.5], [5, 7.5, 10], [6, 9, 8], [3.5, 8.5, 9], [4.5, 7, 10]],
  labels: ["ctl", "low", "high"],
  units,
  metadata: {},
});
const mount = (units: string[]) => {
  const active: Dataset = { id: "w3", name: "wide3.csv", data: data(units) };
  const p: UseStatStageParams = { active, yKeys: null, xKey: null, seriesOrder: null, seed: null, onSeedConsumed: vi.fn() };
  const hook = renderHook(() => useStatStage(p));
  act(() => hook.result.current.setMode("box"));
  return hook;
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(statsBox).mockRejectedValue(new Error("offline"));
  vi.mocked(exportStatplotFigure).mockResolvedValue(undefined);
  vi.mocked(exportCategoricalFigure).mockResolvedValue(undefined);
});

describe("a multi-channel Stat Box value axis", () => {
  it("is titled over every channel, on screen and in the export", async () => {
    const { result } = mount(["", "", ""]);
    await waitFor(() => expect(result.current.draw?.mode).toBe("box"));
    const d = result.current.draw;
    expect(d && "valueLabel" in d ? d.valueLabel : null).toBe("ctl, low, high");
    await act(async () => { await result.current.exportFigure("svg"); });
    const call = [...vi.mocked(exportStatplotFigure).mock.calls, ...vi.mocked(exportCategoricalFigure).mock.calls][0];
    expect(call[0].y_label).toBe("ctl, low, high");
  });

  it("shares the unit when the channels share one", async () => {
    const { result } = mount(["V", "V", "V"]);
    await waitFor(() => expect(result.current.draw?.mode).toBe("box"));
    const d = result.current.draw;
    expect(d && "valueLabel" in d ? d.valueLabel : null).toBe("ctl, low, high (V)");
  });
});
