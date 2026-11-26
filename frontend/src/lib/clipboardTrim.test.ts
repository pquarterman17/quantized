import { describe, expect, it } from "vitest";

import { parseClipboardGrid, pasteEdits } from "./clipboardGrid";
import { trimCell, trimClipboardText, trimGrid } from "./clipboardTrim";

const ZW = "​";

describe("trimCell", () => {
  it("strips leading and trailing spaces, tabs, NBSP and zero-width characters", () => {
    expect(trimCell("  12  ")).toBe("12");
    expect(trimCell(" 12 ")).toBe("12");
    expect(trimCell(`${ZW}12${ZW}`)).toBe("12");
    expect(trimCell("⁠ 12 ﻿")).toBe("12");
  });
  it("keeps inner spaces and does not touch an already-clean cell", () => {
    expect(trimCell(" a b ")).toBe("a b");
    expect(trimCell("12")).toBe("12");
    expect(trimCell("")).toBe("");
    expect(trimCell("   ")).toBe("");
  });
});

describe("trimGrid / trimClipboardText", () => {
  it("keeps the shape, ragged rows included", () => {
    expect(trimGrid([[" a ", "b "], [" c"]])).toEqual([["a", "b"], ["c"]]);
    expect(trimClipboardText(" 1 \t 2 \r\n 3 \n")).toBe("1\t2\n3");
    expect(trimClipboardText("")).toBe("");
  });
});

describe("what it changes in a paste", () => {
  const bounds = { rows: 5, writableCols: 3 };
  const edits = (grid: string[][]) => pasteEdits(grid, [0, 1, 2], 0, bounds);

  it("a zero-width-padded number is skipped by the plain paste and lands once trimmed", () => {
    const raw = parseClipboardGrid(`${ZW}12${ZW}\t 7 `);
    const plain = edits(raw);
    expect(plain.skippedCells).toBe(1);
    expect(plain.edits).toEqual([{ row: 0, col: 1, value: 7 }]); // ordinary spaces are already trimmed by parseCell
    const trimmed = edits(trimGrid(raw));
    expect(trimmed.skippedCells).toBe(0);
    expect(trimmed.edits).toEqual([{ row: 0, col: 0, value: 12 }, { row: 0, col: 1, value: 7 }]);
  });

  it("a categorical label keeps no padding in its new level", () => {
    const levels = (c: number) => (c === 0 ? ["a"] : null);
    const r = pasteEdits(trimGrid([[` ${ZW}new${ZW} `]]), [0], 0, { ...bounds, levelsAt: levels });
    expect(r.newLevels[0]).toEqual(["new"]);
  });
});
