import { describe, expect, it } from "vitest";

import {
  posteriorCorrelationDiagnostic,
} from "./reflPosteriorCorrelation";
import { correlationToTSV } from "../../../lib/multivar";

describe("reflectivity posterior correlation diagnostics", () => {
  it("uses the backend free-parameter order and ranks absolute trade-offs", () => {
    const diagnostic = posteriorCorrelationDiagnostic({
      free: ["film.thickness", "film.sld", "background"],
      correlation: [[1, -0.91, 0.2], [-0.91, 1, 0.74], [0.2, 0.74, 1]],
    });
    expect(diagnostic.issue).toBeNull();
    expect(diagnostic.pairs).toEqual([
      { first: "film.thickness", second: "film.sld", r: -0.91 },
      { first: "film.sld", second: "background", r: 0.74 },
      { first: "film.thickness", second: "background", r: 0.2 },
    ]);
    expect(correlationToTSV(diagnostic.labels, diagnostic.matrix)).toContain("film.thickness\t1.0000\t-0.9100\t0.2000");
  });

  it("refuses an unlabeled, non-square, duplicate, or out-of-range matrix", () => {
    for (const value of [
      { free: [], correlation: [] },
      { free: ["a", "b"], correlation: [[1, 0.2]] },
      { free: ["a", "a"], correlation: [[1, 0.2], [0.2, 1]] },
      { free: ["a", "b"], correlation: [[1, 1.2], [1.2, 1]] },
      { free: ["a", "b"], correlation: [[1, 0.2], [0.3, 1]] },
      { free: ["a", "b"], correlation: [[0.9, 0.2], [0.2, 1]] },
    ]) expect(posteriorCorrelationDiagnostic(value).issue).toMatch(/unavailable/);
  });

  it("explains that a one-parameter posterior has no pair to correlate", () => {
    expect(posteriorCorrelationDiagnostic({ free: ["scale"], correlation: [[1]] }).issue)
      .toMatch(/Only one parameter was free/);
  });
});
