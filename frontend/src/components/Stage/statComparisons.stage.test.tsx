// Significance marks end to end on the real stage pieces (gap audit 8 lane
// SIG): the controls write the persisted choice, the footnote on screen names
// the test and correction, and the export request carries the SAME laid-out
// marks and its own footnote text.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveStatMarks } from "../../lib/statMarks";
import { boxStatsClient } from "../../lib/statstage";
import type { DataStruct } from "../../lib/types";
import StatMarksControls from "./StatMarksControls";
import type { StatDrawData } from "./statRender";
import { exportStatStage, type StatStageExportInputs } from "./statStageExport";
import { layoutComparisons } from "./statCompareLayout";
import { buildComparisons } from "../../lib/statComparisons";

const { exportStatplotFigure } = vi.hoisted(() => ({ exportStatplotFigure: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../lib/api/figures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api/figures")>()),
  exportStatplotFigure,
}));

describe("controls", () => {
  const setup = (over: Parameters<typeof resolveStatMarks>[1] = {}, comparisons = { error: null as string | null, labels: ["a", "b"] }) => {
    const setMarks = vi.fn();
    render(<StatMarksControls mode="box" marks={resolveStatMarks("box", over)} setMarks={setMarks} grouped comparisons={comparisons} />);
    return setMarks;
  };

  it("is off by default and offers only the one picker", () => {
    setup();
    expect((screen.getByLabelText("significance marks") as HTMLSelectElement).value).toBe("off");
    expect(screen.queryByLabelText("comparison test")).toBeNull();
    expect(screen.queryByText("exact p")).toBeNull();
  });

  it("writes the choice as one patch", () => {
    const setMarks = setup();
    fireEvent.change(screen.getByLabelText("significance marks"), { target: { value: "brackets" } });
    expect(setMarks).toHaveBeenCalledWith({ comparisons: "brackets" }, "set significance marks");
  });

  it("shows the test, the exact-p toggle for brackets, and the Dunnett control picker", () => {
    const setMarks = setup({ comparisons: "brackets", compareMethod: "dunnett" });
    expect((screen.getByLabelText("comparison test") as HTMLSelectElement).value).toBe("dunnett");
    fireEvent.change(screen.getByLabelText("Dunnett control group"), { target: { value: "b" } });
    expect(setMarks).toHaveBeenCalledWith({ compareControl: "b" }, "set comparison control");
    expect(screen.getByText("exact p")).toBeTruthy();
  });

  it("hides exact p for letters and says why nothing is drawn", () => {
    setup({ comparisons: "letters" }, { error: "Comparisons are not drawn on faceted plots", labels: [] });
    expect(screen.queryByText("exact p")).toBeNull();
    expect(screen.getByTestId("stat-compare-error").textContent).toContain("faceted");
  });

  it("does not show the error while the option is off", () => {
    setup({}, { error: "x", labels: [] });
    expect(screen.queryByTestId("stat-compare-error")).toBeNull();
  });

  it("is absent where the stage offers none (no comparisons prop)", () => {
    render(<StatMarksControls mode="box" marks={resolveStatMarks("box", {})} setMarks={vi.fn()} grouped />);
    expect(screen.queryByLabelText("significance marks")).toBeNull();
  });
});

describe("export", () => {
  beforeEach(() => exportStatplotFigure.mockClear());
  const groups = [{ label: "a", values: [1, 2, 3] }, { label: "b", values: [4, 5, 6] }, { label: "c", values: [9, 10, 11] }];
  const boxes = groups.map((g) => ({ ...boxStatsClient(g.values), label: g.label }));
  const base: StatDrawData = { mode: "box", boxes, valueLabel: "y", groupLabel: "g", marks: resolveStatMarks("box", {}) };
  const r = buildComparisons("tukey", "brackets", false, [2, 5, 10], [{ a: 0, b: 2, p: 0.001 }], null);
  if ("error" in r) throw new Error(r.error);
  const marks = layoutComparisons(base as Extract<StatDrawData, { mode: "box" }>, r, [0, 1, 2]);

  const inputs = (draw: StatDrawData): StatStageExportInputs => ({
    data: {} as DataStruct, mode: "box", draw, drawFacets: null, groups, indexedGroups: [], valueCol: 0, valueLabel: "y",
    groupLabel: "g", barValueLabel: "y", barStack: false, dist: "norm", bins: "fd", fit: null,
    marks: resolveStatMarks("box", {}), errorNote: "Error bars: SD",
  });

  it("posts the laid-out marks verbatim, the canvas domain that holds them, and no comparison text in error_note", async () => {
    await exportStatStage("svg", inputs({ ...base, comparisons: marks } as StatDrawData));
    const spec = exportStatplotFigure.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(spec.comparisons).toEqual(marks);
    expect(spec.error_note).toBe("Error bars: SD");
    expect((spec.y_domain as number[])[1]).toBeGreaterThanOrEqual(marks.top);
  });

  it("posts none when the draw carries none", async () => {
    await exportStatStage("svg", inputs(base));
    const spec = exportStatplotFigure.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect("comparisons" in spec).toBe(false);
  });
});
