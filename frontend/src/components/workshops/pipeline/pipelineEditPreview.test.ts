import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeStep } from "../../../lib/pipelineStep";
import type { Dataset } from "../../../lib/types";
import { PIPELINE_PREVIEW_ROWS, previewPipelineEdit } from "./pipelineEditPreview";

const { correctionMock } = vi.hoisted(() => ({ correctionMock: vi.fn() }));

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  applyCorrections: correctionMock,
}));

function dataset(id = "d1", rows = 3): Dataset {
  return {
    id,
    name: id,
    data: {
      time: Array.from({ length: rows }, (_, index) => index + 1),
      values: Array.from({ length: rows }, (_, index) => [index + 10, index + 20]),
      labels: ["A", "B"],
      units: ["", ""],
      metadata: {},
    },
  };
}

describe("previewPipelineEdit", () => {
  beforeEach(() => correctionMock.mockReset());

  it("computes an expression on bounded clones without changing the project dataset", async () => {
    const active = dataset("large", 100);
    const before = structuredClone(active);
    const steps = [makeStep("expression", "Sum", "qz.add()", { name: "sum", expr: "A + B" })];

    const preview = await previewPipelineEdit(steps, active, [active]);

    expect(preview).toMatchObject({ status: "ready", canCommit: true, capped: true });
    expect(preview.output?.labels).toEqual(["A", "B", "sum"]);
    expect(preview.output?.rows).toBe(PIPELINE_PREVIEW_ROWS);
    expect(preview.output?.sample[0]).toEqual([1, 10, 20, 30]);
    expect(active).toEqual(before);
  });

  it("does not call a unit-incompatible proposed recipe previewable", async () => {
    const active = dataset();
    active.data.units = ["K", "s"];
    const steps = [makeStep("expression", "Bad units", "qz.add()", {
      name: "bad", expr: "A + B", derived: true,
    })];

    const preview = await previewPipelineEdit(steps, active, [active]);

    expect(preview).toMatchObject({ status: "blocked", canCommit: false, output: { labels: ["A", "B"] } });
    expect(preview.warnings.join(" ")).toContain("units differ");
  });

  it("refuses to pretend a lazy active worksheet's thumbnail is full data", async () => {
    const active = dataset();
    active.pending = { kind: "path", path: "scan.opju", bookId: "book", rows: 1_000, cols: 2 };

    const preview = await previewPipelineEdit([], active, [active]);

    expect(preview).toMatchObject({ status: "unavailable", canCommit: true, input: null, output: null });
    expect(preview.warnings.join(" ")).toContain("Full data is not loaded");
  });

  it("does not use a referenced worksheet's lazy thumbnail as transform input", async () => {
    const active = dataset("active");
    const other = dataset("other");
    other.pending = { kind: "path", path: "scan.opju", bookId: "other-book", rows: 500, cols: 2 };
    const steps = [makeStep("transform", "Math", "qz.math()", {
      op: "algebra", operation: "A+B", interp: "linear", with: { id: "other", name: "lazy other" },
    })];

    const preview = await previewPipelineEdit(steps, active, [active, other]);

    expect(preview).toMatchObject({ status: "unavailable", canCommit: true });
    expect(preview.warnings.join(" ")).toContain("has not loaded its full data");
  });

  it("does not mark a small active preview capped because an unrelated worksheet is large", async () => {
    const active = dataset("active");
    const unrelated = dataset("unrelated", 500);

    const preview = await previewPipelineEdit([], active, [active, unrelated]);

    expect(preview).toMatchObject({ status: "ready", capped: false });
  });

  it("previews transforms numerically on the bounded copy", async () => {
    const active = dataset("active");
    const before = structuredClone(active);
    const steps = [makeStep("transform", "Stack", "qz.stack()", { op: "stack", channels: [0, 1] })];

    const preview = await previewPipelineEdit(steps, active, [active]);

    expect(preview).toMatchObject({ status: "ready", canCommit: true });
    expect(preview.output?.rows).toBe(6);
    expect(preview.output?.labels).toEqual(["Source channel", "Value"]);
    expect(active).toEqual(before);
  });

  it("lets transform warning analysis inspect full source rows while bounding its output", async () => {
    const active = dataset("active", 200);
    const other = dataset("other", 200);
    // The first twenty keys are unique. Duplicates exist only beyond the
    // pipeline preview's row cap and would be missed if we passed a pre-cut
    // dataset into computeTransformPreview.
    active.data.values = active.data.values.map((row, index) => [index < 20 ? index : 19, row[1]]);
    other.data.values = other.data.values.map((row, index) => [index < 20 ? index : 19, row[1]]);
    const steps = [makeStep("transform", "Join", "qz.join()", {
      op: "join", leftKey: 0, rightKey: 0, mode: "inner", keyMode: "text",
      with: { id: other.id, name: other.name },
    })];

    const preview = await previewPipelineEdit(steps, active, [active, other]);

    expect(preview).toMatchObject({ status: "ready", canCommit: true, capped: true });
    expect(preview.output?.rows).toBeLessThanOrEqual(PIPELINE_PREVIEW_ROWS);
    expect(preview.warnings.join(" ")).toContain("repeat an earlier key");
  });

  it("caps correction inputs, includes a used large background in the disclaimer, and never commits", async () => {
    const active = dataset("active", 100);
    const background = dataset("background", 200);
    const before = structuredClone([active, background]);
    correctionMock.mockImplementation(async (request?: { dataset: Dataset["data"] }) => (
      request ? structuredClone(request.dataset) : dataset("unexpected-empty-request").data
    ));
    const steps = [makeStep("correction", "Correct", "qz.correct()", {
      params: { scale: 2 }, bg: { datasetId: "background", interp: "linear" },
    })];

    const preview = await previewPipelineEdit(steps, active, [active, background]);

    expect(preview).toMatchObject({ status: "ready", capped: true, canCommit: true });
    expect(correctionMock).toHaveBeenCalledOnce();
    const request = correctionMock.mock.calls[0][0] as { dataset: Dataset["data"]; bg_dataset: Dataset["data"] };
    expect(request.dataset.time).toHaveLength(PIPELINE_PREVIEW_ROWS);
    expect(request.bg_dataset.time).toHaveLength(PIPELINE_PREVIEW_ROWS);
    expect([active, background]).toEqual(before);
  });

  it("bounds both sides of malformed unequal row arrays", async () => {
    const active = dataset("unequal", 100);
    active.data.time = [1, 2];

    const preview = await previewPipelineEdit([], active, [active]);

    expect(preview.output?.rows).toBe(2);
    expect(preview.capped).toBe(true);
  });
});
