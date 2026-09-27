// Pure report block edits (P3.6): append-to-Figures, move, remove — each a
// new sheet, never a mutation of the input (the undo snapshot keeps the old
// one), and out-of-range edits are `null` rather than silent copies.

import { describe, expect, it } from "vitest";

import type { FigureSpec } from "./api/figures";
import type { ReportFigureBlock, ReportSheet, ReportSourceRef } from "./report";
import {
  BYTES_PER_NUMBER,
  FIGURES_SECTION,
  LARGE_SPEC_BYTES,
  appendFigureBlock,
  estimateJsonBytes,
  figureBlockFromSpec,
  largeSpecNotice,
  moveReportBlock,
  newFigureReport,
  removeReportBlock,
  reportBlockKey,
  uniqueFigureName,
  withSourceRefs,
} from "./reportBlocks";

const fig = (name: string): ReportFigureBlock => ({ type: "figure", name, spec: { fmt: "svg" } });

const sheet = (): ReportSheet => ({
  title: "Fit",
  sections: [
    { title: "Fit results", blocks: [{ type: "text", text: "a" }, { type: "text", text: "b" }, { type: "text", text: "c" }] },
    { title: FIGURES_SECTION, blocks: [fig("one")] },
    { title: "Notes", blocks: [] },
  ],
});

describe("figureBlockFromSpec", () => {
  it("stores a detached copy (serializing like the wire) and trims/omits the caption", () => {
    const spec = {
      dataset: { time: [0, 1], values: [[Number.NaN, 2]], labels: ["A"], units: [""], metadata: {} },
      fmt: "svg",
      x_key: undefined,
    } as unknown as FigureSpec;
    const block = figureBlockFromSpec(spec, "scan", "  Fig. 1 ");
    expect(JSON.parse(JSON.stringify(block))).toEqual({
      type: "figure",
      name: "scan",
      caption: "Fig. 1",
      spec: { dataset: { time: [0, 1], values: [[null, 2]], labels: ["A"], units: [""], metadata: {} }, fmt: "svg" },
    });
    expect(block.spec?.dataset).not.toBe(spec.dataset);
    (spec.dataset.time as number[])[0] = 99;
    expect((block.spec?.dataset as { time: number[] }).time[0]).toBe(0);
    expect(figureBlockFromSpec(spec, "scan", "   ")).not.toHaveProperty("caption");
  });
});

describe("newFigureReport", () => {
  it("one Figures section holding the block, stamped like the backend emitter", () => {
    const r = newFigureReport("scan figures", fig("x"), new Date("2026-09-27T10:11:12.345Z"));
    expect(r).toEqual({
      title: "scan figures",
      sections: [{ title: FIGURES_SECTION, blocks: [fig("x")] }],
      created: "2026-09-27T10:11:12+00:00",
    });
  });
});

describe("appendFigureBlock", () => {
  it("appends to the existing Figures section without touching the input", () => {
    const before = sheet();
    const snapshot = structuredClone(before);
    const after = appendFigureBlock(before, fig("two"));
    expect(after.sections[1].blocks.map((b) => (b as ReportFigureBlock).name)).toEqual(["one", "two"]);
    expect(after.sections[0]).toBe(before.sections[0]); // untouched sections are shared
    expect(before).toEqual(snapshot);
  });

  it("uses the LAST Figures section when there are several", () => {
    const s = sheet();
    s.sections.push({ title: FIGURES_SECTION, blocks: [] });
    expect(appendFigureBlock(s, fig("two")).sections[3].blocks).toEqual([fig("two")]);
  });

  it("adds a Figures section at the end when there is none", () => {
    const s: ReportSheet = { title: "Fit", sections: [{ title: "Fit results", blocks: [] }] };
    expect(appendFigureBlock(s, fig("x")).sections).toEqual([
      { title: "Fit results", blocks: [] },
      { title: FIGURES_SECTION, blocks: [fig("x")] },
    ]);
  });
});

describe("moveReportBlock / removeReportBlock", () => {
  const texts = (s: ReportSheet | null, si = 0) =>
    s?.sections[si].blocks.map((b) => (b.type === "text" ? b.text : "?"));

  it("moves within a section, both directions, without mutating the input", () => {
    const before = sheet();
    expect(texts(moveReportBlock(before, 0, 0, 1))).toEqual(["b", "a", "c"]);
    expect(texts(moveReportBlock(before, 0, 2, -1))).toEqual(["a", "c", "b"]);
    expect(texts(before)).toEqual(["a", "b", "c"]);
  });

  it("returns null for a move off either end or a bad index", () => {
    expect(moveReportBlock(sheet(), 0, 0, -1)).toBeNull();
    expect(moveReportBlock(sheet(), 0, 2, 1)).toBeNull();
    expect(moveReportBlock(sheet(), 5, 0, 1)).toBeNull();
    expect(moveReportBlock(sheet(), 0, 9, -1)).toBeNull();
  });

  it("removes one block and keeps an emptied section", () => {
    expect(texts(removeReportBlock(sheet(), 0, 1))).toEqual(["a", "c"]);
    const emptied = removeReportBlock(sheet(), 1, 0);
    expect(emptied?.sections[1]).toEqual({ title: FIGURES_SECTION, blocks: [] });
    expect(removeReportBlock(sheet(), 2, 0)).toBeNull();
  });
});

describe("uniqueFigureName", () => {
  it("returns the stem when free, else the first free -N suffix, across all sections", () => {
    expect(uniqueFigureName(null, "scan")).toBe("scan");
    const s = sheet(); // has figure "one" in the Figures section
    expect(uniqueFigureName(s, "two")).toBe("two");
    expect(uniqueFigureName(s, "one")).toBe("one-2");
    s.sections[0].blocks.push(fig("one-2"));
    expect(uniqueFigureName(s, "one")).toBe("one-3");
  });
});

describe("reportBlockKey", () => {
  it("is stable per block object, distinct across objects, and survives a move", () => {
    const s = sheet();
    const keys = s.sections[0].blocks.map(reportBlockKey);
    expect(new Set(keys).size).toBe(3);
    const moved = moveReportBlock(s, 0, 0, 1);
    expect(moved?.sections[0].blocks.map(reportBlockKey)).toEqual([keys[1], keys[0], keys[2]]);
    expect(reportBlockKey({ ...s.sections[0].blocks[0] })).not.toBe(keys[0]);
  });
});

describe("withSourceRefs", () => {
  const figRef: ReportSourceRef = { kind: "figure", id: "f1", name: "Sweep" };
  const dsRef: ReportSourceRef = { kind: "dataset", id: "d1", name: "scan.dat" };

  it("merges new refs onto an empty source_refs", () => {
    const before = sheet();
    const after = withSourceRefs(before, [figRef, dsRef]);
    expect(after.source_refs).toEqual([figRef, dsRef]);
    expect(before.source_refs).toBeUndefined(); // input untouched
  });

  it("dedupes by kind+id against what the sheet already carries, keeping order", () => {
    const before: ReportSheet = { ...sheet(), source_refs: [figRef] };
    const after = withSourceRefs(before, [figRef, dsRef]);
    expect(after.source_refs).toEqual([figRef, dsRef]);
  });

  it("returns the SAME sheet object when every ref is already present", () => {
    const before: ReportSheet = { ...sheet(), source_refs: [figRef, dsRef] };
    expect(withSourceRefs(before, [figRef])).toBe(before);
    expect(withSourceRefs(before, [])).toBe(before);
  });
});

describe("large-spec notice", () => {
  it("estimates numbers at BYTES_PER_NUMBER and strings by length, without serializing", () => {
    expect(estimateJsonBytes([1, 2, 3])).toBe(2 + 3 * BYTES_PER_NUMBER);
    expect(estimateJsonBytes({ ab: "xyz" })).toBe(2 + 2 + 3 + 5);
  });

  it("is silent at the threshold and speaks just above it", () => {
    expect(largeSpecNotice(LARGE_SPEC_BYTES)).toBeNull();
    expect(largeSpecNotice(LARGE_SPEC_BYTES + 1)).toMatch(/~5\.0 MB of plotted data/);
    // A spec whose numbers alone cross the line trips it.
    const n = Math.ceil(LARGE_SPEC_BYTES / BYTES_PER_NUMBER) + 1;
    expect(largeSpecNotice(estimateJsonBytes({ dataset: { time: new Array<number>(n).fill(1) } }))).not.toBeNull();
    expect(largeSpecNotice(estimateJsonBytes({ dataset: { time: new Array<number>(1000).fill(1) } }))).toBeNull();
  });
});
