import { describe, expect, it } from "vitest";

import { countLines, guessDelimiter, highlightDelimiter, inWizard, lineIndex, rawLines } from "./importRawLines";

describe("importRawLines", () => {
  it("splits any line ending, drops a trailing newline, caps at the limit", () => {
    expect(rawLines("a\r\nb\rc\n")).toEqual(["a", "b", "c"]);
    expect(rawLines("")).toEqual([]);
    expect(rawLines("1\n2\n3\n4\n", 2)).toEqual(["1", "2"]);
    expect(countLines("1\n2\n3\n4\n")).toBe(4);
    expect(countLines("1\n2")).toBe(2);
    expect(countLines("")).toBe(0);
  });

  it("breaks lines where Python's splitlines() does, and drops a BOM, so numbering matches the backend", () => {
    expect(rawLines("\ufeffa\fb\u2028c\x85d\ve")).toEqual(["a", "b", "c", "d", "e"]);
    expect(countLines("a\fb\u2029")).toBe(2);
    expect(countLines("\ufeff")).toBe(0);
  });

  it("guesses ';' over the decimal commas inside its cells, and tab first", () => {
    expect(guessDelimiter(["T;R", "2,000;0,00527", "3,000;0,00611"])).toBe(";");
    expect(guessDelimiter(["a\tb,c", "1\t2,5"])).toBe("\t");
    expect(guessDelimiter(["# comment, here", "x,y", "1,2"])).toBe(",");
    expect(guessDelimiter(["1 2 3", "4 5 6"])).toBeNull();
    // A ragged preamble line: the delimiter on most lines.
    expect(guessDelimiter(["Run 7", "x|y", "1|2", "3|4"])).toBe("|");
  });

  it("prefers the preview's delimiter, then the setting, then the guess", () => {
    expect(highlightDelimiter(",", "auto", ["a;b"])).toBe(",");
    expect(highlightDelimiter(" ", "auto", ["a b"])).toBeNull();
    expect(highlightDelimiter(null, "semicolon", ["a,b"])).toBe(";");
    expect(highlightDelimiter(null, "whitespace", ["a,b"])).toBeNull();
    expect(highlightDelimiter(null, "auto", ["a;b", "1;2"])).toBe(";");
  });

  it("maps a 1-based line field to the wire's 0-based index, rejecting 0 and negatives", () => {
    expect(lineIndex("1")).toBe(0);
    expect(lineIndex("12")).toBe(11);
    expect(lineIndex("0")).toBeNull();
    expect(lineIndex("-3")).toBeNull();
    expect(lineIndex("")).toBeNull();
  });

  it("does not send the user to the wizard they are in", () => {
    expect(inWizard("pick the decimal separator (Point or Comma) in the Import Wizard.")).toBe(
      "pick the decimal separator (Point or Comma) above.",
    );
  });
});
