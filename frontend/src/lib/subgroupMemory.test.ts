import { describe, expect, it } from "vitest";

import { rememberSubgroup, varyToggled } from "./subgroupMemory";

describe("the subgroup size across the Vary dash & marker switch", () => {
  it("comes back when the switch goes on again, and is forgotten once cleared", () => {
    rememberSubgroup(null);
    expect(varyToggled(true, false)).toBe(false);
    expect(varyToggled(false, true)).toBe(true); // no size was set
    expect(varyToggled(4, false)).toBe(false);
    expect(varyToggled(false, true)).toBe(4);
    rememberSubgroup(null);
    expect(varyToggled(false, true)).toBe(true);
    rememberSubgroup(3);
    expect(varyToggled(false, true)).toBe(3);
  });
});
