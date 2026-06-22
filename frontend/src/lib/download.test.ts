import { describe, expect, it } from "vitest";

import { filenameFromDisposition } from "./download";

describe("filenameFromDisposition", () => {
  it("extracts a quoted filename", () => {
    expect(filenameFromDisposition('attachment; filename="scan1.csv"', "x.csv")).toBe("scan1.csv");
  });

  it("extracts an unquoted filename", () => {
    expect(filenameFromDisposition("attachment; filename=scan1.h5", "x.h5")).toBe("scan1.h5");
  });

  it("handles RFC 5987 UTF-8 form", () => {
    expect(filenameFromDisposition("attachment; filename*=UTF-8''r%C3.csv", "x.csv")).toBe(
      "r%C3.csv",
    );
  });

  it("falls back when header is missing or empty", () => {
    expect(filenameFromDisposition(null, "fallback.csv")).toBe("fallback.csv");
    expect(filenameFromDisposition("attachment", "fallback.csv")).toBe("fallback.csv");
  });
});
