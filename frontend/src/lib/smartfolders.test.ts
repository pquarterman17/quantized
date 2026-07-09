// Smart folders (project-organization plan item 9) — the pure query grammar
// + matcher shared by the Library filter box and the saved smart-folder
// sections, and the .dwk-boundary sanitizer.

import { describe, expect, it } from "vitest";

import {
  datasetFormat,
  matchesQuery,
  parseQuery,
  sanitizeSmartFolders,
  smartFolderMembers,
} from "./smartfolders";
import type { Dataset } from "./types";

const ds = (
  id: string,
  name: string,
  opts: { tags?: string[]; parser?: string } = {},
): Dataset => ({
  id,
  name,
  data: {
    time: [0],
    values: [[1]],
    labels: ["A"],
    units: [""],
    metadata: opts.parser ? { parser_name: opts.parser } : {},
  },
  ...(opts.tags ? { tags: opts.tags } : {}),
});

describe("parseQuery", () => {
  it("splits whitespace into bare terms", () => {
    expect(parseQuery("  loop  5K ")).toEqual([
      { field: "any", needle: "loop" },
      { field: "any", needle: "5k" },
    ]);
  });

  it("recognizes tag:/name:/format: prefixes (case-insensitive key)", () => {
    expect(parseQuery("TAG:MvsH format:qd name:sample")).toEqual([
      { field: "tag", needle: "mvsh" },
      { field: "format", needle: "qd" },
      { field: "name", needle: "sample" },
    ]);
  });

  it("drops a prefixed term with an empty needle (mid-typing never filters all away)", () => {
    expect(parseQuery("tag:")).toEqual([]);
  });

  it("treats an unknown key as a bare term (a colon in a filename still matches)", () => {
    expect(parseQuery("XRD:Book4")).toEqual([{ field: "any", needle: "xrd:book4" }]);
  });

  it("empty text parses to no terms", () => {
    expect(parseQuery("   ")).toEqual([]);
  });
});

describe("matchesQuery", () => {
  const d = ds("d1", "MnN_MvsH_300K.dat", { tags: ["hysteresis", "sample-A"], parser: "import_qd_vsm" });

  it("a bare term matches the name OR any tag (historical Library behavior)", () => {
    expect(matchesQuery(d, parseQuery("mvsh"))).toBe(true); // name
    expect(matchesQuery(d, parseQuery("hyster"))).toBe(true); // tag
    expect(matchesQuery(d, parseQuery("nomatch"))).toBe(false);
  });

  it("tag:/name:/format: narrow to one field", () => {
    expect(matchesQuery(d, parseQuery("tag:sample-a"))).toBe(true);
    expect(matchesQuery(d, parseQuery("tag:mnn"))).toBe(false); // name-only text
    expect(matchesQuery(d, parseQuery("name:mnn"))).toBe(true);
    expect(matchesQuery(d, parseQuery("format:qd"))).toBe(true); // ⊂ import_qd_vsm
    expect(matchesQuery(d, parseQuery("format:rigaku"))).toBe(false);
  });

  it("ANDs every term", () => {
    expect(matchesQuery(d, parseQuery("tag:hysteresis format:qd"))).toBe(true);
    expect(matchesQuery(d, parseQuery("tag:hysteresis format:rigaku"))).toBe(false);
  });

  it("an empty query matches everything", () => {
    expect(matchesQuery(d, parseQuery(""))).toBe(true);
  });

  it("format is empty for client-made datasets (demo/merge/extract)", () => {
    const demo = ds("d2", "demo.dat");
    expect(datasetFormat(demo)).toBe("");
    expect(matchesQuery(demo, parseQuery("format:qd"))).toBe(false);
  });
});

describe("smartFolderMembers", () => {
  it("derives members in library order; a dataset can sit in several folders", () => {
    const all = [
      ds("a", "loop1.dat", { tags: ["MvsH"] }),
      ds("b", "xrd.raw", { parser: "import_rigaku_raw" }),
      ds("c", "loop2.dat", { tags: ["MvsH"], parser: "import_qd_vsm" }),
    ];
    const loops = { id: "s1", name: "Loops", query: "tag:mvsh" };
    const qd = { id: "s2", name: "QD", query: "format:qd" };
    expect(smartFolderMembers(all, loops).map((d) => d.id)).toEqual(["a", "c"]);
    expect(smartFolderMembers(all, qd).map((d) => d.id)).toEqual(["c"]); // c in both
  });
});

describe("sanitizeSmartFolders (.dwk boundary)", () => {
  it("keeps valid entries and drops malformed ones", () => {
    expect(
      sanitizeSmartFolders([
        { id: "s1", name: "Loops", query: "tag:mvsh" },
        { id: "s2", name: "  ", query: "x" }, // blank name
        { id: 3, name: "bad-id", query: "" }, // non-string id
        { id: "s4", name: "no-query" }, // missing query
        "garbage",
        null,
      ]),
    ).toEqual([{ id: "s1", name: "Loops", query: "tag:mvsh" }]);
  });

  it("non-arrays sanitize to []", () => {
    expect(sanitizeSmartFolders(undefined)).toEqual([]);
    expect(sanitizeSmartFolders({ id: "x" })).toEqual([]);
  });
});
