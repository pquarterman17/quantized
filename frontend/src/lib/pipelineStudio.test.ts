import { describe, expect, it } from "vitest";

import { makeStep } from "./pipelineStep";
import { analyzePipeline, pipelineEditImpact } from "./pipelineStudio";
import type { Dataset } from "./types";

const dataset = (id = "d1"): Dataset => ({
  id, name: id,
  data: { time: [0, 1], values: [[1, 2], [3, 4]], labels: ["A", "B"], units: ["", ""], metadata: {} },
} as Dataset);

describe("analyzePipeline", () => {
  it("distinguishes runnable, display-only, and broken steps before execution", () => {
    const steps = [
      makeStep("ui", "Log Y", "qz.log()"),
      makeStep("expression", "Good", "qz.add()", { name: "ratio", expr: "A / B" }),
      makeStep("expression", "Bad", "qz.add()", { name: "bad", expr: "Q + 1" }),
    ];
    const review = analyzePipeline(steps, dataset(), [dataset()]);
    expect(review).toMatchObject({ runnable: 1, displayOnly: 1, invalid: 1, canRun: false });
    expect(review.steps[0].state).toBe("display_only");
    expect(review.steps[2]).toMatchObject({ state: "invalid", issue: 'unknown variable "Q"' });
  });

  it("fails closed for missing referenced datasets but accepts outputs produced earlier", () => {
    const first = makeStep("transform", "Split", "qz.split()", {
      op: "split", col: 0, outputs: [{ id: "child", name: "child", key: "one" }],
    });
    const usesOutput = makeStep("transform", "Math", "qz.math()", {
      op: "algebra", operation: "A+B", interp: "linear", with: { id: "child", name: "child" },
    });
    const missing = makeStep("transform", "Missing", "qz.math()", {
      op: "algebra", operation: "A+B", interp: "linear", with: { id: "gone", name: "deleted sheet" },
    });
    const review = analyzePipeline([first, usesOutput, missing], dataset(), [dataset()]);
    expect(review.steps.map((step) => step.state)).toEqual(["ready", "ready", "invalid"]);
    expect(review.steps[2].issue).toContain("deleted sheet");
  });

  it("does not treat a recorded transform output as a loaded correction background", () => {
    const first = makeStep("transform", "Split", "qz.split()", {
      op: "split", col: 0, outputs: [{ id: "child", name: "child", key: "one" }],
    });
    const correction = makeStep("correction", "Subtract background", "qz.correct()", {
      params: {}, bg: { datasetId: "child", interp: "linear" },
    });
    const review = analyzePipeline([first, correction], dataset(), [dataset()]);
    expect(review.steps[1]).toMatchObject({ state: "invalid" });
    expect(review.steps[1].issue).toContain("not loaded");
  });

  it("shows downstream blocking from a disabled transform", () => {
    const transform = { ...makeStep("transform", "Stack", "qz.stack()", { op: "stack", channels: [0] }), enabled: false };
    const fit = makeStep("fit", "Fit", "qz.fit()", { model: "Linear" });
    const review = analyzePipeline([transform, fit], dataset(), [dataset()]);
    expect(review.steps.map((step) => step.state)).toEqual(["disabled", "blocked"]);
    expect(review.blocked).toBe(1);
    expect(review.canRun).toBe(true);
  });

  it("surfaces malformed transform settings and stale column indices", () => {
    const malformed = makeStep("transform", "Stack", "qz.stack()", { op: "stack", channels: [] });
    const stale = makeStep("transform", "Split", "qz.split()", { op: "split", col: 4, tolerance: null });
    expect(analyzePipeline([malformed], dataset(), [dataset()]).steps[0]).toMatchObject({ state: "invalid" });
    expect(analyzePipeline([stale], dataset(), [dataset()]).steps[0]).toMatchObject({
      state: "invalid", issue: "Column 5 is not available in this step's input.",
    });
    const xKey = makeStep("transform", "Unstack", "qz.unstack()", {
      op: "unstack", key: -1, category: 0, value: 1, aggregate: "mean",
    });
    expect(analyzePipeline([xKey], dataset(), [dataset()]).steps[0].state).toBe("ready");
  });

  it("does not compare a post-transform expression with the original schema", () => {
    const transpose = makeStep("transform", "Transpose", "qz.transpose()", { op: "transpose" });
    const expression = makeStep("expression", "New expression", "qz.add()", { name: "value", expr: "Q + 1" });
    const review = analyzePipeline([transpose, expression], dataset(), [dataset()]);
    expect(review.steps.map((step) => step.state)).toEqual(["ready", "ready"]);
  });

  it("explains the executor's fit fallbacks without blocking a recoverable run", () => {
    const fit = makeStep("fit", "Fit", "qz.fit()", {
      model: "Linear", yKey: 8, xKey: 7, weight: { mode: "yerr", errKey: 6 },
    });
    const review = analyzePipeline([fit], dataset(), [dataset()]);
    expect(review.steps[0]).toMatchObject({
      state: "ready",
      issue: "Recorded Y column 9 is missing; the run will use the current plotted selection.",
    });
    expect(review.canRun).toBe(true);
  });
});

describe("pipelineEditImpact", () => {
  it("previews downstream risk for structural removal and reordering", () => {
    const steps = [
      makeStep("transform", "Stack", "qz.stack()", { op: "stack", channels: [0] }),
      makeStep("fit", "Fit", "qz.fit()", { model: "Linear" }),
    ];
    expect(pipelineEditImpact(steps, steps[0].id, "remove")).toMatchObject({ requiresConfirmation: true });
    expect(pipelineEditImpact(steps, steps[0].id, "remove").detail).toContain("1 later enabled step");
    expect(pipelineEditImpact(steps, steps[0].id, "move_down")).toMatchObject({ requiresConfirmation: true });
  });
});
