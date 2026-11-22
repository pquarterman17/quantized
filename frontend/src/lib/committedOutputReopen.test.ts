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

function result(producerId: string, opts: { reopen?: boolean; sources?: Dataset[] } = {}): AnalysisResult {
  const producer = { id: producerId, label: producerId, version: 1 };
  const computedOn = analysisDataFingerprint(SOURCE);
  const settings = { xCol: -1, yCol: 0 };
  const [source, ...extraSources] = opts.sources ?? [SOURCE];
  return committedOutputResult({
    id: "r1", producer, source: source!, extraSources, output: OUTPUT,
    key: committedOutputKey(producerId, "src", computedOn, settings), settings,
    ...(opts.reopen === false ? {} : { reopen: { computedOn, output: analysisDataFingerprint(OUTPUT) } }),
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
    ["peak-batch", "several worksheets"],
    ["peak-batch-integrate", "several worksheets"],
    ["fit-band", "live Curve Fit"],
    ["fft-thickness", "cannot reopen in their tool yet"],
    ["spin-asymmetry", "two worksheets"],
    ["mag-normalization", "not recorded as reopenable settings"],
    ["mag-demag", "not recorded as reopenable settings"],
    ["curie-weiss", "not recorded as reopenable settings"],
  ])("disables %s with the reason", (producer, reason) => {
    const plan = planReopen(result(producer), [SOURCE, OUTPUT]);
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.reason).toContain(reason);
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
