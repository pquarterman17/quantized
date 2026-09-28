// Cross-language parity for UNIT evidence in error-column pairing: this file
// and tests/test_error_unit_evidence_parity_fixture.py both read the
// hand-curated tests/fixtures/error_labels/unit_evidence_corpus.json (its
// `_about` explains how it is maintained). A failure here means TypeScript and
// src/quantized/io/error_unit_evidence.py DISAGREE -- make them agree; never
// edit an expected value to hide it.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { inferErrorBindings, type ErrorBinding } from "./errorRoles";
import { compareUnits, normalizeUnit, type UnitEvidence } from "./errorUnitEvidence";

const here = dirname(fileURLToPath(import.meta.url));
// frontend/src/lib -> repo root is three levels up.
const FIXTURE_PATH = join(here, "../../../tests/fixtures/error_labels/unit_evidence_corpus.json");

interface UnitCase {
  note: string;
  error: string | null;
  value: string | null;
  normalized: [string | null, string | null];
  verdict: UnitEvidence;
}

interface PairingCase {
  note: string;
  labels: string[];
  units: string[];
  metadata: Record<string, unknown>;
  bindings: ErrorBinding[];
}

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")) as {
  cases: UnitCase[];
  unitless: string[];
  pairings: PairingCase[];
};

describe("unit evidence parity fixture (shared with the Python)", () => {
  it("covers all three verdicts", () => {
    expect(new Set(fixture.cases.map((c) => c.verdict))).toEqual(new Set(["match", "mismatch", "unknown"]));
  });

  it.each(fixture.cases.map((c) => [c.note, c] as const))("%s", (_note, c) => {
    expect([normalizeUnit(c.error), normalizeUnit(c.value)]).toEqual(c.normalized);
    expect(compareUnits(c.error, c.value)).toBe(c.verdict);
  });

  it("normalises every one of Python's _UNITLESS spellings to null", () => {
    expect(fixture.unitless.length).toBe(25);
    for (const spelling of fixture.unitless) expect(normalizeUnit(spelling), spelling).toBeNull();
  });

  it.each(fixture.pairings.map((p) => [p.note, p] as const))("inferErrorBindings: %s", (_note, p) => {
    const data = { time: [0], values: [p.labels.map(() => 0)], labels: p.labels, units: p.units, metadata: p.metadata };
    expect(inferErrorBindings(data)).toEqual(p.bindings);
  });
});

describe("compareUnits outside the fixture's string inputs", () => {
  it("treats a missing or non-string unit as unknown, never a mismatch", () => {
    expect(compareUnits(undefined, "K")).toBe("unknown");
    expect(compareUnits(3, "K")).toBe("unknown");
    expect(normalizeUnit({})).toBeNull();
  });

  it("a DataStruct with fewer units than labels treats the missing ones as unknown", () => {
    const data = { time: [0], values: [[0, 0]], labels: ["M", "M_err"], units: ["emu"], metadata: {} };
    expect(inferErrorBindings(data)).toEqual([{ channel: 1, target: 0, axis: "y", side: "both" }]);
  });
});
