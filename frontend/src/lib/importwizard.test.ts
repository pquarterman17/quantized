import { describe, expect, it } from "vitest";

import {
  composeColumnLabel,
  defaultFilterName,
  defaultGlob,
  fileExtension,
  parseLineField,
  withColumnName,
  withColumnUnit,
  withRole,
} from "./importwizard";
import type { ImportPreviewColumn } from "./types";

const cols: ImportPreviewColumn[] = [
  { index: 0, name: "Temp", unit: "K", role: "x" },
  { index: 1, name: "Moment", unit: "emu", role: "y" },
];

describe("fileExtension / defaultFilterName / defaultGlob", () => {
  it("extracts the extension including the dot", () => {
    expect(fileExtension("run1.DAT")).toBe(".DAT");
    expect(fileExtension("noext")).toBe("");
  });

  it("defaults the filter name to the filename without its extension", () => {
    expect(defaultFilterName("XYZ9000_run1.dat")).toBe("XYZ9000_run1");
    expect(defaultFilterName("noext")).toBe("noext");
  });

  it("defaults the glob to every file sharing the extension", () => {
    expect(defaultGlob("XYZ9000_run1.dat")).toBe("*.dat");
    expect(defaultGlob("noext")).toBe("*");
  });
});

describe("composeColumnLabel", () => {
  it("combines name + unit into the backend's parenthesized syntax", () => {
    expect(composeColumnLabel("Temp", "K")).toBe("Temp (K)");
  });

  it("drops the parens when the unit is blank", () => {
    expect(composeColumnLabel("Temp", "")).toBe("Temp");
    expect(composeColumnLabel("Temp", "   ")).toBe("Temp");
  });

  it("falls back to a placeholder for a blank name", () => {
    expect(composeColumnLabel("  ", "K")).toBe("Col (K)");
  });
});

describe("withRole / withColumnName / withColumnUnit", () => {
  it("sets one column's role, from the preview's resolved roles", () => {
    expect(withRole(cols, 1, "error")).toEqual(["x", "error"]);
  });

  it("renames one column, composing its existing unit back in — and leaves the other column's unit intact", () => {
    expect(withColumnName(cols, 0, "Temperature")).toEqual(["Temperature (K)", "Moment (emu)"]);
  });

  it("re-units one column, composing its existing name back in — and leaves the other column's name intact", () => {
    expect(withColumnUnit(cols, 0, "C")).toEqual(["Temp (C)", "Moment (emu)"]);
  });
});

describe("parseLineField", () => {
  it("blank -> null", () => {
    expect(parseLineField("")).toBeNull();
    expect(parseLineField("   ")).toBeNull();
  });

  it("parses a finite integer, truncating any fraction", () => {
    expect(parseLineField("3")).toBe(3);
    expect(parseLineField("3.7")).toBe(3);
  });

  it("an in-progress non-numeric edit -> null (no crash)", () => {
    expect(parseLineField("-")).toBeNull();
  });
});
