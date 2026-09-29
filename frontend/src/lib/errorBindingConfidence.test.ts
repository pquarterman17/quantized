// Cross-language parity for the error-binding CONFIDENCE GRADE: this file and
// tests/test_error_binding_confidence_parity_fixture.py both read the
// hand-curated tests/fixtures/error_labels/confidence_corpus.json (its
// `_about` explains how it is maintained). A failure here means TypeScript and
// src/quantized/io/error_binding_confidence.py DISAGREE -- make them agree;
// never edit an expected value to hide it. The second block pins the consumer
// rule the Quick Plot / Quick Figure Builder seed goes through.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  bindingConfidence,
  reviewSeedErrorBindings,
  scoreErrorBindings,
  type Confidence,
  type HeaderEvidence,
  type ScoredErrorBinding,
} from "./errorBindingConfidence";
import { declaresErrorRoles } from "./errorRoles";
import type { UnitEvidence } from "./errorUnitEvidence";
import { originBookErrorRoles } from "./originBookRoles";
import type { Dataset } from "./types";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(here, "../../../tests/fixtures/error_labels/confidence_corpus.json");

interface GradedCase {
  note: string;
  labels: string[];
  units?: string[];
  x_unit?: string | null;
  scored: ScoredErrorBinding[];
}

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")) as {
  grades: { header: HeaderEvidence; unit: UnitEvidence; confidence: Confidence }[];
  cases: GradedCase[];
  label_only: GradedCase[];
};

describe("confidence grade parity fixture (shared with the Python)", () => {
  it("exercises every grade", () => {
    const seen = new Set(fixture.cases.flatMap((c) => c.scored.map((s) => s.confidence)));
    expect(seen).toEqual(new Set(["high", "medium", "low", "blocked"]));
  });

  it.each(fixture.grades.map((g) => [`${g.header}+${g.unit}`, g] as const))("grade table %s", (_id, g) => {
    expect(bindingConfidence(g.header, g.unit)).toBe(g.confidence);
  });

  it.each(fixture.cases.map((c) => [c.note, c] as const))("%s", (_note, c) => {
    expect(scoreErrorBindings(c.labels, c.units ?? [], c.x_unit ?? null)).toEqual(c.scored);
  });

  it("re-grades the whole label-only parity corpus", () => {
    expect(fixture.label_only.length).toBeGreaterThan(50);
    for (const c of fixture.label_only) {
      expect(scoreErrorBindings(c.labels, c.labels.map(() => "")), c.note).toEqual(c.scored);
    }
  });
});

function sheet(labels: string[], units: string[], extra: Partial<Dataset> = {}): Pick<Dataset, "data" | "errorRoles"> {
  return {
    data: { time: [0, 1], values: [labels.map(() => 1), labels.map(() => 2)], labels, units, metadata: {} },
    ...extra,
  };
}

describe("reviewSeedErrorBindings -- what a new figure may apply without asking", () => {
  it("withholds an adjacency-only (low) pairing for confirmation and applies the rest", () => {
    // `dR` pairs by name (medium); the bare `err` after SA pairs by position only.
    const review = reviewSeedErrorBindings(sheet(["Q", "R", "dR", "SA", "err"], ["", "", "", "", ""]));
    expect(review.apply).toEqual([{ channel: 2, target: 1, axis: "y", side: "both" }]);
    expect(review.confirm.map((s) => [s.channel, s.target, s.confidence])).toEqual([[4, 3, "low"]]);
    expect(review.blocked).toEqual([]);
  });

  it("a unit match lifts the same position pairing to medium, so nothing is asked", () => {
    const review = reviewSeedErrorBindings(sheet(["R", "err"], ["counts", "counts"]));
    expect(review.apply).toEqual([{ channel: 1, target: 0, axis: "y", side: "both" }]);
    expect(review.confirm).toEqual([]);
  });

  it("the committed import-time roles are reviewed too, not just a fresh guess", () => {
    const committed = [{ channel: 1, target: 0, axis: "y" as const, side: "both" as const }];
    const review = reviewSeedErrorBindings(sheet(["R", "err"], ["", ""], { errorRoles: committed }));
    expect(review.apply).toEqual([]);
    expect(review.confirm.map((s) => s.channel)).toEqual([1]);
  });

  it("never auto-applies a blocked pairing, even one carried by the committed roles", () => {
    // A pre-unit-gate `.dwk` could still hold this label-only pairing.
    const committed = [{ channel: 1, target: 0, axis: "y" as const, side: "both" as const }];
    const review = reviewSeedErrorBindings(sheet(["M", "M_err"], ["emu", "K"], { errorRoles: committed }));
    expect(review.apply).toEqual([]);
    expect(review.confirm).toEqual([]);
    expect(review.blocked.map((s) => [s.channel, s.unit])).toEqual([[1, "mismatch"]]);
  });

  it("still names a blocked pairing the import-time unit gate already dropped", () => {
    const review = reviewSeedErrorBindings(sheet(["M", "M_err"], ["emu", "K"]));
    expect(review.apply).toEqual([]);
    expect(review.blocked.map((s) => [s.channel, s.target, s.confidence])).toEqual([[1, 0, "blocked"]]);
  });

  it("a deliberate binding the label rules never proposed is applied untouched", () => {
    const chosen = [{ channel: 0, target: 1, axis: "y" as const, side: "both" as const }];
    const review = reviewSeedErrorBindings(sheet(["A", "B"], ["", ""], { errorRoles: chosen }));
    expect(review.apply).toEqual(chosen);
    expect(review.confirm).toEqual([]);
  });

  it("an explicit `[]` answer stays none -- nothing is resurrected to ask about", () => {
    const review = reviewSeedErrorBindings(sheet(["R", "err"], ["", ""], { errorRoles: [] }));
    expect(review).toEqual({ apply: [], confirm: [], blocked: [] });
  });

  it("Origin column designations outrank the grade, exactly when originBookErrorRoles answers", () => {
    const shapes: Record<string, unknown>[] = [
      {},
      { origin_column_names: ["A", "B"] },
      { origin_column_names: ["A", "B"], column_designations: {} },
      { origin_column_names: ["A", "B"], column_designations: { A: "Y", B: "Y-error" } },
      { origin_column_names: ["A", "B"], column_designations: { A: "bogus" } },
    ];
    for (const metadata of shapes) {
      const data = { ...sheet(["R", "err"], ["", ""]).data, metadata };
      expect(declaresErrorRoles(data), JSON.stringify(metadata)).toBe(originBookErrorRoles(data) !== null);
    }
    const designated = sheet(["R", "err"], ["", ""], { errorRoles: [{ channel: 1, target: 0, axis: "y", side: "both" }] });
    designated.data.metadata = shapes[3];
    expect(reviewSeedErrorBindings(designated).confirm).toEqual([]);
  });

  it("a parser's declared roles outrank the grade and are applied without asking", () => {
    const declared = [{ channel: 1, target: 0, axis: "y", side: "both" }];
    const ds = sheet(["R", "err"], ["", ""], { errorRoles: declared as Dataset["errorRoles"] });
    ds.data.metadata = { error_roles: declared };
    const review = reviewSeedErrorBindings(ds);
    expect(review.apply).toEqual(declared);
    expect(review.confirm).toEqual([]);
  });
});
