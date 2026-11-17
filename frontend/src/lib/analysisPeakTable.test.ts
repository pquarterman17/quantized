import { describe, expect, it } from "vitest";

import type { PeakTable } from "./peakTable";
import { analysisPeakTableCsv } from "./analysisPeakTable";

const table: PeakTable = {
  version: 1,
  peaks: [{
    id: "peak-1", center: 31.7, centerErr: 0.02, fwhm: 0.15, fwhmErr: null,
    height: 425, heightErr: 3, area: 81, areaErr: 2, bg: 4, eta: 0.5,
    etaErr: 0.04, model: "=HYPERLINK(\"bad\")", status: "+review", excluded: true,
  }],
  provenance: {
    datasetId: "xrd", datasetName: "film", method: "simultaneous", model: "Pseudo-Voigt",
    bgDegree: 1, linkMode: "None", constrain: false, bgCoeffs: [], R2: 0.99, rmse: 0.1,
    wavelengthA: 1.5406, xLabel: "2Theta", xUnit: "deg", fingerprint: "fp", fittedAt: "2026-10-08T00:00:00Z",
  },
};

describe("analysisPeakTableCsv", () => {
  it("exports uncertainty, exclusion, and spreadsheet-safe text", () => {
    const csv = analysisPeakTableCsv(table);
    // fwhm has no σ on any row, so no fwhm_1sigma column (UX audit 9 #3).
    expect(csv).toContain("included,center,center_1sigma,fwhm,height,height_1sigma,area,area_1sigma,background,eta,eta_1sigma,model");
    // Each value PDG-rounded to its σ: 31.7 ± 0.02 → 31.700 ± 0.020, η 0.5 ± 0.04 → 0.50 ± 0.04.
    expect(csv).toContain("false,31.700,0.020,0.15,425.0,3.0,81.0,2.0,4,0.50,0.04");
    expect(csv).toContain(`"'=HYPERLINK(""bad"")"`);
    expect(csv).toContain("'+review");
  });
});
