// P1.4's "keep ignored instrumental metadata searchable" box asserted a
// capability that did not exist: the sidecars preserved the data, and
// project search could not reach any of it. These tests are that box's
// evidence — including the part that is deliberately still NOT searchable.

import { describe, expect, it } from "vitest";

import { searchProject } from "./projectSearch";
import { sidecarHits } from "./projectSearchSidecars";
import type { Dataset } from "./types";

const withMeta = (metadata: Record<string, unknown>, labels = ["Field", "Rxy"]): Dataset => ({
  id: "d1",
  name: "NbAu run.dat",
  data: {
    time: [0, 1],
    values: [
      [1, 2],
      [3, 4],
    ],
    labels,
    units: labels.map(() => ""),
    metadata,
  },
});

describe("sidecarHits — the four collection-shaped sidecars", () => {
  it("finds a text COLUMN by name, and reveals it in the worksheet without claiming a channel", () => {
    // A text column has no channel index (lib/columnmeta.ts), so a hit that
    // named one would scroll the worksheet to the wrong place.
    const hits = sidecarHits(withMeta({ text_columns: { SampleID: ["A", "B"] } }), "sample");
    expect(hits).toHaveLength(1);
    expect(hits[0].label).toBe("SampleID");
    expect(hits[0].revealInWorksheet).toBe(true);
    expect(hits[0].channel).toBeUndefined();
  });

  it("does NOT search text-column CELL contents — a measured, deliberate exclusion", () => {
    // 2M cells scanned per keystroke measured at 322 ms; a capped scan would be
    // silent incompleteness. See the module doc.
    const hits = sidecarHits(withMeta({ text_columns: { SampleID: ["NbAu-7", "NbAu-8"] } }), "nbau-7");
    expect(hits).toHaveLength(0);
  });

  it("finds a column the file declared that never became a channel", () => {
    const hits = sidecarHits(withMeta({ all_column_names: ["Field", "Rxy", "Thermometer"] }), "thermo");
    expect(hits.map((h) => h.label)).toEqual(["Thermometer"]);
  });

  it("does not duplicate a column name that is already a searchable channel label", () => {
    // `searchProject` already emits a `column` hit for "Rxy" at a much better
    // rank; a second sidecar hit for the same string is noise.
    const hits = sidecarHits(withMeta({ all_column_names: ["Field", "Rxy"] }), "rxy");
    expect(hits).toHaveLength(0);
  });

  it("searches label-row CELLS — this is where sample ids live", () => {
    const hits = sidecarHits(
      withMeta({
        label_rows: [
          { index: 0, role: "header", x: "H", cells: ["Field", "Rxy"] },
          { index: 1, role: "label", x: "", cells: ["NbAu-3", "NbAu-4"] },
        ],
      }),
      "nbau-3",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].label).toBe("NbAu-3");
    expect(hits[0].context).toContain("header row 2");
    // cells[0] is channel 0 — the x cell is split out ahead of them.
    expect(hits[0].channel).toBe(0);
    expect(hits[0].revealInWorksheet).toBe(true);
  });

  it("returns ONE hit per label row even when several cells in it match", () => {
    const hits = sidecarHits(
      withMeta({
        label_rows: [
          { index: 0, role: "header", x: "H", cells: ["A", "B"] },
          { index: 1, role: "label", x: "", cells: ["NbAu-3", "NbAu-4"] },
        ],
      }),
      "nbau",
    );
    expect(hits).toHaveLength(1);
  });

  it("searches the file preamble, one hit per dataset with a count of the rest", () => {
    const hits = sidecarHits(
      withMeta({
        comments: ["# instrument: PPMS-9", "# operator: pq", "# PPMS calibration 2026-01"],
      }),
      "ppms",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].label).toBe("# instrument: PPMS-9 (+1 more line)");
  });

  it("degrades on a structurally corrupted sidecar instead of indexing into a string", () => {
    // A bare string where a string ARRAY belongs reads as truthy and JS happily
    // iterates it character by character — the P1.4 review-round hazard.
    expect(sidecarHits(withMeta({ comments: "not a list" }), "not")).toHaveLength(0);
    expect(sidecarHits(withMeta({ all_column_names: "Field" }), "field")).toHaveLength(0);
    expect(sidecarHits(withMeta({ label_rows: "nope" }), "nope")).toHaveLength(0);
  });
});

describe("searchProject — sidecars reach the real search", () => {
  const project = {
    datasets: [
      withMeta({
        comments: ["# instrument: PPMS-9"],
        all_column_names: ["Field", "Rxy", "Thermometer"],
        text_columns: { SampleID: ["A"] },
      }),
    ],
  };

  it("surfaces a preamble match that was previously unreachable", () => {
    const hits = searchProject("ppms", project);
    expect(hits.map((h) => h.label)).toContain("# instrument: PPMS-9");
    expect(hits[0].kind).toBe("metadata");
  });

  it("ranks a sidecar hit BELOW a real column match for the same query", () => {
    const hits = searchProject("r", project);
    const col = hits.findIndex((h) => h.kind === "column");
    const side = hits.findIndex((h) => h.id.startsWith("colname:"));
    expect(col).toBeGreaterThanOrEqual(0);
    expect(side).toBeGreaterThan(col);
  });

  it("sends a text-column hit to the worksheet, since that is where it renders", () => {
    const hit = searchProject("sampleid", project).find((h) => h.id.startsWith("text:"))!;
    expect(hit.reveal).toBe("worksheet");
    expect(hit.channel).toBeUndefined();
  });
});
