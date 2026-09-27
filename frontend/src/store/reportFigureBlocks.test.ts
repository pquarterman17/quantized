// `updateReportSheet` (P3.6) — the one report action that records history:
// the single write path for block edits (a figure sent from a plot, a block
// moved or removed in the viewer). Pins: exactly one labelled undo entry per
// call, the updater sees the LIVE sheet, undo/redo restore it, only the named
// report's sheet changes, and an unknown id or a `null` edit is a true no-op
// (no history either).

import { beforeEach, describe, expect, it } from "vitest";

import type { ReportEntry, ReportSheet } from "../lib/report";
import { useApp } from "./useApp";

const sheet = (text: string): ReportSheet => ({ title: "t", sections: [{ title: "S", blocks: [{ type: "text", text }] }] });
const entry = (id: string, text: string): ReportEntry => ({ id, name: id, datasetId: null, report: sheet(text) });

beforeEach(() => {
  useApp.setState({
    reports: [entry("rep-a", "a"), entry("rep-b", "b")],
    openReportId: null,
    history: [],
    future: [],
    status: "",
  });
});

describe("updateReportSheet", () => {
  it("replaces only the named report's sheet, as ONE labelled undo step", () => {
    const b = useApp.getState().reports[1];
    expect(useApp.getState().updateReportSheet("rep-a", () => sheet("A2"), "move report block")).toBe(true);
    const s = useApp.getState();
    expect(s.reports[0]).toEqual({ ...entry("rep-a", "a"), report: sheet("A2") });
    expect(s.reports[1]).toBe(b);
    expect(s.history.map((h) => h.label)).toEqual(["move report block"]);
  });

  it("undo restores the previous sheet; redo re-applies it", () => {
    useApp.getState().updateReportSheet("rep-a", () => sheet("A2"), "remove report block");
    useApp.getState().undo();
    expect(useApp.getState().reports[0].report).toEqual(sheet("a"));
    useApp.getState().redo();
    expect(useApp.getState().reports[0].report).toEqual(sheet("A2"));
  });

  it("the updater runs on the live sheet, so back-to-back edits compose", () => {
    const append = (text: string) => (r: ReportSheet): ReportSheet => ({
      ...r,
      sections: [{ ...r.sections[0], blocks: [...r.sections[0].blocks, { type: "text", text }] }],
    });
    useApp.getState().updateReportSheet("rep-a", append("x"), "edit");
    useApp.getState().updateReportSheet("rep-a", append("y"), "edit");
    const texts = useApp.getState().reports[0].report.sections[0].blocks.map((b) => (b.type === "text" ? b.text : ""));
    expect(texts).toEqual(["a", "x", "y"]);
    expect(useApp.getState().history).toHaveLength(2);
  });

  it("an unknown id or a null edit changes nothing and records nothing", () => {
    const before = useApp.getState().reports;
    expect(useApp.getState().updateReportSheet("rep-gone", () => sheet("x"), "move report block")).toBe(false);
    expect(useApp.getState().updateReportSheet("rep-a", () => null, "move report block")).toBe(false);
    expect(useApp.getState().reports).toBe(before);
    expect(useApp.getState().history).toEqual([]);
  });
});
