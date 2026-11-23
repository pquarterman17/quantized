import { describe, expect, it } from "vitest";

import { sanitizeAnalysisResults } from "./analysisResult";
import { committedOutputResult } from "./committedOutput";
import { MAX_RECORDED_CHANNELS, MAX_RECORDED_INPUTS, INPUTS_PARAM } from "./resultInputsRecord";
import type { Dataset } from "./types";

const wide = (id: string, channels: number): Dataset => ({
  id, name: id,
  data: {
    time: [0, 1, 2], values: [0, 1, 2].map(() => Array.from({ length: channels }, (_, i) => i)),
    labels: Array.from({ length: channels }, (_, i) => `c${i}`), units: Array.from({ length: channels }, () => "u"), metadata: {},
  },
});

describe("recorded inputs stay inside the reopen sanitizer's budget", () => {
  it("a 600-source batch of 40-channel worksheets keeps its commit key and inputs after a save/reopen", () => {
    const sources = Array.from({ length: 600 }, (_, i) => wide(`s${i}`, 40));
    const result = committedOutputResult({
      id: "r", producer: { id: "p", label: "P", version: 1 }, source: sources[0]!, extraSources: sources.slice(1),
      output: wide("out", 1), key: "k", settings: { a: 1 },
    });
    const inputs = result.parameters![INPUTS_PARAM] as { total: number; items: unknown[] };
    expect(inputs.total).toBe(600);
    expect(inputs.items).toHaveLength(MAX_RECORDED_INPUTS);
    const [reopened] = sanitizeAnalysisResults(JSON.parse(JSON.stringify([result])));
    expect(reopened?.parameters?.["commitKey"]).toBe("k");
    expect(reopened?.parameters?.[INPUTS_PARAM]).toBeDefined();
  });

  it("caps channels per input but records the true count", () => {
    const result = committedOutputResult({
      id: "r", producer: { id: "p", label: "P", version: 1 }, source: wide("s", 500), output: wide("o", 1), key: "k", settings: {},
    });
    const [item] = (result.parameters![INPUTS_PARAM] as { items: { channels: unknown[]; channelCount: number }[] }).items;
    expect(item!.channels).toHaveLength(MAX_RECORDED_CHANNELS);
    expect(item!.channelCount).toBe(500);
  });
});
