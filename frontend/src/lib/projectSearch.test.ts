// Project-wide search (MAIN_PLAN #38). The point is REVEAL, not filtering — so
// the tests care about which surface a hit points at, and about ranking, since
// a search that buries the obvious answer is worse than no search.

import { describe, expect, it } from "vitest";

import { excerpt, searchProject } from "./projectSearch";
import type { Dataset } from "./types";

const ds = (id: string, name: string, labels: string[], extra: Partial<Dataset> = {}): Dataset => ({
  id,
  name,
  data: {
    time: [0, 1],
    values: [labels.map(() => 1), labels.map(() => 2)],
    labels,
    units: labels.map(() => ""),
    metadata: {},
  },
  ...extra,
});

const project = {
  datasets: [
    ds("d1", "NbAu hall.dat", ["Field", "Rxy", "Rxx"], {
      tags: ["hall"],
      notes: "measured on the NbAu bilayer at 10 K",
    }),
    ds("d2", "other.dat", ["Temp", "Moment"]),
  ],
  folders: [{ id: "f1", name: "Hall bars", parentId: null, order: 0 }],
  reports: [{ id: "r1", name: "Hall summary", datasetId: "d1" }],
  figures: [{ id: "g1", name: "hall figure" }],
};

describe("searchProject", () => {
  it("returns nothing for a blank query", () => {
    expect(searchProject("   ", project)).toEqual([]);
  });

  it("finds a COLUMN inside a dataset you don't remember", () => {
    // The gap the feature exists for: a Library filter can't find this.
    const hits = searchProject("rxy", project);
    expect(hits[0]).toMatchObject({ kind: "column", datasetId: "d1", channel: 1 });
  });

  it("reveals a column in the WORKSHEET, where you can act on it", () => {
    expect(searchProject("rxy", project)[0].reveal).toBe("worksheet");
  });

  it("finds datasets, folders, reports and figures", () => {
    const kinds = new Set(searchProject("hall", project).map((h) => h.kind));
    expect(kinds).toContain("dataset");
    expect(kinds).toContain("folder");
    expect(kinds).toContain("report");
    expect(kinds).toContain("figure");
    expect(kinds).toContain("tag");
  });

  it("ranks a name match above a note match", () => {
    // Typing "NbAu" means the dataset, not a note mentioning it.
    const hits = searchProject("nbau", project);
    expect(hits[0].kind).toBe("dataset");
    expect(hits.some((h) => h.kind === "note")).toBe(true);
  });

  it("searches notes and shows WHY they matched", () => {
    const note = searchProject("bilayer", project).find((h) => h.kind === "note");
    expect(note?.label).toContain("bilayer");
    expect(note?.context).toBe("NbAu hall.dat");
  });

  it("searches scalar metadata", () => {
    const withMeta = {
      datasets: [ds("d3", "m.dat", ["A"], { data: { ...ds("d3", "m", ["A"]).data, metadata: { operator: "pq" } } })],
    };
    expect(searchProject("pq", withMeta)[0].kind).toBe("metadata");
  });

  it("SKIPS bulky decoded blobs, which produce unactionable hits", () => {
    const bulky = {
      datasets: [
        ds("d4", "o.dat", ["A"], {
          data: { ...ds("d4", "o", ["A"]).data, metadata: { origin_books: "needle everywhere" } },
        }),
      ],
    };
    expect(searchProject("needle", bulky)).toEqual([]);
  });

  it("is case-insensitive", () => {
    expect(searchProject("RXY", project).length).toBeGreaterThan(0);
  });

  it("sorts stably within a rank, so results don't reshuffle", () => {
    const a = searchProject("hall", project).map((h) => h.id);
    const b = searchProject("hall", project).map((h) => h.id);
    expect(a).toEqual(b);
  });

  it("honours the result limit", () => {
    const many = { datasets: Array.from({ length: 80 }, (_, i) => ds(`d${i}`, `run${i}.dat`, ["A"])) };
    expect(searchProject("run", many, 10)).toHaveLength(10);
  });
});

describe("excerpt", () => {
  it("windows around the match rather than showing the first N chars", () => {
    const text = "a".repeat(80) + " needle " + "b".repeat(80);
    expect(excerpt(text, "needle")).toContain("needle");
  });

  it("marks truncation on both sides", () => {
    const text = "x".repeat(200);
    expect(excerpt(text, "x".repeat(3))).not.toContain("…x…x");
  });

  it("falls back gracefully when the needle is absent", () => {
    expect(excerpt("short text", "zzz")).toBe("short text");
  });
});
