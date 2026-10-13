// The Units tab's SOURCE units come from the data, not a hard-coded "Oe"/"emu".
// The request used to say from_field "Oe" whatever x was: on an M(T) curve the
// temperatures were scaled as oersteds (300 K -> 0.03 "T"), and a loop already
// in tesla was shrunk by 1e-4 a second time. The moment was always "emu", so an
// A·m² channel was relabelled emu/g without the backend ever seeing its unit.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { convertMagUnits } from "../../../lib/api/magnetometry";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useMagTools, type UnitParams } from "./useMagTools";

vi.mock("../../../lib/api/magnetometry", () => ({
  subtractMagBackground: vi.fn(),
  subtractHysteresisBackground: vi.fn(),
  convertMagUnits: vi.fn(),
}));

const curve = (xName: string, xUnit: string, yUnit = "emu"): DataStruct => ({
  time: [2, 100, 300],
  values: [[5], [2], [1]],
  labels: ["Moment"],
  units: [yUnit],
  metadata: { x_column_name: xName, x_column_unit: xUnit },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(convertMagUnits).mockImplementation(async (b) => ({
    x: b.x, y: b.y, x_unit: b.to_field ?? "", y_unit: b.to_moment ?? "", warning: "",
  }));
});

async function convertWith(data: DataStruct, patch: Partial<UnitParams>) {
  useApp.setState({ datasets: [{ id: "d1", name: "s.dat", data }], activeId: "d1", xKey: null, yKeys: null, seriesOrder: null });
  const { result } = renderHook(() => useMagTools());
  act(() => result.current.setTab("units"));
  act(() => result.current.setUnits(patch));
  await act(async () => {
    await result.current.convert();
  });
  return { body: vi.mocked(convertMagUnits).mock.calls[0][0], result };
}

describe("useMagTools units — source units follow the data", () => {
  it("never converts a temperature axis as a field", async () => {
    const { body, result } = await convertWith(curve("Temperature", "K"), { toField: "T" });
    expect([body.from_field, body.to_field]).toEqual(["K", "K"]);
    expect(useApp.getState().datasets[1].data.metadata.x_column_unit).toBe("K");
    expect(result.current.warning).toContain("not a field");
  });

  it("converts a field axis from its own unit", async () => {
    const { body } = await convertWith(curve("Magnetic Field", "T"), { toField: "mT" });
    expect([body.from_field, body.to_field]).toEqual(["T", "mT"]);
  });

  it("sends the moment channel's own unit", async () => {
    const { body } = await convertWith(curve("Magnetic Field", "Oe", "A·m²"), { toMoment: "emu/g", sampleMass: 2, massUnit: "g" });
    expect(body.from_moment).toBe("A·m²");
  });

  it("converts mixed-unit film geometry and records the entered values", async () => {
    const { body } = await convertWith(curve("Magnetic Field", "Oe"), {
      toMoment: "A/m", volumeMode: "film", sampleWidth: 5, widthUnit: "cm",
      sampleHeight: 5, heightUnit: "cm", sampleThickness: 30, thicknessUnit: "nm",
    });
    expect(body.sample_volume).toBeCloseTo(7.5e-5);
    expect(useApp.getState().datasets[1].data.metadata.magnetometry_normalization).toEqual(expect.objectContaining({
      to_moment: "A/m", sample_volume_cm3: expect.closeTo(7.5e-5),
      volume_definition: expect.objectContaining({ mode: "rectangular-film", thickness: 30, thickness_unit: "nm" }),
    }));
  });

  it("refuses missing normalization inputs even when the hook is called directly", async () => {
    useApp.setState({ datasets: [{ id: "d1", name: "s.dat", data: curve("Magnetic Field", "Oe") }], activeId: "d1" });
    const { result } = renderHook(() => useMagTools());
    act(() => result.current.setUnits({ toMoment: "emu/g", sampleMass: 0 }));
    await act(async () => { await result.current.convert(); });
    expect(convertMagUnits).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/positive sample mass/);
  });
});
