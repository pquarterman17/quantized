import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { pawleyRefine } from "../../../lib/api/reductions";
import type { PawleyResult } from "../../../lib/reductionTypes";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { usePawley } from "./usePawley";

vi.mock("../../../lib/api/reductions", () => ({
  pawleyRefine: vi.fn(),
}));

// xrdml-style provenance (`io/_xrdml_scan.py` writes exactly this shape).
const scan: DataStruct = {
  time: [20, 30, 40, 50],
  values: [[100, 9], [200, 8], [300, 7], [400, 6]],
  labels: ["Intensity", "Other"],
  units: ["cps", "cps"],
  metadata: { x_column_name: "2-Theta", x_column_unit: "deg" },
};

const result: PawleyResult = {
  cell: [5.42, 5.42, 5.42, 90, 90, 90],
  cell_initial: [5.43, 5.43, 5.43, 90, 90, 90],
  scale: null,
  peaks: [{ hkl: [1, 1, 1], two_theta: 28.4, d: 3.13, multiplicity: 8, intensity: 12 }],
  background: [10, 11, 12, 13],
  model: [90, 190, 290, 390],
  residual: [10, 10, 10, 10],
  rwp: 0.05,
  rwp_initial: 0.2,
  converged: true,
  tie: "abc",
  hkl_max: 8,
  n_peaks: 1,
};

function setActive(data: DataStruct, name = "powder.xrdml"): void {
  useApp.setState({ datasets: [{ id: "d1", name, data }], activeId: "d1" });
}

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ status: "" });
  setActive(scan);
});

describe("usePawley request", () => {
  it("sends the selected channel, independent axes, and the scan's own 2θ window", async () => {
    vi.mocked(pawleyRefine).mockResolvedValue(result);
    const { result: hook } = renderHook(() => usePawley());
    act(() => {
      hook.current.setCol(1);
      hook.current.setTie("none");
      hook.current.setField("a", "4.1");
      hook.current.setField("b", "4.2");
      hook.current.setField("c", "4.3");
      hook.current.setField("beta", "91");
      hook.current.setSymmetry("I");
    });
    expect(hook.current.canCompute).toBe(true);
    await act(async () => {
      await hook.current.compute();
    });
    expect(pawleyRefine).toHaveBeenCalledWith(expect.objectContaining({
      two_theta: [20, 30, 40, 50],
      intensity: [9, 8, 7, 6],
      a: 4.1,
      b: 4.2,
      c: 4.3,
      beta: 91,
      symmetry: "I",
      tie: "none",
      min_two_theta: 20,
      max_two_theta: 50,
    }));
    expect(hook.current.result?.cell[0]).toBe(5.42);
    expect(hook.current.fitRange).toEqual({ min: 20, max: 50 });
  });

  it("sends a cubic cell as a = b = c by default, ignoring stale b/c text", async () => {
    vi.mocked(pawleyRefine).mockResolvedValue(result);
    const { result: hook } = renderHook(() => usePawley());
    act(() => {
      hook.current.setField("b", "9.9");
      hook.current.setField("c", "");
      hook.current.setField("a", "5.40");
    });
    expect(hook.current.tie).toBe("abc");
    expect(hook.current.canCompute).toBe(true);
    await act(async () => {
      await hook.current.compute();
    });
    expect(pawleyRefine).toHaveBeenCalledWith(expect.objectContaining({ a: 5.4, b: 5.4, c: 5.4, tie: "abc" }));
  });

  it("drops non-finite rows before calling the float-only API", async () => {
    vi.mocked(pawleyRefine).mockResolvedValue({
      ...result, model: [90, 290, 390], residual: [10, 10, 10], background: [10, 10, 10],
    });
    setActive({ ...scan, values: [[100, 9], [Number.NaN, 8], [300, 7], [400, 6]] });
    const { result: hook } = renderHook(() => usePawley());
    await act(async () => {
      await hook.current.compute();
    });
    expect(pawleyRefine).toHaveBeenCalledWith(expect.objectContaining({
      two_theta: [20, 40, 50],
      intensity: [100, 300, 400],
    }));
    expect(hook.current.result).not.toBeNull();
  });

  it("refuses a response whose length does not match the rows sent", async () => {
    vi.mocked(pawleyRefine).mockResolvedValue({ ...result, model: [1, 2, 3] });
    const { result: hook } = renderHook(() => usePawley());
    await act(async () => {
      await hook.current.compute();
    });
    expect(hook.current.result).toBeNull();
    expect(hook.current.error).toMatch(/3 model points for 4 observed/);
  });

  it("surfaces the backend's refusal", async () => {
    vi.mocked(pawleyRefine).mockRejectedValue(
      new Error("No allowed reflections between 20° and 25° 2θ for this cell, centering and wavelength."),
    );
    const { result: hook } = renderHook(() => usePawley());
    await act(async () => {
      await hook.current.compute();
    });
    expect(hook.current.result).toBeNull();
    expect(hook.current.error).toMatch(/No allowed reflections/);
  });
});

describe("usePawley wavelength", () => {
  it("seeds λ from the file's measured wavelength", () => {
    setActive({ ...scan, metadata: { ...scan.metadata, wavelength_a: 0.70932 } });
    const { result: hook } = renderHook(() => usePawley());
    expect(hook.current.fields.wavelength).toBe("0.70932");
    expect(hook.current.wavelengthFromFile).toBe(true);
    act(() => hook.current.setField("wavelength", "1.5406"));
    expect(hook.current.wavelengthFromFile).toBe(false);
  });

  it("falls back to Cu Kα1 when the file records none", () => {
    const { result: hook } = renderHook(() => usePawley());
    expect(hook.current.fields.wavelength).toBe("1.5406");
    expect(hook.current.wavelengthFromFile).toBe(false);
  });
});

describe("usePawley axis fail-closed", () => {
  it("accepts a unit-less label with 2θ evidence", () => {
    setActive({ ...scan, metadata: { x_column_name: "2Theta", x_column_unit: "" } });
    const { result: hook } = renderHook(() => usePawley());
    expect(hook.current.blockedReason).toBeNull();
  });

  it.each([
    ["q", "Å⁻¹"],
    ["q", ""],
    ["Time", "s"],
    ["Temperature", "°C"],
  ])("refuses an x axis %s (%s) and never calls the API", async (name, unit) => {
    setActive({ ...scan, metadata: { x_column_name: name, x_column_unit: unit } });
    const { result: hook } = renderHook(() => usePawley());
    expect(hook.current.canCompute).toBe(false);
    expect(hook.current.blockedReason).toMatch(/not 2θ in degrees/);
    await act(async () => {
      await hook.current.compute();
    });
    expect(pawleyRefine).not.toHaveBeenCalled();
  });
});

describe("usePawley input checks disable Refine", () => {
  it("refuses an emptied field instead of sending 0", async () => {
    const { result: hook } = renderHook(() => usePawley());
    act(() => hook.current.setField("fwhm", ""));
    expect(hook.current.canCompute).toBe(false);
    expect(hook.current.blockedReason).toMatch(/FWHM must be a positive/);
    await act(async () => {
      await hook.current.compute();
    });
    expect(pawleyRefine).not.toHaveBeenCalled();
  });

  it("refuses cell angles with no real volume", () => {
    const { result: hook } = renderHook(() => usePawley());
    act(() => {
      hook.current.setField("alpha", "170");
      hook.current.setField("beta", "170");
      hook.current.setField("gamma", "170");
    });
    expect(hook.current.blockedReason).toMatch(/positive-volume/);
  });

  it("refuses a channel index the dataset no longer has", () => {
    const { result: hook } = renderHook(() => usePawley());
    act(() => hook.current.setCol(1));
    act(() => useApp.setState({
      datasets: [{ id: "d1", name: "powder.xrdml", data: { ...scan, labels: ["Intensity"], units: ["cps"] } }],
    }));
    expect(hook.current.canCompute).toBe(false);
    expect(hook.current.blockedReason).toMatch(/intensity channel/);
  });
});

describe("usePawley → Library", () => {
  it("adds observed, model, background and residual on the exact fitted rows", async () => {
    vi.mocked(pawleyRefine).mockResolvedValue(result);
    setActive({ ...scan, metadata: { ...scan.metadata, wavelength_a: 1.540598 } });
    const { result: hook } = renderHook(() => usePawley());
    await act(async () => {
      await hook.current.compute();
    });
    // Later edits to the panel and the source must not relabel the result.
    act(() => {
      hook.current.setCol(1);
      hook.current.setSymmetry("F");
      hook.current.setField("wavelength", "0.7107");
      useApp.setState({
        datasets: [{ id: "d1", name: "renamed.xrdml", data: {
          ...scan, time: [1, 2, 3, 4], labels: ["Changed", "Other"], units: ["arb", "cps"],
        } }],
      });
    });
    act(() => hook.current.toLibrary());
    const added = useApp.getState().datasets[1];
    expect(added.name).toBe("powder.xrdml (Pawley)");
    expect(added.data.time).toEqual([20, 30, 40, 50]);
    expect(added.data.values).toEqual([
      [100, 90, 10, 10],
      [200, 190, 11, 10],
      [300, 290, 12, 10],
      [400, 390, 13, 10],
    ]);
    expect(added.data.labels).toEqual(["Intensity", "Pawley model", "Background", "Residual"]);
    expect(added.data.units[0]).toBe("cps");
    expect(added.data.metadata).toEqual(expect.objectContaining({
      reduction: "pawley",
      source_dataset_id: "d1",
      technique: "xrd.powder",
      x_column_name: "2-Theta",
      x_column_long: "2-Theta",
      x_column_unit: "deg",
      // The instrument reading is carried; the value the fit used is nested.
      wavelength_a: 1.540598,
      pawley: expect.objectContaining({
        wavelength_a: 1.540598,
        symmetry: "P",
        tie: "abc",
        profile_fwhm_deg: 0.12,
        refine_cell: true,
        hkl_max: 8,
        two_theta_range_deg: [20, 50],
        rwp: 0.05,
        rwp_initial: 0.2,
        cell_refined: result.cell,
        peaks: result.peaks,
      }),
    }));
  });

  it("does not stamp a typed wavelength under the instrument key", async () => {
    vi.mocked(pawleyRefine).mockResolvedValue(result);
    const { result: hook } = renderHook(() => usePawley());
    await act(async () => {
      await hook.current.compute();
    });
    act(() => hook.current.toLibrary());
    const md = useApp.getState().datasets[1].data.metadata ?? {};
    expect(md).not.toHaveProperty("wavelength_a");
    expect(md.pawley).toEqual(expect.objectContaining({ wavelength_a: 1.5406 }));
  });

  it("names the axis '2Theta' when the source label carries no 2θ evidence of its own", async () => {
    vi.mocked(pawleyRefine).mockResolvedValue(result);
    setActive({ ...scan, metadata: { x_column_name: "x", x_column_unit: "deg" } });
    const { result: hook } = renderHook(() => usePawley());
    await act(async () => {
      await hook.current.compute();
    });
    act(() => hook.current.toLibrary());
    expect(useApp.getState().datasets[1].data.metadata).toEqual(expect.objectContaining({
      x_column_name: "2Theta",
      x_column_long: "2Theta",
      x_column_unit: "deg",
    }));
  });
});

it("discards a stale completion when the active dataset changes mid-flight", async () => {
  let resolveFn!: (v: PawleyResult) => void;
  vi.mocked(pawleyRefine).mockReturnValue(new Promise<PawleyResult>((res) => {
    resolveFn = res;
  }));
  const { result: hook } = renderHook(() => usePawley());

  let pending!: Promise<void>;
  act(() => {
    pending = hook.current.compute();
  });
  expect(hook.current.busy).toBe(true);

  act(() => {
    useApp.setState({
      datasets: [
        { id: "d1", name: "powder.xrdml", data: scan },
        { id: "d2", name: "other.xrdml", data: scan },
      ],
      activeId: "d2",
    });
  });
  // The new dataset's panel is not busy with the old dataset's request.
  expect(hook.current.busy).toBe(false);

  await act(async () => {
    resolveFn(result);
    await pending;
  });
  expect(hook.current.result).toBeNull();
  expect(hook.current.error).toBeNull();
  expect(hook.current.busy).toBe(false);
});
