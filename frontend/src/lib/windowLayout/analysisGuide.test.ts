// The Analysis guide's pure half (WORKSPACE_LAYOUT_PLAN P4): technique override
// and suggestions, step status from the result lifecycle, the next step, and
// the follow / pin resolver of the Analysis and tool windows.

import { describe, expect, it } from "vitest";

import type { AnalysisResult } from "../analysisResult";
import type { Dataset } from "../types";
import { effectiveTechnique, guideSteps, resultOutOfDate, techniqueSuggestions, TECHNIQUE_OVERRIDE_KEY, type GuideInput } from "./analysisGuide";
import { dock, emptyLayout, pruneRefs } from "./ops";
import { clearPin, FOLLOW_NO_PLOT, FOLLOW_PIN_GONE, pinOf, resolveFollow, setPin } from "./pins";

const ds = (over: Partial<Dataset> = {}, meta: Record<string, unknown> = {}, units = [""], labels = ["y"]): Dataset => ({
  id: "d1",
  name: "Sample",
  data: { time: [0, 1, 2], values: [[1], [2], [3]], labels, units, metadata: meta },
  ...over,
});

const result = (over: Partial<AnalysisResult> = {}): AnalysisResult => ({
  version: 1, id: "r1", name: "Fit", producer: { id: "curve-fit", label: "Curve Fit", version: 1 },
  sources: [{ datasetId: "d1", role: "input" }], outputs: [], warnings: [], createdAt: "2026-01-01T00:00:00Z", ...over,
});

const input = (over: Partial<GuideInput> = {}): GuideInput => {
  const dataset = over.dataset ?? ds();
  return { dataset, datasets: [dataset], inspected: false, staleDatasets: [], staleFits: [], results: [], figures: 0, reports: 0, ...over };
};
const statusOf = (i: GuideInput) => Object.fromEntries(guideSteps(i).map((s) => [s.id, s.status]));
const nextOf = (i: GuideInput) => guideSteps(i).filter((s) => s.next).map((s) => s.id);

describe("technique", () => {
  it("reads the import, then the user's override, and says which", () => {
    expect(effectiveTechnique(ds())).toEqual({ technique: "generic", source: "none" });
    expect(effectiveTechnique(ds({}, { technique: "xrd.powder" }))).toEqual({ technique: "xrd.powder", source: "import" });
    expect(effectiveTechnique(ds({}, { technique: "xrd.powder", [TECHNIQUE_OVERRIDE_KEY]: "spectroscopy" }))).toEqual({ technique: "spectroscopy", source: "override" });
    // An override that is not a known technique is ignored (fail closed to what was recorded).
    expect(effectiveTechnique(ds({}, { technique: "sims", [TECHNIQUE_OVERRIDE_KEY]: "alchemy" }))).toEqual({ technique: "sims", source: "import" });
  });

  it("suggests from the X axis and units only when nothing is recorded", () => {
    const mh = ds({}, { x_column_name: "Field", x_column_unit: "Oe" }, ["emu"]);
    expect(techniqueSuggestions(mh)[0]).toMatchObject({ technique: "magnetometry.mvsh" });
    const mt = ds({}, { x_column_name: "Temperature", x_column_unit: "K" }, ["emu"]);
    expect(techniqueSuggestions(mt)[0]).toMatchObject({ technique: "magnetometry.mvst" });
    expect(techniqueSuggestions(ds({}, { x_column_name: "2θ", x_column_unit: "deg" }))[0]).toMatchObject({ technique: "xrd.powder" });
    expect(techniqueSuggestions(ds({}, { x_column_name: "Field", x_column_unit: "Oe", technique: "transport" }, ["emu"]))).toEqual([]);
    expect(techniqueSuggestions(ds({}, { x_column_name: "Index" }))).toEqual([]);
  });
});

describe("guide steps", () => {
  it("a fresh dataset: nothing started, Inspect is next", () => {
    expect(statusOf(input())).toEqual({ inspect: "not-started", clean: "not-started", plot: "not-started", analyze: "not-started", report: "not-started" });
    expect(nextOf(input())).toEqual(["inspect"]);
  });

  it("each step turns done on its evidence and the next one moves on", () => {
    const dataset = ds({ excludedRows: [1] });
    const i = input({ dataset, inspected: true, figures: 1, results: [result()], reports: 1 });
    expect(statusOf(i)).toEqual({ inspect: "done", clean: "done", plot: "done", analyze: "done", report: "done" });
    expect(nextOf(i)).toEqual([]);
    expect(nextOf(input({ inspected: true, figures: 1 }))).toEqual(["clean"]);
  });

  it("an out-of-date result marks Analyze and its report out of date, and Analyze is next", () => {
    const i = input({ inspected: true, dataset: ds({ excludedRows: [0] }), figures: 1, reports: 1, results: [result({ stale: true })] });
    expect(statusOf(i)).toMatchObject({ analyze: "out-of-date", report: "out-of-date" });
    expect(nextOf(i)).toEqual(["analyze"]);
  });

  it("a linked output in the stale list and a stale fit are out of date; a derived sheet whose source changed is", () => {
    const linked = result({ outputs: [{ datasetId: "out", role: "linked-worksheet" }] });
    expect(resultOutOfDate(linked, [], ["out"])).toBe(true);
    expect(resultOutOfDate(linked, [], [])).toBe(false);
    expect(statusOf(input({ dataset: ds({ fitSpec: { model: "Linear" } as Dataset["fitSpec"] }), staleFits: ["d1"] })).analyze).toBe("out-of-date");
    expect(statusOf(input({ dataset: ds({ derivedFrom: { datasetId: "src", pipeline: "x" } }), staleDatasets: ["d1"] })).clean).toBe("out-of-date");
  });
});

describe("follow and pin", () => {
  const live = [{ id: "a" }, { id: "b" }];
  it("follows the focused plot, a pin wins, and a pin to a removed dataset fails closed", () => {
    expect(resolveFollow(null, live, "a")).toEqual({ kind: "dataset", mode: "plot", datasetId: "a" });
    expect(resolveFollow("b", live, "a")).toEqual({ kind: "dataset", mode: "pinned", datasetId: "b" });
    expect(resolveFollow("gone", live, "a")).toEqual({ kind: "missing", mode: "pinned", pinned: "gone", reason: FOLLOW_PIN_GONE });
    expect(resolveFollow(null, live, null)).toEqual({ kind: "none", mode: "plot", reason: FOLLOW_NO_PLOT });
  });

  it("setPin / clearPin are pure and a no-op returns the same layout", () => {
    const l = emptyLayout();
    const pinned = setPin(l, "tool:curvefit", "a");
    expect(pinOf(pinned, "tool:curvefit")).toBe("a");
    expect(pinOf(l, "tool:curvefit")).toBeNull();
    expect(setPin(pinned, "tool:curvefit", "a")).toBe(pinned);
    expect(pinOf(clearPin(pinned, "tool:curvefit"), "tool:curvefit")).toBeNull();
    expect(clearPin(l, "analysis")).toBe(l);
  });

  it("forgetting a window forgets its pin", () => {
    const l = setPin(setPin(dock(dock(emptyLayout(), "tool:gone", "bottom"), "tool:curvefit", "bottom"), "tool:gone", "a"), "tool:curvefit", "b");
    const pruned = pruneRefs(l, (r) => r !== "tool:gone");
    expect(pruned.placements["tool:gone"]).toBeUndefined();
    expect(pruned.pins).toEqual({ "tool:curvefit": "b" });
  });
});
