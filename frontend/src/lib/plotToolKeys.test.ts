import { describe, expect, it } from "vitest";

import { keyForTool, toolForKey } from "./plotToolKeys";

describe("toolForKey", () => {
  it("maps H/Z/D/M/I/W to the dock tools (case-insensitive)", () => {
    expect(toolForKey("z")).toBe("zoom");
    expect(toolForKey("Z")).toBe("zoom");
    expect(toolForKey("h")).toBe("pan");
    expect(toolForKey("d")).toBe("cursor");
    expect(toolForKey("M")).toBe("measure");
    expect(toolForKey("i")).toBe("integ");
    expect(toolForKey("I")).toBe("integ");
    expect(toolForKey("w")).toBe("fwhm");
    expect(toolForKey("W")).toBe("fwhm");
  });

  it("returns null for non-tool keys", () => {
    expect(toolForKey("p")).toBeNull(); // peaks is handled separately
    expect(toolForKey("x")).toBeNull();
    expect(toolForKey("Enter")).toBeNull();
  });
});

describe("keyForTool", () => {
  it("is the exact inverse of toolForKey for every bound tool", () => {
    for (const key of ["Z", "H", "D", "M", "I", "W"]) {
      const tool = toolForKey(key);
      expect(tool).not.toBeNull();
      expect(keyForTool(tool!)).toBe(key);
    }
  });

  it("returns null for tools with no single-key shortcut", () => {
    expect(keyForTool("pointer")).toBeNull();
    expect(keyForTool("stats")).toBeNull();
    expect(keyForTool("select")).toBeNull();
    expect(keyForTool("qfit")).toBeNull();
  });
});
