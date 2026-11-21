import { describe, expect, it } from "vitest";

import { clockCell, offersUnwrap, timeFormatOptions, withTimeFormat } from "./importTimeFormats";
import type { ImportPreviewColumn } from "./types";

const TIME: ImportPreviewColumn = { index: 0, name: "Time", unit: "", role: "label", time_kind: "clock", time_format: "text" };
const TEMP: ImportPreviewColumn = { index: 1, name: "Temp", unit: "K", role: "x" };

describe("timeFormatOptions", () => {
  it("offers the four Excel-style formats for a clock column, time of day first", () => {
    expect(timeFormatOptions("clock").map((o) => o.value)).toEqual(["clock", "seconds", "elapsed", "text"]);
  });

  it("never offers a time of day for a duration", () => {
    expect(timeFormatOptions("duration").map((o) => o.value)).toEqual(["seconds", "elapsed", "text"]);
  });
});

describe("withTimeFormat", () => {
  it("records the format raw-column aligned, null elsewhere", () => {
    expect(withTimeFormat([TIME, TEMP], 0, "clock").time_formats).toEqual(["clock", null]);
  });

  it("a text column turned numeric becomes y when another column is x", () => {
    expect(withTimeFormat([TIME, TEMP], 0, "seconds").roles).toEqual(["y", "x"]);
  });

  it("becomes x when no column is", () => {
    expect(withTimeFormat([TIME, { ...TEMP, role: "y" }], 0, "clock").roles).toEqual(["x", "y"]);
  });

  it("a numeric column turned text becomes a label; an ignored one stays ignored", () => {
    const x = { ...TIME, role: "x" as const, time_format: "clock" as const };
    expect(withTimeFormat([x, { ...TEMP, role: "y" }], 0, "text").roles).toEqual(["label", "y"]);
    expect(withTimeFormat([{ ...TIME, role: "ignore" }, TEMP], 0, "clock").roles).toEqual(["ignore", "x"]);
  });
});

describe("offersUnwrap", () => {
  it("only while a clock column reads as numbers", () => {
    expect(offersUnwrap([TIME, TEMP])).toBe(false);
    expect(offersUnwrap([{ ...TIME, time_format: "elapsed" }, TEMP])).toBe(true);
    expect(offersUnwrap([{ ...TIME, time_kind: "duration", time_format: "seconds" }, TEMP])).toBe(false);
  });
});

describe("clockCell", () => {
  it("shows the clock time a cell holds, never a date", () => {
    expect(clockCell(45001)).toBe("12:30:01");
    expect(clockCell(45001.25)).toBe("12:30:01.250");
    expect(clockCell(86400 + 1)).toBe("00:00:01"); // unwrapped past midnight
    expect(clockCell(null)).toBe("");
    expect(clockCell(Number.NaN)).toBe("");
  });
});
