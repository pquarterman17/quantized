// UX audit 8 #5 (lane UX8-D): the Peak analyzer's defaults find the real
// peaks of an ordinary XRD scan, not the noise of its low-angle background.
// On the audit's synthetic pattern (6 Lorentzian peaks on a decaying
// background, Poisson counts) the old defaults -- SNR 3, no prominence floor,
// up to 20 peaks -- marked 14 noise points at 10-27° (30-90 counts, 4
// samples wide); 3 % of the tallest peak as a true floor keeps the 6 real
// ones (measured against the real route: 20 -> 6). The cap keeps the default
// model inside the fit's free-parameter budget (12 pV hit the time limit). The
// end-to-end check on that file is e2e/specs/fit-peak-defaults.spec.ts.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { findPeaks } from "../../../lib/api/peaks";
import { DEFAULT_RECIPE } from "../../../lib/peakwizard";
import type { Dataset } from "../../../lib/types";
import { DEFAULT_SHAPE_PARAMS, defaultPeakShape, heavyModel, MAX_FREE, prominenceFloor } from "./peakDefaults";
import { recipeFind } from "./recipeSteps";
import { useAutoShape } from "./usePeakDefaults";

vi.mock("../../../lib/api/peaks", () => ({ findPeaks: vi.fn(async () => ({ peaks: [], background: [] })) }));

beforeEach(() => vi.clearAllMocks());

describe("adaptive find defaults", () => {
  it("are a 3 % prominence floor over SNR 3, at most 9 peaks", () => {
    expect(DEFAULT_RECIPE.find).toEqual({ snr_threshold: 3, min_prominence: 0.03, max_peaks: 9, strict_prominence: true });
  });

  it("cap the default model inside MAX_FREE: widest default shape + a linear background", () => {
    const widest = Math.max(...Object.values(DEFAULT_SHAPE_PARAMS));
    expect(DEFAULT_RECIPE.find.max_peaks * widest + 2).toBeLessThanOrEqual(MAX_FREE);
    expect(heavyModel(DEFAULT_RECIPE.find.max_peaks * widest + 2, 6474)).toBe(false); // csv_xrd's points
  });

  it("state the floor the route applies (step ② note), per sensitivity and for a 0", () => {
    const f = DEFAULT_RECIPE.find;
    expect(prominenceFloor(f)).toBe(0.03);
    expect(prominenceFloor({ ...f, sensitivity: "medium" })).toBe(0.03);
    expect(prominenceFloor({ ...f, sensitivity: "high" })).toBe(0.005);
    expect(prominenceFloor({ ...f, sensitivity: "low" })).toBe(0.05);
    expect(prominenceFloor({ ...f, min_prominence: 0 })).toBe(0.02); // not sent: the route's default
    expect(prominenceFloor({ ...f, min_prominence: 0.1, sensitivity: "low" })).toBe(0.1);
  });

  it("go on the wire as the route's strict prominence", async () => {
    await recipeFind([1, 2, 3], [4, 5, 6], DEFAULT_RECIPE.find);
    expect(findPeaks).toHaveBeenCalledWith({
      x: [1, 2, 3], y: [4, 5, 6], snr_threshold: 3, min_prominence: 0.03, max_peaks: 9, strict_prominence: true,
    });
  });

  it("leave a recipe saved before them exactly as it was (no strict flag sent)", async () => {
    await recipeFind([1], [2], { snr_threshold: 3, min_prominence: 0, max_peaks: 20 });
    expect(findPeaks).toHaveBeenCalledWith({ x: [1], y: [2], snr_threshold: 3, max_peaks: 20 });
  });
});

const ds = (name: string, technique: string, x = "Col1", unit = ""): Dataset =>
  ({
    id: "d",
    name,
    data: { time: [], values: [], labels: ["Col2"], units: [""], metadata: { technique, x_column_name: x, x_column_unit: unit } },
  }) as unknown as Dataset;

describe("defaultPeakShape (step ③ starts from pseudo-Voigt on XRD / Raman)", () => {
  it("reads the technique tag", () => {
    expect(defaultPeakShape(ds("scan", "xrd.powder"), null)).toBe("Pseudo-Voigt");
    // Spectroscopy is IR / UV-Vis too: pseudo-Voigt only with Raman evidence.
    expect(defaultPeakShape(ds("spectrum", "spectroscopy"), null)).toBe("Gaussian");
    expect(defaultPeakShape(ds("spectrum", "spectroscopy", "Raman shift", "cm-1"), null)).toBe("Pseudo-Voigt");
    expect(defaultPeakShape(ds("loop", "magnetometry.mvsh"), null)).toBe("Gaussian");
  });

  it("reads a generic import's name and X axis for the same evidence", () => {
    expect(defaultPeakShape(ds("XRD_theta2theta", "generic"), null)).toBe("Pseudo-Voigt");
    expect(defaultPeakShape(ds("Raman_Si_graphite", "generic"), null)).toBe("Pseudo-Voigt");
    expect(defaultPeakShape(ds("csv_xrd", "generic"), null)).toBe("Pseudo-Voigt");
    expect(defaultPeakShape(ds("run 4", "generic", "2θ", "deg"), null)).toBe("Pseudo-Voigt");
    expect(defaultPeakShape(ds("run 4", "generic", "2Theta"), null)).toBe("Pseudo-Voigt");
    expect(defaultPeakShape(ds("run 4", "generic", "Raman shift", "cm-1"), null)).toBe("Pseudo-Voigt");
  });

  it("is Gaussian without evidence -- 'xrd' must be a word, not a substring", () => {
    expect(defaultPeakShape(ds("MT_ZFC_FC", "generic", "Temperature", "K"), null)).toBe("Gaussian");
    expect(defaultPeakShape(ds("hexrdump", "generic"), null)).toBe("Gaussian");
    expect(defaultPeakShape(ds("Ramanathan run 3", "generic"), null)).toBe("Gaussian");
    expect(defaultPeakShape(ds("FTIR film", "spectroscopy", "Wavenumber", "cm-1"), null)).toBe("Gaussian");
  });

  it("knows the XRD variants (pxrd, hrxrd, gixrd)", () => {
    for (const name of ["sample_pxrd", "HRXRD 004", "gixrd-0.5deg"]) {
      expect(defaultPeakShape(ds(name, "generic"), null)).toBe("Pseudo-Voigt");
    }
  });

  it("reads the plotted X column's label when one is picked", () => {
    const d = ds("run 4", "generic");
    d.data.labels.push("Two Theta");
    d.data.units.push("°");
    expect(defaultPeakShape(d, 1)).toBe("Pseudo-Voigt");
    expect(defaultPeakShape(d, 0)).toBe("Gaussian");
  });
});

describe("useAutoShape (the recipe's shape follows the dataset until chosen)", () => {
  const setup = (pick: string | null, shape: string) => {
    const apply = vi.fn();
    const hook = renderHook((p: { pick: string | null; shape: string }) => useAutoShape(p.pick, p.shape, apply), {
      initialProps: { pick, shape },
    });
    return { apply, hook };
  };

  it("starts an XRD dataset from pseudo-Voigt and follows a switch to another dataset", () => {
    const { apply, hook } = setup("Pseudo-Voigt", "Gaussian");
    expect(apply).toHaveBeenLastCalledWith("Pseudo-Voigt");
    hook.rerender({ pick: "Pseudo-Voigt", shape: "Pseudo-Voigt" });
    hook.rerender({ pick: "Gaussian", shape: "Pseudo-Voigt" }); // an M(T) curve next
    expect(apply).toHaveBeenLastCalledWith("Gaussian");
  });

  it("never overrides a shape the user picked or a recipe set", () => {
    const { apply, hook } = setup("Pseudo-Voigt", "Lorentzian"); // already not the default
    expect(apply).not.toHaveBeenCalled();
    act(() => hook.result.current()); // touched
    hook.rerender({ pick: "Gaussian", shape: "Gaussian" });
    hook.rerender({ pick: "Pseudo-Voigt", shape: "Gaussian" });
    expect(apply).not.toHaveBeenCalled();
  });
});
