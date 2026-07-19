import { describe, expect, it } from "vitest";

import {
  IMPORT_FORMATS,
  documentedExtensions,
  formatToHelpItem,
} from "./importFormats";
import { searchHelpItems } from "./helpContent";
import { IMPORT_ACCEPT } from "./openFilePicker";

/** The accept string, normalized to a lower-case extension set. */
function acceptExts(): Set<string> {
  return new Set(IMPORT_ACCEPT.split(",").map((e) => e.trim().toLowerCase()));
}

describe("import-format catalog ⊆ file-dialog filter (the drift guard)", () => {
  it("offers every documented extension in IMPORT_ACCEPT", () => {
    // The exact drift that hid the missing .opj/.opju Origin entries: the Help
    // catalog and the Open dialog have to agree, or Help documents a format
    // the user can't actually pick.
    const accept = acceptExts();
    const missing = documentedExtensions().filter((e) => !accept.has(e));
    expect(missing).toEqual([]);
  });

  it("includes the Origin project extensions that were previously missing", () => {
    const accept = acceptExts();
    expect(accept.has(".opj")).toBe(true);
    expect(accept.has(".opju")).toBe(true);
  });
});

describe("IMPORT_FORMATS content", () => {
  it("every entry has extensions (dot-prefixed, lower-case), a name, and a category", () => {
    for (const f of IMPORT_FORMATS) {
      expect(f.exts.length).toBeGreaterThan(0);
      for (const e of f.exts) expect(e).toMatch(/^\.[a-z0-9]+$/);
      expect(f.name.length).toBeGreaterThan(0);
      expect(f.category.length).toBeGreaterThan(0);
    }
  });

  it("does not document an extension twice", () => {
    const all = documentedExtensions();
    expect(all.length).toBe(new Set(all).size);
  });
});

describe("formats are searchable alongside tools", () => {
  it("a format is found by its extension and by its name", () => {
    const items = IMPORT_FORMATS.map(formatToHelpItem);
    expect(searchHelpItems(items, ".xrdml").length).toBeGreaterThan(0);
    expect(searchHelpItems(items, "origin").map((r) => r.key)).toContain("fmt:.opj");
  });
});
