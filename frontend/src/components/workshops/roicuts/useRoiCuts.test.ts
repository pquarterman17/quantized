import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { rsmBoxCut, rsmBoxStats, rsmChiProfile, rsmSector } from "../../../lib/api/rsm";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { polarBranch, useRoiCuts } from "./useRoiCuts";

vi.mock("../../../lib/api/rsm", () => ({
  rsmBoxCut: vi.fn(),
  rsmBoxStats: vi.fn(),
  rsmSector: vi.fn(),
  rsmChiProfile: vi.fn(),
}));

// True-polar: carries Qx/Qz.
const Q_DS: DataStruct = {
  time: [0, 1, 2, 3],
  values: [
    [60, 30, 100, 0.5, 4.0],
    [61, 30, 200, 0.45, 3.9],
    [60, 31, 150, 0.4, 4.1],
    [61, 31, 300, 0.42, 3.8],
  ],
  labels: ["2Theta", "Omega", "Intensity", "Qx", "Qz"],
  units: ["deg", "deg", "cps", "Ang^-1", "Ang^-1"],
  metadata: { is2D: true, map_shape: [2, 2], axis1_name: "Omega" },
};

// Pole figure: Phi (labels[0]) sweeps ~360deg, Psi (labels[1]) is a narrow tilt band.
const POLE_DS: DataStruct = {
  time: [0, 1, 2, 3],
  values: [
    [0, 10, 100],
    [120, 10, 120],
    [240, 10, 90],
    [359, 10, 80],
  ],
  labels: ["Phi", "Psi", "Intensity"],
  units: ["deg", "deg", "cps"],
  metadata: { is2D: true, mesh_kind: "pole", axis1_name: "Psi", axis2_name: "Phi", map_shape: [4, 1] },
};

// Neither: a narrow angular mesh with no Q columns and no near-full-circle axis.
const NONE_DS: DataStruct = {
  time: [0, 1, 2, 3],
  values: [
    [60, 30, 100],
    [61, 30, 200],
    [60, 31, 150],
    [61, 31, 300],
  ],
  labels: ["2Theta", "Omega", "Intensity"],
  units: ["deg", "deg", "cps"],
  metadata: { is2D: true, map_shape: [2, 2], axis1_name: "Omega" },
};

function setActive(id: string, data: DataStruct): void {
  useApp.setState({ datasets: [{ id, name: `${id}.xrdml`, data }], activeId: id });
}

const RESULT: DataStruct = {
  time: [0, 1],
  values: [
    [0.5, 10],
    [0.6, 12],
  ],
  labels: ["Intensity", "N points"],
  units: ["cps", ""],
  metadata: { cut_label: "box cut" },
};

// Async actions (runBox/runStats/runSector/runChi) fire the mocked API call
// synchronously but land through useCutLanding's async land() — flush its
// microtask queue before asserting on the resulting store state.
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ mapRoi: null, mapRuler: null, savedRois: [], selectedIds: [] });
  setActive("d1", Q_DS);
});

describe("polarBranch", () => {
  it("picks true-polar when Qx/Qz are present", () => {
    expect(polarBranch(Q_DS)).toEqual({ kind: "q" });
  });

  it("picks the pole-figure branch for a near-full-circle Phi axis", () => {
    expect(polarBranch(POLE_DS)).toEqual({ kind: "pole", axis: "x" });
  });

  it("disables polar ops with a stated reason for a plain angular pair", () => {
    const branch = polarBranch(NONE_DS);
    expect(branch.kind).toBe("none");
    expect(branch.kind === "none" && branch.reason).toMatch(/Qx\/Qz|φ\/ψ/);
  });
});

describe("useRoiCuts — box card", () => {
  it("a numeric edit creates/updates the SAME store.mapRoi field", () => {
    const { result } = renderHook(() => useRoiCuts());
    expect(useApp.getState().mapRoi).toBeNull();

    // Each setter reads the CURRENT store value, so successive edits must
    // each get their own act() flush to see the previous one's write —
    // exactly like a real user typing into one field, then the next.
    act(() => result.current.setBoxX0(1.5));
    expect(useApp.getState().mapRoi?.x0).toBe(1.5);
    expect(result.current.boxRect?.x0).toBe(1.5);

    act(() => result.current.setBoxX1(2.5));
    // The second edit patches the SAME rect (x0 survives) rather than
    // replacing it — proof both fields route through one store value.
    expect(useApp.getState().mapRoi).toEqual(expect.objectContaining({ x0: 1.5, x1: 2.5 }));
  });

  it("runBox posts the shaped body and lands a dataset", async () => {
    vi.mocked(rsmBoxCut).mockResolvedValue(RESULT);
    act(() => {
      useApp.getState().setMapRoi({ space: "angular", x0: 0, x1: 10, y0: 0, y1: 10 });
    });
    const { result } = renderHook(() => useRoiCuts());
    const before = useApp.getState().datasets.length;

    act(() => result.current.runBox());
    await flush();

    expect(rsmBoxCut).toHaveBeenCalledWith(
      expect.objectContaining({
        x_min: 0,
        x_max: 10,
        y_min: 0,
        y_max: 10,
        space: "angular",
        collapse: "x",
        reduce: "sum",
      }),
    );
    expect(useApp.getState().datasets.length).toBe(before + 1);
  });

  it("runStats posts the box-stats body and stores the readout", async () => {
    const stats = {
      n_points: 4,
      integrated_intensity: 42,
      mean_intensity: 10.5,
      max_intensity: 20,
      peak_x: 1,
      peak_y: 2,
      centroid_x: 1.1,
      centroid_y: 2.2,
      x_min: 0,
      x_max: 10,
      y_min: 0,
      y_max: 10,
      space: "angular",
      angle: 0,
      wrap: null,
    };
    vi.mocked(rsmBoxStats).mockResolvedValue(stats);
    act(() => {
      useApp.getState().setMapRoi({ space: "angular", x0: 0, x1: 10, y0: 0, y1: 10 });
    });
    const { result } = renderHook(() => useRoiCuts());

    await act(async () => {
      await result.current.runStats();
    });

    expect(rsmBoxStats).toHaveBeenCalled();
    expect(result.current.boxStats).toEqual(stats);
  });
});

describe("useRoiCuts — sector card polar routing", () => {
  it("branch (i): true polar routes 'radial' to /api/rsm/sector", async () => {
    vi.mocked(rsmSector).mockResolvedValue(RESULT);
    const { result } = renderHook(() => useRoiCuts());
    expect(result.current.polar).toEqual({ kind: "q" });

    act(() => result.current.runSector());
    await flush();

    expect(rsmSector).toHaveBeenCalledWith(expect.objectContaining({ dataset: Q_DS }));
    expect(rsmBoxCut).not.toHaveBeenCalled();
  });

  it("branch (i): true polar routes 'azimuthal' to /api/rsm/chi-profile", async () => {
    vi.mocked(rsmChiProfile).mockResolvedValue(RESULT);
    const { result } = renderHook(() => useRoiCuts());

    act(() => result.current.runChi());
    await flush();

    expect(rsmChiProfile).toHaveBeenCalledWith(expect.objectContaining({ dataset: Q_DS }));
    expect(rsmBoxCut).not.toHaveBeenCalled();
  });

  it("branch (ii): a pole-figure axis pair routes through /api/rsm/box with wrap", async () => {
    vi.mocked(rsmBoxCut).mockResolvedValue(RESULT);
    setActive("d2", POLE_DS);
    const { result } = renderHook(() => useRoiCuts());
    expect(result.current.polar).toEqual({ kind: "pole", axis: "x" });

    act(() => result.current.runSector());
    await flush();

    expect(rsmSector).not.toHaveBeenCalled();
    expect(rsmBoxCut).toHaveBeenCalledWith(expect.objectContaining({ dataset: POLE_DS, wrap: "x" }));
  });

  it("branch (iii): a plain angular pair routes to neither (guarded no-op)", async () => {
    setActive("d3", NONE_DS);
    const { result } = renderHook(() => useRoiCuts());
    expect(result.current.polar.kind).toBe("none");

    act(() => result.current.runSector());
    await flush();

    expect(rsmSector).not.toHaveBeenCalled();
    expect(rsmBoxCut).not.toHaveBeenCalled();
  });
});

describe("useRoiCuts — saved ROIs", () => {
  it("save/apply round-trips a RoiDef through the SAME store fields", () => {
    act(() => {
      useApp.getState().setMapRoi({ space: "angular", x0: 3, x1: 7, y0: 1, y1: 9 });
    });
    const { result } = renderHook(() => useRoiCuts());
    const drawn = useApp.getState().mapRoi;
    expect(drawn).not.toBeNull();

    let id: string | null = null;
    act(() => {
      id = result.current.saveCurrentRoi("my box");
    });
    expect(id).not.toBeNull();
    expect(result.current.savedRois).toHaveLength(1);
    expect(result.current.savedRois[0]).toEqual(
      expect.objectContaining({ name: "my box", kind: "rect", rect: drawn }),
    );

    // Clear the working box, then applying the save restores it exactly.
    act(() => {
      useApp.getState().setMapRoi(null);
    });
    expect(useApp.getState().mapRoi).toBeNull();

    act(() => {
      result.current.applySaved(id as unknown as string);
    });
    expect(useApp.getState().mapRoi).toEqual(drawn);
  });

  it("removeSaved deletes the entry", () => {
    act(() => {
      useApp.getState().setMapRoi({ space: "angular", x0: 0, x1: 1, y0: 0, y1: 1 });
    });
    const { result } = renderHook(() => useRoiCuts());
    let id: string | null = null;
    act(() => {
      id = result.current.saveCurrentRoi("temp");
    });
    expect(result.current.savedRois).toHaveLength(1);

    act(() => {
      result.current.removeSaved(id as unknown as string);
    });
    expect(result.current.savedRois).toHaveLength(0);
  });
});
