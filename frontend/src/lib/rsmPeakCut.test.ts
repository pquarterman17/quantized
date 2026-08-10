import { describe, expect, it } from "vitest";

import {
  buildPeakRuler,
  defaultPeakForCut,
  estimateQGridCell,
  peakCutLabel,
  peakHasQCentre,
  withPeakCutLabel,
} from "./rsmPeakCut";
import type { DataStruct, RsmPeak } from "./types";

function peak(rank: number, cls: string, q: [number | null, number | null]): RsmPeak {
  return {
    rank,
    classification: cls,
    centre_angle: [30, 60],
    centre_Q: q,
    fwhm_angle: [0.1, 0.2],
    fwhm_Q: [0.01, 0.02],
    amplitude: 100,
    background: 1,
  };
}

const RSM: DataStruct = {
  time: [0, 1, 2, 3],
  values: [
    [60, 30, 100, 0.4, 3.8],
    [61, 30, 200, 0.5, 3.9],
    [60, 31, 150, 0.4, 4.1],
    [61, 31, 300, 0.5, 4.2],
  ],
  labels: ["2Theta", "Omega", "Intensity", "Qx", "Qz"],
  units: ["deg", "deg", "cps", "Ang^-1", "Ang^-1"],
  metadata: { is2D: true, map_shape: [2, 2], axis1_name: "Omega" },
};

describe("peakHasQCentre", () => {
  it("is true for a finite Q centre", () => {
    expect(peakHasQCentre(peak(1, "film", [0.4, 3.8]))).toBe(true);
  });
  it("is false for null or non-finite components", () => {
    expect(peakHasQCentre(peak(1, "film", [null, 3.8]))).toBe(false);
    expect(peakHasQCentre(peak(1, "film", [NaN, 3.8]))).toBe(false);
  });
});

describe("defaultPeakForCut", () => {
  it("prefers the film peak", () => {
    const peaks = [peak(1, "substrate", [0.5, 4.0]), peak(2, "film", [0.4, 3.8])];
    expect(defaultPeakForCut(peaks)?.classification).toBe("film");
  });
  it("falls back to the first peak when none is classified film", () => {
    const peaks = [peak(1, "substrate", [0.5, 4.0]), peak(2, "unknown", [0.4, 3.8])];
    expect(defaultPeakForCut(peaks)?.rank).toBe(1);
  });
  it("is null for an empty list", () => {
    expect(defaultPeakForCut([])).toBeNull();
  });
});

describe("estimateQGridCell", () => {
  it("derives spacing from the Qx/Qz extents and map_shape", () => {
    // Qx spans 0.4..0.5 over 2 cols -> cellX = 0.1; Qz spans 3.8..4.2 over 2 rows -> cellZ = 0.4.
    expect(estimateQGridCell(RSM)).toBeCloseTo((0.1 + 0.4) / 2);
  });

  it("falls back to 1 when there is no Q column", () => {
    const noQ: DataStruct = { time: [], values: [[1]], labels: ["I"], units: ["cps"], metadata: {} };
    expect(estimateQGridCell(noQ)).toBe(1);
  });

  it("falls back to 1 for an empty dataset", () => {
    const empty: DataStruct = { time: [], values: [], labels: ["Qx", "Qz", "Intensity"], units: [], metadata: {} };
    expect(estimateQGridCell(empty)).toBe(1);
  });
});

describe("buildPeakRuler", () => {
  it("builds a radial ruler along atan2(qz, qx), centred on the peak", () => {
    const p = peak(2, "film", [0.4, 3.8]);
    const ruler = buildPeakRuler(RSM, p, "radial");
    expect(ruler).not.toBeNull();
    expect(ruler!.space).toBe("q");
    expect(ruler!.cx).toBeCloseTo(0.4);
    expect(ruler!.cy).toBeCloseTo(3.8);
    expect(ruler!.angle).toBeCloseTo((Math.atan2(3.8, 0.4) * 180) / Math.PI);
  });

  it("builds the transverse ruler 90° from radial", () => {
    const p = peak(2, "film", [0.4, 3.8]);
    const radial = buildPeakRuler(RSM, p, "radial")!;
    const transverse = buildPeakRuler(RSM, p, "transverse")!;
    expect(transverse.angle).toBeCloseTo(radial.angle + 90);
  });

  it("is null for a peak with no finite Q centre", () => {
    expect(buildPeakRuler(RSM, peak(3, "unknown", [null, null]), "radial")).toBeNull();
  });
});

describe("peakCutLabel / withPeakCutLabel", () => {
  it("names the direction, classification, and rank", () => {
    expect(peakCutLabel(peak(2, "film", [0.4, 3.8]), "radial")).toBe("Radial cut — film peak (rank 2)");
    expect(peakCutLabel(peak(1, "substrate", [0.5, 4.0]), "transverse")).toBe(
      "Transverse cut — substrate peak (rank 1)",
    );
  });

  it("overwrites cut_label and tags provenance without touching other fields", () => {
    const cut: DataStruct = {
      time: [0, 1],
      values: [[1, 1]],
      labels: ["Intensity", "N points"],
      units: ["cps", ""],
      metadata: { cut_kind: "box", roi: [0, 1, 2, 3] },
    };
    const relabeled = withPeakCutLabel(cut, peak(2, "film", [0.4, 3.8]), "radial");
    expect(relabeled.metadata["cut_label"]).toBe("Radial cut — film peak (rank 2)");
    expect(relabeled.metadata["rsm_cut_kind"]).toBe("radial");
    expect(relabeled.metadata["rsm_peak_classification"]).toBe("film");
    expect(relabeled.metadata["rsm_peak_rank"]).toBe(2);
    expect(relabeled.metadata["cut_kind"]).toBe("box"); // original metadata preserved
    expect(relabeled.values).toBe(cut.values); // everything but metadata untouched
  });
});
