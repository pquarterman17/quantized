// Pure report block edits (P3.6): append-to-Figures, move, remove — each a
// new sheet, never a mutation of the input (the undo snapshot keeps the old
// one), and out-of-range edits are `null` rather than silent copies.

import { describe, expect, it } from "vitest";

import type { FigureSpec } from "./api/figures";
import type { ReportFigureBlock, ReportSheet } from "./report";
import {
  FIGURES_SECTION,
  appendFigureBlock,
  figureBlockFromSpec,
  moveReportBlock,
  newFigureReport,
  removeReportBlock,
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
  it("stores a detached JSON-clean spec copy and trims/omits the caption", () => {
    const spec = {
      dataset: { time: [0, 1], values: [[Number.NaN, 2]], labels: ["A"], units: [""], metadata: {} },
      fmt: "svg",
      x_key: undefined,
    } as unknown as FigureSpec;
    const block = figureBlockFromSpec(spec, "scan", "  Fig. 1 ");
    expect(block).toEqual({
      type: "figure",
      name: "scan",
      caption: "Fig. 1",
      spec: { dataset: { time: [0, 1], values: [[null, 2]], labels: ["A"], units: [""], metadata: {} }, fmt: "svg" },
    });
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
