// Regression tests for the bundle profiler's attribution core
// (frontend/scripts/eagerAttribution.mjs), added after review on #274 found
// two measurement bugs. A profiler that is quietly wrong is worse than none:
// its output goes into plans/BUNDLE_HEADROOM.md and schedules work.

import { describe, expect, it } from "vitest";

import { attributeMappings } from "../../scripts/eagerAttribution.mjs";

/** Minimal VLQ encoder, so the fixtures below are readable as intent rather
 *  than as hand-copied base64. */
function vlq(...nums: number[]): string {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  return nums
    .map((n) => {
      let v = n < 0 ? (-n << 1) | 1 : n << 1;
      let s = "";
      do {
        let d = v & 31;
        v >>>= 5;
        if (v > 0) d |= 32;
        s += A[d];
      } while (v > 0);
      return s;
    })
    .join("");
}

describe("attribution ownership", () => {
  it("an unmapped segment ends the preceding span instead of being swallowed", () => {
    // One generated line, three segments:
    //   col 0  → source 0        (mapped)
    //   col 4  → nothing         (UNMAPPED — bundler glue)
    //   col 8  → source 0        (mapped)
    // Source 0 owns [0,4) and [8,12) = 8 bytes. The 4 units of glue at [4,8)
    // belong to no module and must stay unattributed.
    //
    // The original implementation advanced the column for the unmapped
    // segment but did not record it, so the first span ran to col 8 and
    // charged the glue to source 0, yielding 12.
    const mappings = [vlq(0, 0, 0, 0), vlq(4), vlq(4, 0, 0, 0)].join(",");
    const out = attributeMappings({
      mappings,
      sources: ["src/a.ts"],
      lines: ["abcdefghijkl"], // 12 chars
    });
    expect(out.get("src/a.ts")).toBe(8);
  });

  it("a trailing mapped segment owns the rest of the line", () => {
    const out = attributeMappings({
      mappings: vlq(0, 0, 0, 0),
      sources: ["src/a.ts"],
      lines: ["abcdefghijkl"],
    });
    expect(out.get("src/a.ts")).toBe(12);
  });
});

describe("attribution units", () => {
  it("counts UTF-8 bytes, not UTF-16 code units", () => {
    // "abµcd" is 5 UTF-16 code units but 6 UTF-8 bytes — µ is two.
    // Sourcemap columns ARE UTF-16 units, so slicing by column is correct;
    // the SIZE of that slice then has to be measured in bytes, because the
    // number is reported as bytes and compared against on-disk file sizes.
    const out = attributeMappings({
      mappings: vlq(0, 0, 0, 0),
      sources: ["src/a.ts"],
      lines: ["abµcd"],
    });
    expect(out.get("src/a.ts")).toBe(6);
  });

  it("measures each span's own text, so multi-byte chars land in the right module", () => {
    //  col 0 → source 0 : "ab"   → 2 bytes
    //  col 2 → source 1 : "µcd"  → 4 bytes
    const mappings = [vlq(0, 0, 0, 0), vlq(2, 1, 0, 0)].join(",");
    const out = attributeMappings({
      mappings,
      sources: ["src/a.ts", "src/b.ts"],
      lines: ["abµcd"],
    });
    expect(out.get("src/a.ts")).toBe(2);
    expect(out.get("src/b.ts")).toBe(4);
  });
});
