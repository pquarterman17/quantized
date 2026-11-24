// UX menus audit M10: the result-table right-click menu.

import { describe, expect, it, vi } from "vitest";

import type { AnalysisResultTable } from "../../../lib/analysisResult";
import { tableMenuItems, type TableMenuSpec } from "./tableMenu";

const table: AnalysisResultTable = { title: "Wafer effect", columns: ["a", "b"], rows: [[1, 2]] };
const spec = (extra: Partial<TableMenuSpec> = {}): TableMenuSpec => ({
  title: "Wafer effect",
  copy: { run: vi.fn(), blocked: null },
  report: { run: vi.fn(), blocked: null },
  open: { run: vi.fn(), blocked: null },
  csvTable: () => table,
  csvBlocked: null,
  ...extra,
});
type Row = { label: string; disabled?: boolean; title?: string; run: () => void };
const rows = (s: TableMenuSpec) => tableMenuItems(s, vi.fn()).filter((i): i is Row => "label" in i && "run" in i);

describe("tableMenuItems", () => {
  it("offers copy, CSV copy/export, send to report and open as worksheet", () => {
    expect(rows(spec()).map((r) => r.label)).toEqual(["Copy table", "Copy as CSV", "Export CSV…", "Send to report", "Open as worksheet"]);
  });

  it("carries the reason on every withheld item", () => {
    const why = "Save the result first; this table is then sent from the saved result.";
    const items = rows(spec({ report: { run: vi.fn(), blocked: why }, open: { run: vi.fn(), blocked: why } }));
    const byLabel = Object.fromEntries(items.map((r) => [r.label, r]));
    expect(byLabel["Send to report"]).toMatchObject({ disabled: true, title: why });
    expect(byLabel["Open as worksheet"]).toMatchObject({ disabled: true, title: why });
    expect(byLabel["Copy table"].disabled).toBe(false);
  });

  it("disables the CSV items with a reason while the table is unavailable", () => {
    const items = rows(spec({ csvTable: () => null }));
    for (const label of ["Copy as CSV", "Export CSV…"]) {
      const row = items.find((r) => r.label === label)!;
      expect(row.disabled).toBe(true);
      expect(row.title).toBeTruthy();
    }
  });

  it("runs the supplied actions", () => {
    const s = spec();
    rows(s).find((r) => r.label === "Send to report")!.run();
    expect(s.report.run).toHaveBeenCalledTimes(1);
  });
});
