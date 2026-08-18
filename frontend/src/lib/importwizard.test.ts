import { describe, expect, it } from "vitest";

import {
  composeColumnLabel,
  confirmedErrorBindings,
  defaultFilterName,
  defaultGlob,
  errorRoleChannels,
  errorTargetOptions,
  fileExtension,
  finalChannelOrder,
  parseLineField,
  resolveImportFilter,
  seedErrorRows,
  suggestErrorBindings,
  withColumnName,
  withColumnUnit,
  withRole,
} from "./importwizard";
import type { ImportFilterWire, ImportPreviewColumn } from "./types";

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

// ── P1.6 item 2: error-role suggestions ──────────────────────────────────────

describe("finalChannelOrder", () => {
  it("keeps y/error columns in original order, x/label/ignore excluded", () => {
    const cs: ImportPreviewColumn[] = [
      { index: 0, name: "Temp", unit: "K", role: "x" },
      { index: 1, name: "R", unit: "", role: "y" },
      { index: 2, name: "dR", unit: "", role: "error" },
      { index: 3, name: "Note", unit: "", role: "label" },
    ];
    expect(finalChannelOrder(cs)).toEqual([
      { channel: 0, sourceIndex: 1, label: "R" },
      { channel: 1, sourceIndex: 2, label: "dR" },
    ]);
  });

  it("appends categorical columns AFTER numeric ones (matches parse_import's ordering exactly)", () => {
    const cs: ImportPreviewColumn[] = [
      { index: 0, name: "Sample", unit: "", role: "categorical" },
      { index: 1, name: "Temp", unit: "K", role: "x" },
      { index: 2, name: "M", unit: "emu", role: "y" },
    ];
    expect(finalChannelOrder(cs).map((c) => c.label)).toEqual(["M", "Sample"]);
  });
});

describe("suggestErrorBindings (P1.6 item 2 — 'no guess can silently attach')", () => {
  it("suggests an unambiguous base-name pairing", () => {
    const cs: ImportPreviewColumn[] = [
      { index: 0, name: "Temp", unit: "K", role: "x" },
      { index: 1, name: "R", unit: "", role: "y" },
      { index: 2, name: "dR", unit: "", role: "error" },
    ];
    expect(suggestErrorBindings(cs)).toEqual([{ channel: 1, target: 0, axis: "y", side: "both" }]);
  });

  it("leaves a genuinely ambiguous error column with NO suggestion at all — never a guessed default", () => {
    // A leading "err" column has nothing defensible preceding it (same
    // fixture shape as errorRoles.test.ts's own "never silently forced"
    // pin) -- suggestErrorBindings must not invent a fallback target.
    const cs: ImportPreviewColumn[] = [
      { index: 0, name: "Temp", unit: "K", role: "x" },
      { index: 1, name: "err", unit: "", role: "error" },
      { index: 2, name: "M", unit: "", role: "y" },
    ];
    expect(suggestErrorBindings(cs)).toEqual([]);
  });
});

describe("errorRoleChannels / seedErrorRows / confirmedErrorBindings", () => {
  const cs: ImportPreviewColumn[] = [
    { index: 0, name: "Temp", unit: "K", role: "x" },
    { index: 1, name: "R", unit: "", role: "y" },
    { index: 2, name: "dR", unit: "", role: "error" },
    { index: 3, name: "M", unit: "", role: "y" },
    { index: 4, name: "err", unit: "", role: "error" }, // ambiguous — nothing defensible precedes it in name terms, but position-wise falls back to M
  ];

  it("errorRoleChannels lists only error-role channels, in final order", () => {
    expect(errorRoleChannels(cs).map((c) => c.label)).toEqual(["dR", "err"]);
  });

  it("seedErrorRows pre-fills an unambiguous suggestion and leaves a position-only fallback filled too (nearest-preceding rule)", () => {
    const rows = seedErrorRows(cs);
    expect(rows).toEqual([
      { channel: 1, label: "dR", target: 0, axis: "y", side: "both" }, // dR -> R by base name
      { channel: 3, label: "err", target: 2, axis: "y", side: "both" }, // err -> nearest preceding (M)
    ]);
  });

  it("seedErrorRows leaves target null for a column with NOTHING preceding it (the true ambiguous case)", () => {
    const leading: ImportPreviewColumn[] = [
      { index: 0, name: "err", unit: "", role: "error" },
      { index: 1, name: "M", unit: "", role: "y" },
    ];
    expect(seedErrorRows(leading)).toEqual([{ channel: 0, label: "err", target: null, axis: "y", side: "both" }]);
  });

  it("confirmedErrorBindings drops unassigned rows silently — never a guessed target reaches Dataset.errorRoles", () => {
    const rows = [
      { channel: 0, label: "dR", target: null, axis: "y" as const, side: "both" as const },
      { channel: 1, label: "err2", target: 2, axis: "y" as const, side: "both" as const },
    ];
    expect(confirmedErrorBindings(rows)).toEqual([{ channel: 1, target: 2, axis: "y", side: "both" }]);
  });

  it("errorTargetOptions offers the x axis plus every OTHER channel, never itself", () => {
    const opts = errorTargetOptions(cs, 1); // the "dR" channel (final channel 1)
    expect(opts.map((o) => o.value)).toEqual([-1, 0, 2, 3]); // x, "R", "M", "err" — not itself (1)
    expect(opts.some((o) => o.value === 1)).toBe(false);
  });
});

// ── P1.6 item 4: saved-filter refusal-with-explanation ───────────────────────

const filter = (over: Partial<ImportFilterWire["settings"]> = {}): ImportFilterWire => ({
  name: "xrd",
  glob: "*.xrd",
  updated: "2026-08-18T00:00:00Z",
  settings: {
    delimiter: ",",
    header_line: 0,
    units_line: null,
    label_line: null,
    data_start_line: 1,
    column_names: ["Temp (K)", "Moment (emu)"],
    roles: ["x", "y"],
    ...over,
  },
});

describe("resolveImportFilter (P1.6 item 4, mirrors the H-template refusal shape)", () => {
  const matching: ImportPreviewColumn[] = [
    { index: 0, name: "Temp", unit: "K", role: "x" },
    { index: 1, name: "Moment", unit: "emu", role: "y" },
  ];

  it("ok when every saved column name still matches its position", () => {
    expect(resolveImportFilter(filter(), matching)).toEqual({ ok: true });
  });

  it("refuses on a column-count mismatch, naming the counts", () => {
    const fewer = [matching[0]];
    const r = resolveImportFilter(filter(), fewer);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/2 columns.*1 column\b(?!s)/);
  });

  it("refuses on a name mismatch, naming the specific column (never a partial apply)", () => {
    const shifted: ImportPreviewColumn[] = [
      { index: 0, name: "Field", unit: "Oe", role: "x" },
      { index: 1, name: "Moment", unit: "emu", role: "y" },
    ];
    const r = resolveImportFilter(filter(), shifted);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.unmatched).toEqual([`column 1 ("Temp" → "Field")`]);
    expect(r.reason).toContain("Temp");
  });

  it("a filter with no saved column_names only checks count", () => {
    const noNames = filter({ column_names: null });
    expect(resolveImportFilter(noNames, matching)).toEqual({ ok: true });
    expect(resolveImportFilter(noNames, [matching[0]]).ok).toBe(false);
  });
});
