// P2.5 "Metadata → factors" candidate list (review finding #9): the hidden
// wiring/provenance keys here must be the SAME ones `lib/metadata.ts`'s
// Inspector card hides — a key hidden from the card (an origin_* provenance
// field, e.g.) must never be offered as a promotable/unifiable factor field
// either. The two lists had diverged before this fix.

import { describe, expect, it } from "vitest";

import { isHiddenMetadataKey } from "./metadata";
import { isHiddenMetaKey, scalarFields } from "./metadataKeys";

describe("isHiddenMetaKey", () => {
  it("hides every key lib/metadata.ts's Inspector card hides (origin_* included)", () => {
    for (const k of [
      "x_column_name",
      "x_column_unit",
      "origin_results_log",
      "origin_results_log_records",
      "origin_notes",
      "origin_report_sheets",
      "origin_text_columns",
    ]) {
      expect(isHiddenMetadataKey(k)).toBe(true);
      expect(isHiddenMetaKey(k)).toBe(true);
    }
  });

  it("also hides this feature's own provenance log, on top of the shared list", () => {
    expect(isHiddenMetaKey("metadata_cleanup")).toBe(true);
    expect(isHiddenMetadataKey("metadata_cleanup")).toBe(false); // the Inspector still shows it
  });

  it("never hides ordinary instrument metadata", () => {
    expect(isHiddenMetaKey("sample")).toBe(false);
    expect(isHiddenMetaKey("temperature")).toBe(false);
  });
});

describe("scalarFields", () => {
  it("never offers origin_notes (or any other hidden key) as a factor candidate", () => {
    const fields = scalarFields({ origin_notes: "some Origin notes text", sample: "S1" });
    expect(fields.map(([p]) => p.join("."))).toEqual(["sample"]);
  });
});
