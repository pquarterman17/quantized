import { describe, expect, it } from "vitest";

import { limFieldDisplay, limFieldUnchanged } from "./axisLimFields";

describe("limFieldDisplay / limFieldUnchanged (UX audit 10 P2-11)", () => {
  it("rounds to 6 significant digits and treats its own text as untouched", () => {
    const lim: [number, number] = [2.003183412, 299.9034567];
    expect(limFieldDisplay(lim, 0)).toBe("2.00318");
    expect(limFieldDisplay(lim, 1)).toBe("299.903");
    expect(limFieldDisplay(null, 0)).toBe("");
    expect(limFieldUnchanged(lim, "2.00318", "299.903")).toBe(true);
    expect(limFieldUnchanged(lim, "2", "299.903")).toBe(false);
  });
});
