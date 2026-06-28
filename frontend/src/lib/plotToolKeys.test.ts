import { describe, expect, it } from "vitest";

import { toolForKey } from "./plotToolKeys";

describe("toolForKey", () => {
  it("maps H/Z/D/M to the dock tools (case-insensitive)", () => {
    expect(toolForKey("z")).toBe("zoom");
    expect(toolForKey("Z")).toBe("zoom");
    expect(toolForKey("h")).toBe("pan");
    expect(toolForKey("d")).toBe("cursor");
    expect(toolForKey("M")).toBe("measure");
  });

  it("returns null for non-tool keys", () => {
    expect(toolForKey("p")).toBeNull(); // peaks is handled separately
    expect(toolForKey("x")).toBeNull();
    expect(toolForKey("Enter")).toBeNull();
  });
});
