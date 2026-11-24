import { describe, expect, it } from "vitest";

import { ANALYSIS_TOOL_METADATA } from "./analysisCenter";
import { analysisUnavailableReason, withAnalysisRequirements, type RequirementContext } from "./analysisRequirements";
import type { Dataset } from "./types";
import type { Action } from "../store/commands";

function sheet(over: { labels?: string[]; units?: string[]; rows?: number; metadata?: Record<string, unknown>; id?: string } = {}): Dataset {
  const rows = over.rows ?? 12;
  const labels = over.labels ?? ["Intensity"];
  return {
    id: over.id ?? "d1",
    name: "scan",
    data: {
      time: Array.from({ length: rows }, (_, i) => i),
      values: Array.from({ length: rows }, (_, i) => labels.map((_l, c) => i + c)),
      labels,
      units: over.units ?? labels.map(() => ""),
      metadata: over.metadata ?? {},
    },
  };
}

const ctx = (dataset?: Dataset, extra: Dataset[] = []): RequirementContext => ({ dataset, datasets: dataset ? [dataset, ...extra] : extra });

describe("analysisUnavailableReason", () => {
  it("covers every described Analyze tool without throwing, on empty and typical input", () => {
    for (const id of Object.keys(ANALYSIS_TOOL_METADATA)) {
      expect(() => analysisUnavailableReason(id, ctx())).not.toThrow();
      expect(() => analysisUnavailableReason(id, ctx(sheet()))).not.toThrow();
    }
  });

  it("needs an active worksheet for dataset tools but not for calculators", () => {
    expect(analysisUnavailableReason("curvefit", ctx())).toBe("Import or select a dataset first");
    expect(analysisUnavailableReason("calculators", ctx())).toBeUndefined();
    expect(analysisUnavailableReason("digitizer", ctx())).toBeUndefined();
  });

  it("needs a numeric Y column and 3 rows for continuous tools", () => {
    expect(analysisUnavailableReason("curvefit", ctx(sheet()))).toBeUndefined();
    expect(analysisUnavailableReason("curvefit", ctx(sheet({ labels: [] })))).toBe("Needs a numeric Y column");
    expect(analysisUnavailableReason("peaks", ctx(sheet({ rows: 2 })))).toBe("Needs at least 3 data rows");
  });

  it("needs 2 numeric columns for multivariate and 3 for surface fit", () => {
    // X + one response = two numeric columns.
    expect(analysisUnavailableReason("multivar", ctx(sheet()))).toBeUndefined();
    expect(analysisUnavailableReason("multivar", ctx(sheet({ labels: [], rows: 5 })))).toBe("Needs 2 or more numeric columns");
    expect(analysisUnavailableReason("surface-fit", ctx(sheet()))).toBe("Needs 3 or more numeric columns (X, Y, Z)");
    expect(analysisUnavailableReason("surface-fit", ctx(sheet({ labels: ["Y", "Z"] })))).toBeUndefined();
  });

  it("needs 2 or more worksheets to average curves", () => {
    const a = sheet();
    expect(analysisUnavailableReason("average-curves", ctx(a))).toBe("Needs 2 or more worksheets");
    expect(analysisUnavailableReason("average-curves", ctx(a, [sheet({ id: "d2" })]))).toBeUndefined();
  });

  it("needs a 2θ X axis for Pawley and reference patterns, from the label or a degree unit", () => {
    const meta = (label: string, unit: string) => ({ x_column_name: label, x_column_unit: unit });
    expect(analysisUnavailableReason("reductions-pawley", ctx(sheet({ metadata: meta("q", "1/A") })))).toBe("Needs a 2θ X axis");
    expect(analysisUnavailableReason("reductions-pawley", ctx(sheet({ metadata: meta("2-Theta", "deg") })))).toBeUndefined();
    expect(analysisUnavailableReason("reductions-reference", ctx(sheet({ metadata: meta("2Theta", "") })))).toBeUndefined();
    expect(analysisUnavailableReason("reductions-reference", ctx(sheet()))).toBe("Needs a 2θ X axis");
    // Williamson-Hall accepts typed peaks, so any worksheet fits.
    expect(analysisUnavailableReason("reductions-wh", ctx(sheet({ metadata: { technique: "xrd.powder" } })))).toBeUndefined();
  });

  it("does not call a lazy Origin preview a non-2θ axis", () => {
    const pending = { ...sheet(), pending: { rows: 500 } } as unknown as Dataset;
    expect(analysisUnavailableReason("reductions-pawley", ctx(pending))).toBeUndefined();
  });

  it("names the wrong technique for technique-bound tools but leaves generic data open", () => {
    expect(analysisUnavailableReason("hysteresis", ctx(sheet({ metadata: { technique: "sims" } })))).toBe("Needs magnetometry data");
    expect(analysisUnavailableReason("hysteresis", ctx(sheet({ metadata: { technique: "magnetometry.mvsh" } })))).toBeUndefined();
    expect(analysisUnavailableReason("hysteresis", ctx(sheet()))).toBeUndefined();
  });
});

describe("withAnalysisRequirements", () => {
  const act = (id: string, group = "Analyze"): Action => ({ id, group, label: id, run: () => {} });

  it("drives disabled/disabledReason live from the context and leaves other actions alone", () => {
    let current = ctx();
    const [fit, calc, other] = withAnalysisRequirements([act("curvefit"), act("calculators"), act("curvefit", "Plot")], () => current);
    const read = (a: Action) => [typeof a.disabled === "function" ? a.disabled() : a.disabled, typeof a.disabledReason === "function" ? a.disabledReason() : a.disabledReason];
    expect(read(fit)).toEqual([true, "Import or select a dataset first"]);
    current = ctx(sheet());
    expect(read(fit)).toEqual([false, undefined]);
    expect(read(calc)).toEqual([false, undefined]);
    expect(other.disabled).toBeUndefined();
  });
});
