// Lane RO: which committed results reopen in their tool, and what the tool is
// told when the recorded source is missing or changed (fail closed).
import { describe, expect, it } from "vitest";

import type { AnalysisResult } from "./analysisResult";
import { analysisDataFingerprint } from "./analysisResultFreshness";
import { committedOutputKey, committedOutputResult } from "./committedOutput";
import { planReopen, recordedComputedOn } from "./committedOutputReopen";
import type { Dataset, DataStruct } from "./types";

const data = (values: number[]): DataStruct => ({
  time: values.map((_, i) => i), values: values.map((v) => [v]), labels: ["y"], units: [""], metadata: {},
});
const SOURCE: Dataset = { id: "src", name: "Film", data: data([1, 2, 3]) };
const OUTPUT: Dataset = { id: "out", name: "Film (fit)", data: data([9, 9, 9]) };
const OTHER: Dataset = { id: "oth", name: "Film B", data: data([4, 5, 6]) };

function result(producerId: string, opts: { reopen?: boolean; sources?: Dataset[]; alsoFrom?: boolean } = {}): AnalysisResult {
  const producer = { id: producerId, label: producerId, version: 1 };
  const computedOn = analysisDataFingerprint(SOURCE);
  const settings = { xCol: -1, yCol: 0 };
  const [source, ...extraSources] = opts.sources ?? [SOURCE];
  return committedOutputResult({
    id: "r1", producer, source: source!, extraSources, output: OUTPUT,
    key: committedOutputKey(producerId, "src", computedOn, settings), settings,
    ...(opts.reopen === false ? {} : {
      reopen: {
        computedOn, output: analysisDataFingerprint(OUTPUT),
        ...(opts.alsoFrom === false ? {} : { alsoFrom: extraSources.map((d) => ({ id: d.id, computedOn: analysisDataFingerprint(d) })) }),
      },
    }),
  });
}

describe("planReopen", () => {
  it("reopens a supported tool on the recorded source with the recorded settings", () => {
    const plan = planReopen(result("ellipse-fit"), [SOURCE, OUTPUT]);
    expect(plan).toMatchObject({
      ok: true, label: "Open in Ellipse fit", tool: "ellipse-fit", sourceId: "src",
      seed: { xCol: -1, yCol: 0 }, notice: null, replaceBlocked: null, outputName: "Film (fit)",
    });
  });

  it.each([
    ["fit-band", "covariance, free-parameter count, weights and fit range"],
    ["fft-thickness", "cannot reopen in their tool yet"],
    ["mag-normalization", "not recorded as reopenable settings"],
    ["mag-demag", "not recorded as reopenable settings"],
    ["curie-weiss", "not recorded as reopenable settings"],
  ])("disables %s with the reason", (producer, reason) => {
    const plan = planReopen(result(producer), [SOURCE, OUTPUT]);
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.reason).toContain(reason);
  });

  it("a single-source tool refuses a result with several sources", () => {
    const plan = planReopen(result("tabulate", { sources: [SOURCE, OTHER] }), [SOURCE, OTHER, OUTPUT]);
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.reason).toContain("one source worksheet only");
  });

  it("a missing source opens the tool WITHOUT the settings, with a notice, and cannot replace", () => {
    const plan = planReopen(result("tabulate"), [OUTPUT]);
    expect(plan).toMatchObject({ ok: true, sourceId: null, seed: null, replaceBlocked: "The source worksheet is missing." });
    expect(plan.ok && plan.notice).toContain("no longer exists");
  });

  it("a changed source keeps the settings but says to re-run on the current data", () => {
    const changed = { ...SOURCE, data: data([1, 2, 4]) };
    const plan = planReopen(result("optical-gap"), [changed, OUTPUT]);
    expect(plan).toMatchObject({ ok: true, sourceId: "src", seed: { xCol: -1, yCol: 0 } });
    expect(plan.ok && plan.notice).toContain("changed after this result was computed");
  });

  it("an edited output cannot be replaced, only added as new", () => {
    const edited = { ...OUTPUT, data: data([9, 0, 9]) };
    const plan = planReopen(result("surface-fit"), [SOURCE, edited]);
    expect(plan.ok && plan.replaceBlocked).toContain("was edited after it was added");
  });

  it("a result committed before reopen support still reopens; its output is kept (Add as new)", () => {
    const old = result("baseline-subtract", { reopen: false });
    expect(recordedComputedOn(old)).toBe(analysisDataFingerprint(SOURCE)); // read back from the key
    const plan = planReopen(old, [SOURCE, OUTPUT]);
    expect(plan).toMatchObject({ ok: true, notice: null });
    expect(plan.ok && plan.replaceBlocked).toContain("added before its output could be checked");
  });
});

describe("planReopen for a multi-source output (lane RO2)", () => {
  const multi = (producer: string, alsoFrom = true) => result(producer, { sources: [SOURCE, OTHER], alsoFrom });

  it.each(["peak-batch", "peak-batch-integrate", "spin-asymmetry"])("%s reopens on ALL recorded sources", (producer) => {
    const plan = planReopen(multi(producer), [SOURCE, OTHER, OUTPUT]);
    expect(plan).toMatchObject({ ok: true, sourceId: "src", sourceIds: ["src", "oth"], notice: null, replaceBlocked: null, seed: { xCol: -1, yCol: 0 } });
  });

  it("a missing further source fails closed: no settings, no replace, a notice with the count", () => {
    const plan = planReopen(multi("peak-batch"), [SOURCE, OUTPUT]);
    expect(plan).toMatchObject({ ok: true, sourceId: null, seed: null, sourceIds: ["src", "oth"], replaceBlocked: "A source worksheet is missing." });
    expect(plan.ok && plan.notice).toContain("1 of the 2 recorded source worksheets (oth) no longer exist");
  });

  it("a changed further source keeps the settings and names that source only", () => {
    const changed = { ...OTHER, data: data([4, 5, 7]) };
    const plan = planReopen(multi("peak-batch-integrate"), [SOURCE, changed, OUTPUT]);
    expect(plan).toMatchObject({ ok: true, sourceId: "src", seed: { xCol: -1 } });
    expect(plan.ok && plan.notice).toContain("“Film B” changed after this result was computed");
    expect(plan.ok && plan.notice).not.toContain("“Film” changed");
  });

  it("both changed: both are named", () => {
    const plan = planReopen(multi("spin-asymmetry"), [{ ...SOURCE, data: data([0, 0, 0]) }, { ...OTHER, data: data([1, 1, 1]) }, OUTPUT]);
    expect(plan.ok && plan.notice).toContain("“Film” changed");
    expect(plan.ok && plan.notice).toContain("“Film B” changed");
  });

  it("a further source that cannot be checked (no record) is said so, never assumed current", () => {
    const plan = planReopen(multi("peak-batch", false), [SOURCE, OTHER, OUTPUT]);
    expect(plan.ok && plan.notice).toContain("“Film B” cannot be checked against this result");
  });

  it("a further source still loading is said so", () => {
    const plan = planReopen(multi("peak-batch"), [SOURCE, { ...OTHER, pending: { kind: "path" as const, path: "/r.opj", bookId: "B", rows: 3, cols: 1 } }, OUTPUT]);
    expect(plan.ok && plan.notice).toContain("“Film B” is still loading");
  });
});
