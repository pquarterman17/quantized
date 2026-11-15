import { describe, expect, it } from "vitest";
import { importFailureHint, importSummary } from "./importFailureHint";

describe("importFailureHint", () => {
  it.each(["a.h5", "a.NXS", "a.mat", "a.ibw", "a.png", "a.TIF", "a.tiff", "a.jpg", "a.jpeg"])(
    "points binary %s at no wizard (its error already says what to do)",
    (name) => {
      expect(importFailureHint(name)).toBe("");
    },
  );

  it("still points a text-like file at the Import wizard", () => {
    expect(importFailureHint("scan.csv")).toContain("Import wizard");
    expect(importFailureHint("noext")).toContain("Import wizard");
  });

  it("names a server that is down instead of pointing at the wizard (soak issue 7)", () => {
    const line = importSummary(0, 1, "scan.csv: Failed to fetch", "scan.csv");
    expect(line).not.toContain("Import wizard");
    expect(line).toContain("qz server is not responding");
    expect(line).toContain("reload this page");
  });

  it("names a stale token after a qz relaunch and says to reload", () => {
    const line = importSummary(0, 1, "scan.csv: missing or invalid API token", "scan.csv");
    expect(line).not.toContain("Import wizard");
    expect(line).toContain("qz was relaunched");
    expect(line).toContain("reload this page");
  });

  it("keeps the wizard hint for a genuine parse failure", () => {
    expect(importSummary(0, 1, "scan.csv: could not detect columns", "scan.csv")).toContain("Import wizard");
  });
});
