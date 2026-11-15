// The magnetometry tools on T1,M1,H2,M2 (plot X = T1, M2 plotted): field-vs-
// temperature detection and every output's X identity come from M2's OWN X
// (H2), never the plot's shared T1.
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  demagCorrectField,
  normalizeMagMoment,
  subtractHysteresisBackground,
} from "../../../lib/api/magnetometry";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useDemagCorrection } from "./useDemagCorrection";
import { useMagNormalization } from "./useMagNormalization";
import { useMagTools } from "./useMagTools";

vi.mock("../../../lib/api/magnetometry", () => ({
  subtractMagBackground: vi.fn(),
  subtractHysteresisBackground: vi.fn(),
  normalizeMagMoment: vi.fn(),
  demagCorrectField: vi.fn(),
}));

const realResolveDataset = useApp.getState().resolveDataset;
const H2 = [-2000, -1000, 0, 1000, 2000];
const M2 = [-1, -0.5, 0, 0.5, 1];

// time = T1 (Temperature, K); columns M1 (0), H2 (1, "Set As X"), M2 (2).
function sheet(): Dataset {
  return {
    id: "own",
    name: "own.dat",
    data: {
      time: [300, 250, 200, 150, 100],
      values: H2.map((h, i) => [5 + i, h, M2[i]]),
      labels: ["M1", "Magnetic Field", "M2"],
      units: ["emu/cm³", "Oe", "emu/cm³"],
      metadata: { x_column_name: "Temperature", x_column_unit: "K" },
    },
    columnDesignations: { 1: "X" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [sheet()], activeId: "own", xKey: null, yKeys: [2], seriesOrder: null,
    status: "", savedSampleProfiles: [], resolveDataset: realResolveDataset,
  });
});

describe("useMagTools on a secondary-X Y", () => {
  it("detects a FIELD axis (M2 is against H2) although the plot X is a temperature", () => {
    const { result } = renderHook(() => useMagTools());
    expect(result.current.detection.kind).toBe("field");
    expect(result.current.bgPath).toBe("mh");
    expect(result.current.source).toMatchObject({ fromField: "Oe", xUnit: "Oe" });
  });

  it("the reverse: M1 (on the temperature X) is detected as temperature", () => {
    useApp.setState({ yKeys: [0] });
    const { result } = renderHook(() => useMagTools());
    expect(result.current.detection.kind).toBe("temperature");
    expect(result.current.bgPath).toBe("mt");
  });

  it("background subtraction reads H2 and stamps H2's identity on the output", async () => {
    vi.mocked(subtractHysteresisBackground).mockResolvedValue({
      corrected: M2.map((m) => m * 0.9), slope: 1e-5, offset: 0.1,
    });
    const { result } = renderHook(() => useMagTools());
    await act(async () => { await result.current.subtractBackground(); });
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(2));
    expect(subtractHysteresisBackground).toHaveBeenCalledWith(expect.objectContaining({ h: H2, m: M2 }));
    const out = useApp.getState().datasets[1].data;
    expect(out.time).toEqual(H2);
    expect(out.metadata).toMatchObject({
      x_column_name: "Magnetic Field", x_column_long: "Magnetic Field", x_column_unit: "Oe",
    });
  });
});

describe("useMagNormalization on a secondary-X Y", () => {
  it("sends H2 and records H2 as the output's X and the provenance xKey", async () => {
    const raw = sheet();
    raw.data = { ...raw.data, units: ["emu", "Oe", "emu"] }; // un-normalized moment
    useApp.setState({ datasets: [raw] });
    vi.mocked(normalizeMagMoment).mockImplementation(async (b) => ({
      x: b.x, y: b.y.map((v) => v / 2), x_unit: b.to_field, y_unit: b.to_moment, warning: "",
      basis: b.basis, geometry: b.geometry, factor: 0.5, divisor: 2, divisor_unit: "g",
      mass_g: 2, area_cm2: null, volume_cm3: null, canonical: { mass: 2 }, equation: "eq", geometry_equation: "",
    }));
    const { result } = renderHook(() => useMagNormalization());
    act(() => result.current.setBasis("mass"));
    act(() => result.current.setFieldText("mass", "2"));
    await act(async () => { await result.current.apply(); });
    expect(vi.mocked(normalizeMagMoment).mock.calls[0][0]).toMatchObject({ x: H2, y: M2, from_field: "Oe" });
    const out = useApp.getState().datasets[1].data;
    expect(out.time).toEqual(H2);
    expect(out.metadata).toMatchObject({ x_column_name: "Magnetic Field", x_column_unit: "Oe" });
    expect(out.metadata.magnetometry_normalization).toMatchObject({ source_x_key: 1, source_y_key: 2 });
  });
});

describe("useDemagCorrection on a secondary-X Y", () => {
  it("corrects H2 (not the temperature column) and keeps H2's unit", async () => {
    vi.mocked(demagCorrectField).mockResolvedValue({
      field: H2.map((h) => h * 0.9), field_errors: [],
      field_unit: "Oe", magnetization_unit: "emu/cm³", shape: "Sphere", n_factor: 1 / 3, n_cgs: 4 * Math.PI / 3,
    });
    const { result } = renderHook(() => useDemagCorrection());
    act(() => result.current.setShape("Sphere"));
    expect(result.current.problem).toBeNull();
    await act(async () => { await result.current.apply(); });
    expect(demagCorrectField).toHaveBeenCalledWith(expect.objectContaining({
      field: H2, magnetization: M2, field_unit: "Oe",
    }));
    const out = useApp.getState().datasets[1].data;
    expect(out.time).toEqual(H2.map((h) => h * 0.9));
    expect(out.metadata.x_column_unit).toBe("Oe");
  });
});
