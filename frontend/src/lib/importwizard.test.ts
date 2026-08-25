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
  xRoleColumns,
  xRoleConflictMessage,
} from "./importwizard";
import type { ImportFilterWire, ImportPreviewColumn, ImportPreviewResponse } from "./types";

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

  it("P1-5 DEFECT 2: uses effective_name (the post-label_line name) over the raw header name when present", () => {
    // RED before the fix: finalChannelOrder read `c.name` -- the raw header
    // text -- even though preview_import's `effective_name` is the name the
    // dataset will actually carry once label_line overrides apply.
    const cs: ImportPreviewColumn[] = [
      { index: 0, name: "Temp", effective_name: "Temp", unit: "K", role: "x" },
      { index: 1, name: "M1", effective_name: "NbAu-1", unit: "emu", role: "y" },
    ];
    expect(finalChannelOrder(cs).map((c) => c.label)).toEqual(["NbAu-1"]);
  });

  it("falls back to name when effective_name is absent (older/mocked previews)", () => {
    const cs: ImportPreviewColumn[] = [
      { index: 0, name: "Temp", unit: "K", role: "x" },
      { index: 1, name: "M1", unit: "emu", role: "y" },
    ];
    expect(finalChannelOrder(cs).map((c) => c.label)).toEqual(["M1"]);
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

  it("P1-5 DEFECT 2: classifies against effective_name, not the raw header name, when label_line overrides it", () => {
    // RED before the fix: the raw header names ("Col2"/"Col3") share no
    // base-name relationship at all, so the OLD name-only classifier finds
    // nothing -- but the label_line-overridden effective_names ("R"/"dR")
    // are an unambiguous base-name pairing, exactly the name the dataset
    // will actually carry once imported.
    const cs: ImportPreviewColumn[] = [
      { index: 0, name: "Col1", effective_name: "Temp", unit: "K", role: "x" },
      { index: 1, name: "Col2", effective_name: "R", unit: "", role: "y" },
      { index: 2, name: "Col3", effective_name: "dR", unit: "", role: "error" },
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

  // P1.6 review round P1-1: the reviewer's exact probe. inferErrorBindingsFromLabels'
  // rule 3 ("nearest preceding value column") has no forward awareness at all, so it
  // ALWAYS binds "T err" to "T1" even though "T2" is an equally plausible candidate
  // sitting right after it -- contradicting the wizard's own "ambiguous -> ABSENT"
  // claim. RULING: demote a rule-3-ONLY (no base-name match, no explicit x prefix)
  // suggestion to unassigned when another non-error channel ALSO follows the error
  // column -- surgical, in this wizard-seeding layer only; inferErrorBindingsFromLabels
  // itself (errorRoles.test.ts) is untouched and still binds T1 for its own callers.
  it("demotes a MULTI-CANDIDATE position-only (rule 3) pairing to unassigned — T1(y), 'T err'(error), T2(y)", () => {
    const cs: ImportPreviewColumn[] = [
      { index: 0, name: "T1", unit: "", role: "y" },
      { index: 1, name: "T err", unit: "", role: "error" },
      { index: 2, name: "T2", unit: "", role: "y" },
    ];
    expect(suggestErrorBindings(cs)).toEqual([]);
  });

  it("keeps a SINGLE-CANDIDATE position-only pairing as a real suggestion — value columns only precede, nothing follows", () => {
    const cs: ImportPreviewColumn[] = [
      { index: 0, name: "Temp", unit: "K", role: "x" },
      { index: 1, name: "M", unit: "", role: "y" },
      { index: 2, name: "err", unit: "", role: "error" },
    ];
    expect(suggestErrorBindings(cs)).toEqual([{ channel: 1, target: 0, axis: "y", side: "both" }]);
  });

  it("a base-name match (rule 1) is never demoted, even with a plausible column following", () => {
    const cs: ImportPreviewColumn[] = [
      { index: 0, name: "R", unit: "", role: "y" },
      { index: 1, name: "dR", unit: "", role: "error" },
      { index: 2, name: "M", unit: "", role: "y" }, // follows -- but dR->R is name-driven, not positional
    ];
    expect(suggestErrorBindings(cs)).toEqual([{ channel: 1, target: 0, axis: "y", side: "both" }]);
  });

  it("an explicit x-prefix (rule 2) is never demoted either", () => {
    const cs: ImportPreviewColumn[] = [
      { index: 0, name: "Signal", unit: "", role: "y" },
      { index: 1, name: "xerr", unit: "", role: "error" },
      { index: 2, name: "M", unit: "", role: "y" }, // follows
    ];
    expect(suggestErrorBindings(cs)[0]).toMatchObject({ channel: 1, target: -1, axis: "x" });
  });

  it("a following ERROR-role column (not a value column) does not itself trigger demotion", () => {
    const cs: ImportPreviewColumn[] = [
      { index: 0, name: "T1", unit: "", role: "y" },
      { index: 1, name: "err1", unit: "", role: "error" },
      { index: 2, name: "err2", unit: "", role: "error" },
    ];
    // err1's only follower (err2) is ANOTHER error column, not a plausible
    // value target -- err1 stays a real suggestion despite the "something
    // follows" surface shape. (err2 also survives on its own merits: it has
    // no follower at all, the single-candidate case.)
    const bindings = suggestErrorBindings(cs);
    expect(bindings.find((b) => b.channel === 1)).toEqual({ channel: 1, target: 0, axis: "y", side: "both" });
  });

  it("a following CATEGORICAL column (not a plausible numeric target) does not itself trigger demotion", () => {
    const cs: ImportPreviewColumn[] = [
      { index: 0, name: "T", unit: "", role: "y" },
      { index: 1, name: "err", unit: "", role: "error" },
      { index: 2, name: "Sample", unit: "", role: "categorical" },
    ];
    // `err`'s only positional pairing (rule 3) is `T`; nothing name-driven
    // is available (bare "err" has no base to match). `finalChannelOrder`
    // moves `Sample` after every numeric column regardless of its raw
    // position, but a categorical (text) column is never something error
    // bars could sensibly attach to -- it must not count as "something
    // plausible follows" and demote an otherwise-unambiguous suggestion.
    expect(suggestErrorBindings(cs)).toEqual([{ channel: 1, target: 0, axis: "y", side: "both" }]);
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

function previewOf(
  columns: ImportPreviewColumn[],
  overrides: Partial<ImportPreviewResponse> = {},
): ImportPreviewResponse {
  return {
    raw_lines: [],
    n_lines: 0,
    delimiter: ",",
    header_line: null,
    units_line: null,
    label_line: null,
    data_start_line: 1,
    columns,
    rows: [],
    n_data_rows: 0,
    n_preview_rows: 0,
    comments: [],
    ...overrides,
  };
}

describe("resolveImportFilter (P1.6 item 4, mirrors the H-template refusal shape)", () => {
  const matching: ImportPreviewColumn[] = [
    { index: 0, name: "Temp", unit: "K", role: "x" },
    { index: 1, name: "Moment", unit: "emu", role: "y" },
  ];
  // filter()'s header_line is 0 -- naturalDataStart must sit safely past
  // that for these count/name-focused tests to isolate what they test.
  const FAR_DATA_START = 10;

  it("ok when every saved column name still matches its position", () => {
    expect(resolveImportFilter(filter(), previewOf(matching), FAR_DATA_START)).toEqual({ ok: true });
  });

  it("refuses on a column-count mismatch, naming the counts", () => {
    const fewer = [matching[0]];
    const r = resolveImportFilter(filter(), previewOf(fewer), FAR_DATA_START);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/2 columns.*1 column\b(?!s)/);
  });

  it("refuses on a name mismatch, naming the specific column (never a partial apply)", () => {
    const shifted: ImportPreviewColumn[] = [
      { index: 0, name: "Field", unit: "Oe", role: "x" },
      { index: 1, name: "Moment", unit: "emu", role: "y" },
    ];
    const r = resolveImportFilter(filter(), previewOf(shifted), FAR_DATA_START);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.unmatched).toEqual([`column 1 ("Temp" → "Field")`]);
    expect(r.reason).toContain("Temp");
  });

  it("a filter with no saved column_names only checks count", () => {
    const noNames = filter({ column_names: null });
    expect(resolveImportFilter(noNames, previewOf(matching), FAR_DATA_START)).toEqual({ ok: true });
    expect(resolveImportFilter(noNames, previewOf([matching[0]]), FAR_DATA_START).ok).toBe(false);
  });
});

// P1.6 review round P1-2: the reviewer's exact two-file probe. fileA's saved
// settings (label_line=1, data_start_line=2) reapplied to fileB, which lacks
// fileA's extra label row, consumed fileB's own first REAL DATA ROW as the
// "label" row instead of importing it -- silent corruption, ok:true before
// this fix (column count/names alone can't catch it: both files have the
// same 2 columns, and this filter's column_names is null). RULING: refuse
// when a saved header/units/label line lands at-or-past where THIS file's
// data actually starts (an INDEPENDENT guess, ignoring the candidate
// filter), and/or when the saved label_line row itself parses as numeric
// data in this file.
describe("resolveImportFilter — line-position sanity (P1.6 review P1-2)", () => {
  const fileAFilter = filter({
    header_line: 0,
    label_line: 1,
    data_start_line: 2,
    column_names: null, // a bare line-position filter -- exactly what escaped the count/name checks
    roles: ["x", "y"],
  });

  it("refuses when the saved label_line lands at-or-past this file's own natural data start", () => {
    // fileB: "Temp,Moment\n1,10\n2,20\n" -- naturally starts data at line 1,
    // one line earlier than fileA (which had the extra label row at line 1).
    const fileBFresh = previewOf(
      [
        { index: 0, name: "Temp", unit: "", role: "x" },
        { index: 1, name: "Moment", unit: "", role: "y" },
      ],
      { raw_lines: ["Temp,Moment", "1,10", "2,20"], delimiter: ",", header_line: 0, label_line: 1, data_start_line: 2 },
    );
    const r = resolveImportFilter(fileAFilter, fileBFresh, /* naturalDataStart */ 1);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("label");
    expect(r.reason).toContain("line 1");
  });

  it("also catches it via the numeric-row heuristic even if a data-start guess somehow missed it", () => {
    const fileBFresh = previewOf(
      [
        { index: 0, name: "Temp", unit: "", role: "x" },
        { index: 1, name: "Moment", unit: "", role: "y" },
      ],
      { raw_lines: ["Temp,Moment", "1,10", "2,20"], delimiter: ",", label_line: 1 },
    );
    // Pass a naturalDataStart that does NOT trip the position check (past
    // label_line=1) to isolate the numeric-row heuristic on its own.
    const r = resolveImportFilter(fileAFilter, fileBFresh, /* naturalDataStart */ 5);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("numeric");
  });

  it("still applies cleanly when the saved label_line genuinely IS a text row in this file", () => {
    // fileA reapplied to a file shaped just like it: header(0), label(1), data(2+).
    const properFresh = previewOf(
      [
        { index: 0, name: "Temp", unit: "", role: "x" },
        { index: 1, name: "Moment", unit: "", role: "y" },
      ],
      { raw_lines: ["Temp,Moment", "NbAu-1,", "1,10", "2,20"], delimiter: ",", header_line: 0, label_line: 1, data_start_line: 2 },
    );
    expect(resolveImportFilter(fileAFilter, properFresh, /* naturalDataStart */ 2)).toEqual({ ok: true });
  });

  it("an out-of-range label_line (no row there in this shorter file) safely no-ops, not a false refusal", () => {
    const shortFresh = previewOf(
      [{ index: 0, name: "Temp", unit: "", role: "x" }],
      { raw_lines: ["Temp"], delimiter: ",", header_line: 0 },
    );
    const outOfRangeFilter = filter({ header_line: 0, label_line: 50, data_start_line: 1, column_names: null, roles: ["x"] });
    // naturalDataStart set past label_line so the position check doesn't
    // fire either -- isolates the "no row there" numeric-heuristic guard.
    expect(resolveImportFilter(outOfRangeFilter, shortFresh, 100).ok).toBe(true);
  });
});

// ── P1-5 DEFECT 1: multi-x validation ────────────────────────────────────────

describe("xRoleConflictMessage", () => {
  it("is null when zero or one column is marked x", () => {
    expect(xRoleConflictMessage([])).toBeNull();
    expect(
      xRoleConflictMessage([
        { index: 0, name: "Temp", unit: "K", role: "x" },
        { index: 1, name: "M", unit: "", role: "y" },
      ]),
    ).toBeNull();
  });

  it("names every column currently marked x when more than one is selected", () => {
    const cs: ImportPreviewColumn[] = [
      { index: 0, name: "Temp", unit: "K", role: "x" },
      { index: 1, name: "Field", unit: "Oe", role: "x" },
      { index: 2, name: "M", unit: "", role: "y" },
    ];
    const msg = xRoleConflictMessage(cs);
    expect(msg).not.toBeNull();
    expect(msg).toContain("Temp");
    expect(msg).toContain("Field");
  });

  it("xRoleColumns returns exactly the x-marked columns, in column order", () => {
    const cs: ImportPreviewColumn[] = [
      { index: 0, name: "Temp", unit: "K", role: "x" },
      { index: 1, name: "M", unit: "", role: "y" },
      { index: 2, name: "Field", unit: "Oe", role: "x" },
    ];
    expect(xRoleColumns(cs).map((c) => c.index)).toEqual([0, 2]);
  });
});
