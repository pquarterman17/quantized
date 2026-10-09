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
    expect(csv).toContain("included,center,center_1sigma,fwhm,fwhm_1sigma");
    expect(csv).toContain("false,31.7,0.02,0.15,,425,3,81,2,4,0.5,0.04");
    expect(csv).toContain(`"'=HYPERLINK(""bad"")"`);
    expect(csv).toContain("'+review");
  });
});
