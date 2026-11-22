// An A,B,C sheet imports A as the X column: the ternary defaults read A, B, C.

import { describe, expect, it } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { compositionPicks, defaultPicks } from "./auxColumns";

const sheet = (labels: string[]): DataStruct => ({
  time: [0, 1], values: [labels.map(() => 1), labels.map(() => 2)], labels, units: labels.map(() => ""), metadata: {},
});

describe("compositionPicks", () => {
  it("an A,B,C sheet (X = A, channels B, C) picks A, B, C", () => {
    expect(compositionPicks(sheet(["B", "C"]), 3)).toEqual([-1, 0, 1]);
  });
  it("three or more channels keep the channel-first default", () => {
    expect(compositionPicks(sheet(["a", "b", "c"]), 3)).toEqual(defaultPicks(sheet(["a", "b", "c"]), 3));
  });
});
