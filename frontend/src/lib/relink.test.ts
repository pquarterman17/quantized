import { describe, expect, it } from "vitest";

import {
  joinUnderRoot,
  relinkedCandidate,
  sourceChangeVerdict,
  suffixUnderRoot,
} from "./relink";

describe("suffixUnderRoot", () => {
  it("matches a plain posix child", () => {
    expect(suffixUnderRoot("/data/run1", "/data/run1/a.csv")).toEqual(["a.csv"]);
  });

  it("matches a nested posix child", () => {
    expect(suffixUnderRoot("/data/run1", "/data/run1/sub/a.csv")).toEqual(["sub", "a.csv"]);
  });

  it("matches a windows drive-letter root with backslashes", () => {
    expect(suffixUnderRoot("C:\\data\\run1", "C:\\data\\run1\\a.csv")).toEqual(["a.csv"]);
  });

  it("matches a UNC root", () => {
    const unc = String.fromCharCode(92).repeat(2) + "server" + String.fromCharCode(92) + "share";
    const full = unc + String.fromCharCode(92) + "run1" + String.fromCharCode(92) + "a.csv";
    expect(suffixUnderRoot(unc, full)).toEqual(["run1", "a.csv"]);
  });

  it("matches when the OLD path used the opposite separator from the root", () => {
    // The moved-folder case can genuinely cross platforms: a dataset
    // imported from a mounted Windows share, reopened on a Mac.
    expect(suffixUnderRoot("/data/run1", "\\data\\run1\\a.csv")).toEqual(["a.csv"]);
    expect(suffixUnderRoot("C:\\data\\run1", "C:/data/run1/a.csv")).toEqual(["a.csv"]);
  });

  it("is case-insensitive (Windows/macOS default volumes)", () => {
    expect(suffixUnderRoot("/Data/Run1", "/data/run1/A.CSV")).toEqual(["A.CSV"]);
  });

  it("tolerates a trailing slash on the root", () => {
    expect(suffixUnderRoot("/data/run1/", "/data/run1/a.csv")).toEqual(["a.csv"]);
  });

  it("tolerates doubled separators", () => {
    expect(suffixUnderRoot("/data//run1", "/data/run1///a.csv")).toEqual(["a.csv"]);
  });

  it("returns null when the path is not under the root", () => {
    expect(suffixUnderRoot("/data/run1", "/data/run2/a.csv")).toBeNull();
  });

  it("returns null for a sibling that merely shares a name prefix", () => {
    // "/data/run1" must not match "/data/run10/a.csv" — segment-wise, not
    // string-prefix, comparison.
    expect(suffixUnderRoot("/data/run1", "/data/run10/a.csv")).toBeNull();
  });

  it("returns null when the path is shorter than the root", () => {
    expect(suffixUnderRoot("/data/run1/sub", "/data/run1")).toBeNull();
  });

  it("returns an empty suffix when path equals root exactly", () => {
    expect(suffixUnderRoot("/data/run1", "/data/run1")).toEqual([]);
  });
});

describe("joinUnderRoot", () => {
  it("joins with posix separators when the root has no backslash", () => {
    expect(joinUnderRoot("/new/place", ["a.csv"])).toBe("/new/place/a.csv");
  });

  it("joins with backslashes when the root is a windows path", () => {
    expect(joinUnderRoot("D:\\new\\place", ["sub", "a.csv"])).toBe("D:\\new\\place\\sub\\a.csv");
  });

  it("strips a trailing separator on the new root before joining", () => {
    expect(joinUnderRoot("/new/place/", ["a.csv"])).toBe("/new/place/a.csv");
  });
});

describe("relinkedCandidate (relink-one and relink-folder share this)", () => {
  it("computes a moved posix tree end to end", () => {
    expect(relinkedCandidate("/old/data", "/new/place", "/old/data/run1/a.csv")).toBe(
      "/new/place/run1/a.csv",
    );
  });

  it("computes a windows-to-posix cross-platform move", () => {
    expect(relinkedCandidate("C:\\old\\data", "/mnt/new/place", "C:\\old\\data\\run1\\a.csv")).toBe(
      "/mnt/new/place/run1/a.csv",
    );
  });

  it("leaves a dataset outside the moved tree alone (null)", () => {
    expect(relinkedCandidate("/old/data", "/new/place", "/other/tree/a.csv")).toBeNull();
  });

  it("handles relink-one (a dataset's own file IS the root)", () => {
    expect(relinkedCandidate("/old/data/a.csv", "/new/b.csv", "/old/data/a.csv")).toBe("/new/b.csv");
  });
});

describe("sourceChangeVerdict", () => {
  it("unchanged when checksums match", () => {
    expect(sourceChangeVerdict({ checksum: "sha256:aa" }, { checksum: "sha256:aa" })).toBe(
      "unchanged",
    );
  });

  it("changed when checksums differ, even if size/mtime happen to match", () => {
    expect(
      sourceChangeVerdict(
        { checksum: "sha256:aa", size: 10, mtime: 100 },
        { checksum: "sha256:bb", size: 10, mtime: 100 },
      ),
    ).toBe("changed");
  });

  it("falls back to size+mtime when no checksum is recorded on either side", () => {
    expect(sourceChangeVerdict({ size: 10, mtime: 100 }, { size: 10, mtime: 100 })).toBe(
      "unchanged",
    );
    expect(sourceChangeVerdict({ size: 10, mtime: 100 }, { size: 11, mtime: 100 })).toBe("changed");
    expect(sourceChangeVerdict({ size: 10, mtime: 100 }, { size: 10, mtime: 200 })).toBe("changed");
  });

  it("is unknown, never unchanged, when nothing at all is comparable", () => {
    expect(sourceChangeVerdict({}, {})).toBe("unknown");
    expect(sourceChangeVerdict({ checksum: "sha256:aa" }, {})).toBe("unknown");
    expect(sourceChangeVerdict({}, { checksum: "sha256:aa" })).toBe("unknown");
  });

  it("is unknown when the probe could not compute a checksum but one is recorded", () => {
    // recorded has a checksum, probed does not (unconsented this session) —
    // and neither side has size/mtime to fall back to.
    expect(sourceChangeVerdict({ checksum: "sha256:aa" }, { checksum: null })).toBe("unknown");
  });

  // P1-2 DEFECT 1 (RED-FIRST): the pre-fix code short-circuited past the
  // checksum branch whenever EITHER side's checksum was falsy, and silently
  // fell through to size/mtime — so a recorded checksum + a legitimately
  // unavailable probe checksum (content-read consent lapsed this session,
  // desktopBridge.ts:329-332) returned a confident "unchanged"/"changed"
  // grounded in a weaker signal than what was actually recorded. A recorded
  // checksum is authoritative: unavailable-this-session must report
  // "unknown", never silently downgrade to the metadata fallback.
  it("is unknown (not unchanged) when a recorded checksum's probe is unavailable, even if size/mtime match", () => {
    expect(
      sourceChangeVerdict(
        { checksum: "sha256:aa", size: 10, mtime: 100 },
        { checksum: null, size: 10, mtime: 100 },
      ),
    ).toBe("unknown");
  });

  it("is unknown (not changed) when a recorded checksum's probe is unavailable, even if size/mtime differ", () => {
    // Falling through to metadata must not happen in EITHER direction: an
    // unavailable checksum probe is not evidence of "changed" either.
    expect(
      sourceChangeVerdict(
        { checksum: "sha256:aa", size: 10, mtime: 100 },
        { checksum: null, size: 999, mtime: 999 },
      ),
    ).toBe("unknown");
  });

  it("keeps the legitimate metadata fallback when NO checksum was ever recorded", () => {
    // Recorded checksum absent (a browser import, or a dataset from before
    // this slice) — falling back to size/mtime here is the intended
    // degraded mode, not the defect.
    expect(sourceChangeVerdict({ size: 10, mtime: 100 }, { checksum: null, size: 10, mtime: 100 })).toBe(
      "unchanged",
    );
    expect(sourceChangeVerdict({ size: 10, mtime: 100 }, { checksum: null, size: 11, mtime: 100 })).toBe(
      "changed",
    );
  });
});
