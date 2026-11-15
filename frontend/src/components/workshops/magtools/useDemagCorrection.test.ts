import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { demagCorrectField } from "../../../lib/api/magnetometry";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useDemagCorrection } from "./useDemagCorrection";

vi.mock("../../../lib/api/magnetometry", () => ({
  demagCorrectField: vi.fn(),
  subtractMagBackground: vi.fn(),
  subtractHysteresisBackground: vi.fn(),
  normalizeMagMoment: vi.fn(),
}));

const realResolveDataset = useApp.getState().resolveDataset;

function loop(unit = "emu/cm³"): Dataset {
  return {
    id: "mh",
    name: "loop.dat",
    data: {
      time: [-1000, 0, 1000],
      values: [[-10, 0.2], [0, Number.NaN], [10, 0.4]],
      labels: ["Magnetization", "M uncertainty"],
      units: [unit, unit],
      metadata: { x_column_name: "Magnetic field", x_column_unit: "Oe" },
    },
    errorRoles: [{ channel: 1, target: 0, axis: "y", side: "both" }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [loop()], activeId: "mh", xKey: null, yKeys: null, seriesOrder: null,
    resolveDataset: realResolveDataset, status: "",
  });
  vi.mocked(demagCorrectField).mockResolvedValue({
    field: [-958.1121, 0, 958.1121],
    field_errors: [[0.8378, 0, 1.6755]],
    field_unit: "Oe", magnetization_unit: "emu/cm³",
    shape: "Sphere", n_factor: 1 / 3, n_cgs: 4 * Math.PI / 3,
  });
});

describe("useDemagCorrection", () => {
  it("fails closed until geometry is explicit, then writes a derived dataset with provenance", async () => {
    const { result } = renderHook(() => useDemagCorrection());
    expect(result.current.problem).toMatch(/Choose the sample geometry/);
    act(() => result.current.setShape("Sphere"));
    expect(result.current.problem).toBeNull();
    await act(async () => { await result.current.apply(); });

    expect(demagCorrectField).toHaveBeenCalledWith(expect.objectContaining({
      field: [-1000, 0, 1000], magnetization: [-10, 0, 10], shape: "Sphere",
      field_unit: "Oe", magnetization_unit: "emu/cm³",
      magnetization_errors: [[0.2, 0, 0.4]],
    }));
    const output = useApp.getState().datasets[1];
    expect(output.data.time).toEqual([-958.1121, 0, 958.1121]);
    expect(output.data.labels).toEqual([
      "Magnetization", "M uncertainty", "Internal field uncertainty",
    ]);
    expect(output.data.values[1]).toEqual([0, Number.NaN, Number.NaN]);
    expect(output.errorRoles).toEqual([
      { channel: 1, target: 0, axis: "y", side: "both" },
      { channel: 2, target: -1, axis: "x", side: "both" },
    ]);
    expect(output.data.metadata.magnetometry_demag_correction).toEqual(expect.objectContaining({
      shape: "Sphere", n_factor_si: 1 / 3,
    }));
    expect(output.data.metadata.error_roles).toEqual(output.errorRoles);
    expect(output.data.metadata.x_column_name).toBe("Internal field");
  });

  it("requires volume-normalized magnetization", () => {
    useApp.setState({ datasets: [loop("emu")], activeId: "mh" });
    const { result } = renderHook(() => useDemagCorrection());
    act(() => result.current.setShape("Sphere"));
    expect(result.current.problem).toMatch(/Units tab first/);
  });

  function loopWithFieldError(side: "both" | "+" | "-" = "both", unit = "Oe", target = -1): Dataset {
    const d = loop();
    d.data = {
      ...d.data,
      values: [[-10, 0.2, 5], [0, Number.NaN, 5], [10, 0.4, Number.NaN]],
      labels: ["Magnetization", "M uncertainty", "H uncertainty"],
      units: [d.data.units[0], d.data.units[1], unit],
    };
    d.errorRoles = [
      { channel: 1, target: 0, axis: "y", side: "both" },
      { channel: 2, target, axis: "x", side },
    ];
    return d;
  }

  it("propagates applied-field uncertainty (sent as field_errors) and keeps its gap rows as gaps", async () => {
    useApp.setState({ datasets: [loopWithFieldError()], activeId: "mh" });
    const { result } = renderHook(() => useDemagCorrection());
    act(() => result.current.setShape("Sphere"));
    expect(result.current.problem).toBeNull();
    vi.mocked(demagCorrectField).mockResolvedValue({
      field: [-958.1121, 0, 958.1121], field_errors: [[5.1, 5, 0]],
      field_unit: "Oe", magnetization_unit: "emu/cm³",
      shape: "Sphere", n_factor: 1 / 3, n_cgs: 4 * Math.PI / 3,
    });
    await act(async () => { await result.current.apply(); });
    expect(demagCorrectField).toHaveBeenCalledWith(expect.objectContaining({
      magnetization_errors: [[0.2, 0, 0.4]], field_errors: [[5, 5, 0]],
    }));
    const out = useApp.getState().datasets[1];
    // Row 1 has a gap M uncertainty and row 2 a gap field uncertainty: neither is invented.
    expect(out.data.values.map((r) => r[2])).toEqual([5.1, Number.NaN, Number.NaN]);
    expect(out.data.metadata.magnetometry_demag_correction).toEqual(expect.objectContaining({
      uncertainty: expect.stringContaining("magnetization and applied-field"),
    }));
  });

  it("carries applied-field uncertainty alone into one internal-field error column", async () => {
    const d = loopWithFieldError();
    d.errorRoles = [{ channel: 2, target: -1, axis: "x", side: "both" }];
    useApp.setState({ datasets: [d], activeId: "mh" });
    const { result } = renderHook(() => useDemagCorrection());
    act(() => result.current.setShape("Sphere"));
    vi.mocked(demagCorrectField).mockResolvedValue({
      field: [-958.1121, 0, 958.1121], field_errors: [[5, 5, 0]],
      field_unit: "Oe", magnetization_unit: "emu/cm³",
      shape: "Sphere", n_factor: 1 / 3, n_cgs: 4 * Math.PI / 3,
    });
    await act(async () => { await result.current.apply(); });
    expect(demagCorrectField).toHaveBeenCalledWith(expect.objectContaining({ magnetization_errors: [], field_errors: [[5, 5, 0]] }));
    const out = useApp.getState().datasets[1];
    expect(out.data.labels).toEqual(["Magnetization", "Internal field uncertainty"]);
    expect(out.errorRoles).toEqual([{ channel: 1, target: -1, axis: "x", side: "both" }]);
  });

  it("fails closed on asymmetric, wrong-unit, or foreign-axis applied-field uncertainty", () => {
    for (const [d, re] of [
      [loopWithFieldError("+"), /asymmetric/],
      [loopWithFieldError("both", "T"), /not the field unit Oe/],
      [loopWithFieldError("both", "Oe", 1), /different x axis/],
    ] as const) {
      useApp.setState({ datasets: [d], activeId: "mh" });
      const { result } = renderHook(() => useDemagCorrection());
      act(() => result.current.setShape("Sphere"));
      expect(result.current.problem).toMatch(re);
    }
  });

  it("reverses asymmetric uncertainty sides because magnetization is subtracted", async () => {
    const data = loop();
    data.errorRoles = [{ channel: 1, target: 0, axis: "y", side: "+" }];
    useApp.setState({ datasets: [data], activeId: "mh" });
    const { result } = renderHook(() => useDemagCorrection());
    act(() => result.current.setShape("Sphere"));
    await act(async () => { await result.current.apply(); });
    expect(useApp.getState().datasets[1].errorRoles).toEqual([
      { channel: 1, target: 0, axis: "y", side: "+" },
      { channel: 2, target: -1, axis: "x", side: "-" },
    ]);
    expect(useApp.getState().datasets[1].data.labels[2]).toBe("Internal field uncertainty -");
  });

  it("does not apply the correction a second time", () => {
    const data = loop();
    data.data.metadata.magnetometry_demag_correction = { version: 1 };
    useApp.setState({ datasets: [data], activeId: "mh" });
    const { result } = renderHook(() => useDemagCorrection());
    act(() => result.current.setShape("Sphere"));
    expect(result.current.problem).toMatch(/already uses internal field/);
  });

  it("abandons an in-flight correction when the source is replaced", async () => {
    let finish!: (value: Awaited<ReturnType<typeof demagCorrectField>>) => void;
    let started!: () => void;
    const signal = new Promise<void>((resolve) => { started = resolve; });
    vi.mocked(demagCorrectField).mockImplementationOnce(async () => {
      started();
      return await new Promise((resolve) => { finish = resolve; });
    });
    const { result } = renderHook(() => useDemagCorrection());
    act(() => result.current.setShape("Sphere"));
    let run!: Promise<void>;
    act(() => { run = result.current.apply(); });
    await signal;
    act(() => useApp.setState({ datasets: [{ ...loop(), data: { ...loop().data, time: [-2, 0, 2] } }] }));
    await act(async () => {
      finish({ field: [-1, 0, 1], field_errors: [[0, 0, 0]], field_unit: "Oe",
        magnetization_unit: "emu/cm³", shape: "Sphere", n_factor: 1 / 3, n_cgs: 4 * Math.PI / 3 });
      await run;
    });
    expect(useApp.getState().datasets).toHaveLength(1);
  });

  it("does not copy the source's descriptive header rows onto the corrected columns", async () => {
    const d = loop();
    d.data.metadata = { ...d.data.metadata, label_rows: [{ index: 0, role: "label", name: "Temperature", x: "Temperature", cells: ["300 K", "50 K"] }] };
    useApp.setState({ datasets: [d], activeId: "mh" });
    const { result } = renderHook(() => useDemagCorrection());
    act(() => result.current.setShape("Sphere"));
    await act(async () => { await result.current.apply(); });
    expect(useApp.getState().datasets[1].data.metadata.label_rows).toBeUndefined();
  });
});
