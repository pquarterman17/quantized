import { describe, expect, it } from "vitest";

import { pctRange, STATE_LEVEL_HELP } from "./stateLevelHelp";

describe("stateLevelHelp", () => {
  it("states the percentages as a range, for 10-90 and 20-80", () => {
    expect(pctRange(0.1, 0.9)).toBe("10–90 %");
    expect(pctRange(0.2, 0.8)).toBe("20–80 %");
    expect(pctRange(0.125, 0.875)).toBe("12.5–87.5 %");
  });
  it("cites the method and says when it refuses", () => {
    expect(STATE_LEVEL_HELP).toContain("IEEE Std 181-2011");
    expect(STATE_LEVEL_HELP).toContain("refused with a reason");
  });
});
