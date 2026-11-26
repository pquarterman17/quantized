// Text to columns: quoted fields, empty fields, ragged rows, each delimiter, a
// multi-character delimiter, numeric versus text pieces, and the appended
// worksheet leaving every existing column untouched.

import { describe, expect, it } from "vitest";

import { classifyColumns, splitCell, splitCells, textToColumnsData, type SplitOptions } from "./textToColumns";
import type { DataStruct } from "./types";

const comma: SplitOptions = { delimiter: "comma" };

describe("splitCell", () => {
  it("splits on each built-in delimiter", () => {
    expect(splitCell("a,b,c", comma)).toEqual(["a", "b", "c"]);
    expect(splitCell("a\tb", { delimiter: "tab" })).toEqual(["a", "b"]);
    expect(splitCell("a;b", { delimiter: "semicolon" })).toEqual(["a", "b"]);
    expect(splitCell("a b c", { delimiter: "space" })).toEqual(["a", "b", "c"]);
  });

  it("splits on a typed string, literally (no pattern characters)", () => {
    expect(splitCell("a--b--c", { delimiter: "custom", custom: "--" })).toEqual(["a", "b", "c"]);
    expect(splitCell("a.b|c", { delimiter: "custom", custom: "." })).toEqual(["a", "b|c"]);
    expect(splitCell("a|b", { delimiter: "custom", custom: "|" })).toEqual(["a", "b"]);
    expect(() => splitCell("a", { delimiter: "custom", custom: "" })).toThrow(/delimiter/);
  });

  it("keeps empty fields so columns stay aligned", () => {
    expect(splitCell("a,,c", comma)).toEqual(["a", "", "c"]);
    expect(splitCell(",b", comma)).toEqual(["", "b"]);
    expect(splitCell("a,", comma)).toEqual(["a", ""]);
    expect(splitCell("", comma)).toEqual([""]);
    expect(splitCell(",", comma)).toEqual(["", ""]);
  });

  it("honours quoted fields: the delimiter inside, a doubled quote, text after the closing quote", () => {
    expect(splitCell('"a,b",c', comma)).toEqual(["a,b", "c"]);
    expect(splitCell('x,"say ""hi""",y', comma)).toEqual(["x", 'say "hi"', "y"]);
    expect(splitCell('"a",', comma)).toEqual(["a", ""]);
    expect(splitCell('"",b', comma)).toEqual(["", "b"]);
    expect(splitCell('"a"b,c', comma)).toEqual(["ab", "c"]);
    expect(splitCell('"unterminated,b', comma)).toEqual(["unterminated,b"]);
  });

  it("a quote in the middle of a field is ordinary text; quoting can be switched off", () => {
    expect(splitCell('a"b,c', comma)).toEqual(['a"b', "c"]);
    expect(splitCell('"a,b",c', { ...comma, quote: false })).toEqual(['"a', 'b"', "c"]);
  });

  it("trims spaces by default and leaves them when asked", () => {
    expect(splitCell(" a , b ", comma)).toEqual(["a", "b"]);
    expect(splitCell(" a , b ", { ...comma, trim: false })).toEqual([" a ", " b "]);
  });

  it("merging repeated delimiters drops the empty pieces", () => {
    expect(splitCell("  a   b ", { delimiter: "space", merge: true })).toEqual(["a", "b"]);
    expect(splitCell("a,,c", { ...comma, merge: true })).toEqual(["a", "c"]);
  });
});

describe("splitCells", () => {
  it("pads ragged rows to the widest", () => {
    expect(splitCells(["a,b,c", "d", "e,f"], comma)).toEqual({
      rows: [["a", "b", "c"], ["d", "", ""], ["e", "f", ""]],
      width: 3,
    });
  });
  it("no cells is width 0", () => {
    expect(splitCells([], comma)).toEqual({ rows: [], width: 0 });
  });
});

describe("classifyColumns", () => {
  it("a column of numbers (blanks missing) is numeric; anything else stays text", () => {
    const t = splitCells(["1,x,", "2.5,y,", ",3,"], comma);
    const c = classifyColumns(t);
    expect(c[0]).toEqual({ numeric: true, values: [1, 2.5, Number.NaN] });
    expect(c[1]).toEqual({ numeric: false, text: ["x", "y", "3"] });
    expect(c[2]).toEqual({ numeric: false, text: ["", "", ""] }); // nothing in it: not a number column
  });
  it("one non-number makes the whole column text: nothing is coerced to NaN", () => {
    expect(classifyColumns(splitCells(["1", "2", "n/a"], comma))[0]).toEqual({ numeric: false, text: ["1", "2", "n/a"] });
  });
});

describe("textToColumnsData", () => {
  const data = (over: Partial<DataStruct> = {}): DataStruct => ({
    time: [0, 1, 2],
    values: [[10], [20], [30]],
    labels: ["M"],
    units: ["emu"],
    metadata: { origin_text_columns: { Note: ["1,a", "2,b", "3,c"], Other: ["x", "y", "z"] } },
    ...over,
  });
  const run = (d = data(), cells = ["1,a", "2,b", "3,c"], o = comma) => textToColumnsData(d, cells, "Note", "Note", "origin_text_columns", o);

  it("appends numeric pieces as value columns and text pieces as text columns, touching nothing else", () => {
    const { data: out, created, numeric } = run();
    expect(created).toBe(2);
    expect(numeric).toBe(1);
    expect(out.labels).toEqual(["M", "Note 1"]);
    expect(out.units).toEqual(["emu", ""]);
    expect(out.values).toEqual([[10, 1], [20, 2], [30, 3]]);
    expect(out.time).toEqual([0, 1, 2]);
    const text = out.metadata.origin_text_columns as Record<string, string[]>;
    expect(text.Note).toEqual(["1,a", "2,b", "3,c"]); // the source text column is kept
    expect(text.Other).toEqual(["x", "y", "z"]);
    expect(text.Note_2).toEqual(["a", "b", "c"]);
    expect((out.metadata.origin_text_column_labels as Record<string, { long_name: string }>).Note_2.long_name).toBe("Note 2");
    expect(out.metadata.worksheet_transform).toBe("text-to-columns");
  });

  it("does not mutate its input", () => {
    const d = data();
    const before = JSON.stringify(d);
    run(d);
    expect(JSON.stringify(d)).toBe(before);
  });

  it("writes to the sidecar key the source uses", () => {
    const d = data({ metadata: { text_columns: { Note: ["1,a", "2,b", "3,c"] } } });
    const out = textToColumnsData(d, ["1,a", "2,b", "3,c"], "Note", "Note", "text_columns", comma).data;
    expect((out.metadata.text_columns as Record<string, string[]>).Note_2).toEqual(["a", "b", "c"]);
    expect(out.metadata.origin_text_columns).toBeUndefined();
  });

  it("a new column never reuses an existing label", () => {
    const out = run(data({ labels: ["Note 1"], units: [""] })).data;
    expect(out.labels).toEqual(["Note 1", "Note 1 (2)"]);
  });

  it("more text rows than numeric rows pads the numbers with missing values", () => {
    const out = run(data({ time: [0], values: [[10]] })).data;
    expect(out.time).toEqual([0, Number.NaN, Number.NaN]);
    expect(out.values[2]).toEqual([Number.NaN, 3]);
  });

  it("refuses an empty column, a missing delimiter and a runaway split with a sentence", () => {
    expect(() => run(data(), [])).toThrow(/no text/);
    expect(() => run(data(), ["a"], { delimiter: "custom", custom: "" })).toThrow(/delimiter/);
    expect(() => run(data(), ["x".repeat(100).split("").join(",")])).toThrow(/limit is 64/);
  });
});
