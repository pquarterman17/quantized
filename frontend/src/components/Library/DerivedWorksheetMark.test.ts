// 2026-09 review finding 4: `metadata.sims_source` is carried forward by
// every later transform's metadata spread (a sims -> resample chain's
// resample OUTPUT still has the ORIGINAL raw profile's `sims_source`), so
// `derivedSource` must check the provenance is for THIS dataset —
// `worksheet_transform` (stamped on every transform commit,
// `lib/transformWarnings.ts`'s `stampWarnings`) is always the op that most
// recently produced this exact dataset.

import { describe, expect, it } from "vitest";

import { derivedSource } from "./DerivedWorksheetMark";
import type { Dataset } from "../../lib/types";

const EMPTY = { time: [], values: [], labels: [], units: [], metadata: {} };

function ds(id: string, metadata: Record<string, unknown>): Dataset {
  return { id, name: `${id}.dat`, data: { ...EMPTY, metadata } };
}

describe("derivedSource", () => {
  it("marks the DIRECT SIMS output of the raw profile", () => {
    const simsOut = ds("b", { sims_source: { id: "a", name: "raw.dat" }, worksheet_transform: "sims" });
    expect(derivedSource(simsOut)).toEqual({ datasetId: "a", pipeline: "SIMS processing" });
  });

  it("does NOT mark a resample of the sims output as itself a direct SIMS output", () => {
    // The resample's OWN metadata spread (lib/transformResample.ts's
    // computeResample) carries the sims dataset's `sims_source` forward
    // unchanged; only `worksheet_transform` is overwritten, to "resample".
    const resampleOfSims = ds("c", {
      sims_source: { id: "a", name: "raw.dat" }, // leaked forward from "b"
      worksheet_transform: "resample",
      resample_of: "b.dat",
    });
    expect(derivedSource(resampleOfSims)).toBeNull();
  });

  it("an ordinary dataset (no provenance at all) is not marked", () => {
    expect(derivedSource(ds("a", {}))).toBeNull();
  });

  it("still prefers derivedFrom, and still reads the reflFit provenance", () => {
    const viaDerivedFrom: Dataset = { ...ds("x", {}), derivedFrom: { datasetId: "a", pipeline: "flatten" } };
    expect(derivedSource(viaDerivedFrom)).toEqual({ datasetId: "a", pipeline: "flatten" });
    const fit = ds("y", { reflFit: { sourceIds: ["a"], seq: 2 } });
    expect(derivedSource(fit)).toEqual({ datasetId: "a", pipeline: "reflectivity fit #2" });
  });
});
