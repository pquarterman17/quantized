import { describe, expect, it } from "vitest";

import { sanitizeTransformProvenance, transformProvenanceOfDataset } from "./transformProvenance";
import type { Dataset } from "./types";

describe("transform provenance", () => {
  it("sanitizes current recipe provenance without trusting arbitrary metadata", () => {
    expect(sanitizeTransformProvenance({
      recipe: " Normalize ", revision: 3,
      input: { id: "raw", name: "raw.dat", ignored: true },
      bindings: [{ column: "Signal", from: "Counts" }, { column: 42 }],
      steps: 4, appliedAt: "2026-10-03T12:00:00.000Z",
    })).toEqual({
      recipe: "Normalize", revision: 3,
      input: { id: "raw", name: "raw.dat" },
      bindings: [{ column: "Signal", from: "Counts" }],
      bindingsTruncated: false,
      steps: 4, appliedAt: "2026-10-03T12:00:00.000Z",
    });
  });

  it("caps untrusted bindings and preserves that disclosure on a stored round trip", () => {
    const sanitized = sanitizeTransformProvenance({
      recipe: "Wide table",
      bindings: Array.from({ length: 513 }, (_, index) => ({
        column: `column-${index}`,
        from: `source-${index}`,
      })),
    });

    expect(sanitized?.bindings).toHaveLength(512);
    expect(sanitized?.bindingsTruncated).toBe(true);
    expect(sanitizeTransformProvenance(structuredClone(sanitized))?.bindingsTruncated).toBe(true);
  });

  it("accepts legacy name-only provenance but rejects a non-string recipe", () => {
    expect(sanitizeTransformProvenance({ recipe: "Legacy" })).toMatchObject({
      recipe: "Legacy", revision: 1, input: null, bindings: [], steps: null, appliedAt: null,
    });
    expect(sanitizeTransformProvenance({ recipe: 42 })).toBeNull();
  });

  it("reads only the dataset's own metadata", () => {
    const dataset = {
      id: "out", name: "out",
      data: { time: [0], values: [[1]], labels: ["y"], units: [""], metadata: { transform_recipe: { recipe: "R", revision: 2 } } },
    } as Dataset;
    expect(transformProvenanceOfDataset(dataset)?.recipe).toBe("R");
    expect(transformProvenanceOfDataset({ ...dataset, data: { ...dataset.data, metadata: {} } })).toBeNull();
  });
});
