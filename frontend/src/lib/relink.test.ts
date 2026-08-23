import { describe, expect, it } from "vitest";

import {
  evaluateCommitProbe,
  guardVerdict,
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

// POST_SPRINT_INDEPENDENT_REVIEW.md R3 + its code-review round: the pure
// per-row commit decision `store/relink.ts`'s `commit()` applies to every
// candidate once its fresh probe succeeds. `evaluateCommitProbe(recorded,
// probe, preview, escalated)` — positional, so a `RelinkPreviewRow`-shaped
// object can be passed straight through as `preview` with no remapping.
describe("evaluateCommitProbe", () => {
  const noPreview = { candidateChecksum: null, candidateMtime: null, candidateSize: null };

  it("conflict: fresh probe conflicts with the RECORDED checksum — refuses even when escalated", () => {
    const outcome = evaluateCommitProbe({ checksum: "sha256:A" }, { checksum: "sha256:B" }, noPreview, true);
    expect(outcome).toBe("conflict");
  });

  it("mismatch: nothing recorded, but the fresh checksum differs from what Preview itself showed", () => {
    const outcome = evaluateCommitProbe(
      {},
      { checksum: "sha256:Y" },
      { candidateChecksum: "sha256:X", candidateMtime: 1, candidateSize: 1 },
      true,
    );
    expect(outcome).toBe("mismatch");
  });

  it("mismatch: a checksum-less preview still gets stat-level verification (size swap)", () => {
    // F1 strengthening: candidateChecksum was never confirmed (null both
    // times), but Preview's own stat (size 100) disagrees with the fresh
    // probe's stat (size 999) — this must still refuse, not silently pass.
    const outcome = evaluateCommitProbe(
      {},
      { checksum: null, size: 999, mtime: 50 },
      { candidateChecksum: null, candidateMtime: 50, candidateSize: 100 },
      true,
    );
    expect(outcome).toBe("mismatch");
  });

  it("unverified: recorded-vs-fresh is genuinely unknown and the row was never escalated", () => {
    const outcome = evaluateCommitProbe({ checksum: "sha256:A" }, { checksum: null }, noPreview, false);
    expect(outcome).toBe("gap");
  });

  it("write (unchanged): backfills the FRESH probe's checksum/mtime/size", () => {
    const outcome = evaluateCommitProbe(
      { checksum: "sha256:A" },
      { checksum: "sha256:A", mtime: 5, size: 5 },
      noPreview,
      false,
    );
    expect(outcome).toEqual({ checksum: "sha256:A", mtime: 5, size: 5 });
  });

  it("write (legacy backfill, F2): nothing recorded, fresh probe matches what Preview showed — backfills from the probe", () => {
    const outcome = evaluateCommitProbe(
      {},
      { checksum: "sha256:X", mtime: 1, size: 1 },
      { candidateChecksum: "sha256:X", candidateMtime: 1, candidateSize: 1 },
      true,
    );
    expect(outcome).toEqual({ checksum: "sha256:X", mtime: 1, size: 1 });
  });

  // R3 #3 ruling, genuinely unknown case: stats MATCH what was recorded AND
  // what Preview showed — nothing contradicts the unconfirmable checksum,
  // so escalation is what it's for: commits, preserving the RECORDED
  // fields verbatim (never fabricating a checksum from the incomplete
  // fresh probe).
  it("write (R3 #3, preserve original): escalated + still unknown, stats agree everywhere — keeps the RECORDED fields, never the fresh probe's", () => {
    const outcome = evaluateCommitProbe(
      { checksum: "sha256:A", mtime: 10, size: 10 },
      { checksum: null, mtime: 10, size: 10 },
      { candidateChecksum: null, candidateMtime: 10, candidateSize: 10 },
      true,
    );
    expect(outcome).toEqual({ checksum: "sha256:A", mtime: 10, size: 10 });
  });

  it("defaults `escalated` to falsy when undefined (a preview row's `escalated?` field, unset)", () => {
    // store/relink.ts passes `row.escalated` straight through — `undefined`
    // on a fresh, never-escalated row must behave exactly like `false`.
    const outcome = evaluateCommitProbe({ checksum: "sha256:A" }, { checksum: null }, noPreview, undefined);
    expect(outcome).toBe("gap");
  });

  // ── final review pass (F1+F2), RED-FIRST: the pre-fix guards reused
  // `sourceChangeVerdict`'s "never demote a recorded checksum" rule, which
  // is correct for the verdict SHOWN in Preview but let a stat-level
  // contradiction sail straight through a commit-time guard whenever the
  // checksum comparison itself was unconfirmable (a fresh probe checksum
  // of `null`) — per this module's own "KNOWN LIMITATION" doc, THE
  // DOMINANT case in the real desktop app. ────────────────────────────

  it("conflict (F1a): recorded {checksum, size 10} vs a fresh probe of {no checksum, size 5} refuses — never commits size-10 provenance for an observably size-5 file", () => {
    const outcome = evaluateCommitProbe(
      { checksum: "sha256:A", mtime: 10, size: 10 },
      { checksum: null, mtime: 5, size: 5 },
      { candidateChecksum: null, candidateMtime: 10, candidateSize: 10 },
      true, // escalated — must refuse regardless
    );
    expect(outcome).toBe("conflict");
  });

  it("mismatch (F1b): a Preview snapshot of {checksum X, size 1} vs a fresh {no checksum, size 999} refuses — the consent guard must not pass a swapped file just because neither side's checksum is confirmable", () => {
    const outcome = evaluateCommitProbe(
      {},
      { checksum: null, mtime: 999, size: 999 },
      { candidateChecksum: "sha256:X", candidateMtime: 1, candidateSize: 1 },
      true,
    );
    expect(outcome).toBe("mismatch");
  });

  it("still commits when escalated and the checksum is unconfirmable but stats are ABSENT on the recorded side (genuinely nothing to contradict) — preserves ONLY what was recorded, never fabricates the missing mtime/size", () => {
    const outcome = evaluateCommitProbe(
      { checksum: "sha256:A" }, // no recorded mtime/size at all
      { checksum: null, mtime: 5, size: 5 },
      { candidateChecksum: null, candidateMtime: 5, candidateSize: 5 },
      true,
    );
    expect(outcome).toEqual({ checksum: "sha256:A" });
  });
});

describe("guardVerdict", () => {
  it("compares checksums directly when both sides have one (same as sourceChangeVerdict)", () => {
    expect(guardVerdict({ checksum: "sha256:aa" }, { checksum: "sha256:aa" })).toBe("unchanged");
    expect(guardVerdict({ checksum: "sha256:aa" }, { checksum: "sha256:bb" })).toBe("changed");
  });

  it("falls back to stat comparison when the checksum comparison is unconfirmable — unlike sourceChangeVerdict", () => {
    // recorded HAS a checksum, but the probe doesn't (null) — sourceChangeVerdict
    // reports "unknown" here (the correct DISPLAY answer); guardVerdict instead
    // falls back to the stat comparison, since this is a REFUSAL guard.
    expect(guardVerdict({ checksum: "sha256:aa", size: 10, mtime: 100 }, { checksum: null, size: 10, mtime: 100 })).toBe(
      "unchanged",
    );
    expect(guardVerdict({ checksum: "sha256:aa", size: 10, mtime: 100 }, { checksum: null, size: 5, mtime: 100 })).toBe(
      "changed",
    );
  });

  it("is unknown only when NEITHER checksum nor any stat is comparable", () => {
    expect(guardVerdict({ checksum: "sha256:aa" }, { checksum: null })).toBe("unknown");
    expect(guardVerdict({}, {})).toBe("unknown");
  });
});
