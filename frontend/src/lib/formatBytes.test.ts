import { describe, expect, it } from "vitest";

import { formatBytes } from "./formatBytes";

describe("formatBytes", () => {
  it("uses binary units with one decimal, past MiB", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2048)).toBe("2.0 KiB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MiB");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3.0 GiB");
  });
});
