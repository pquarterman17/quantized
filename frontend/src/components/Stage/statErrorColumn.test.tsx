// Figures-audit #8 leftover: a Column/Bar chart whose whiskers come from a
// bound error COLUMN (a Sample,Value,SD summary table). The error-bar picker
// used to read "SE" while the bars drew the SD column and the footnote said
// "Error bars: SD (error column)". "From column" is now its own kind: the
// picker offers and shows it, a statistic never silently draws the column,
// and the canvas, the footnote and the export agree on every kind.

import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportCategoricalFigure } from "../../lib/api/figures";
import { errorBarNote, errorHalfWidth, resolveStatMarks } from "../../lib/statMarks";
import { sanitizeStatMarks } from "../../lib/plotviewSanitize";
import type { Dataset } from "../../lib/types";
import StatMarksControls from "./StatMarksControls";
import { barErrorHalf } from "./statDrawMarks";
import { withErrorColumn } from "./statStageMarks";
import { useStatStage } from "./useStatStage";

vi.mock("../../lib/api/figures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api/figures")>()),
  exportCategoricalFigure: vi.fn(),
}));

/** bar.csv as the CSV importer produces it (figuresAuditBar.test.ts). */
const BAR: Dataset = {
  id: "bar",
  name: "bar.csv",
  data: {
    time: [1, 2, 3, 4],
    values: [[3.2, 0.3, 0], [4.5, 0.4, 1], [2.1, 0.2, 2], [5.0, 0.6, 3]],
    labels: ["Value", "SD", "Sample"],
    units: ["", "", ""],
    metadata: {},
    cat_levels: { 2: ["A", "B", "C", "D"] },
  },
  errorRoles: [{ channel: 1, target: 0, axis: "y", side: "both" }],
};
// Hoisted: a fresh array per render would re-trigger the hook's compute effect forever.
const Y_KEYS = [0];
const params = () => ({ active: BAR, yKeys: Y_KEYS, xKey: null, seriesOrder: null, seed: null, onSeedConsumed: () => {} });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(exportCategoricalFigure).mockResolvedValue(undefined);
});

describe("error bars from a bound column — the model", () => {
  it("'column' draws the column's value; a statistic never silently does", () => {
    expect(errorHalfWidth("column", NaN, 1, 0.3)).toBe(0.3);
    expect(errorHalfWidth("column", 0.1, 4)).toBeNaN();
    expect(errorHalfWidth("se", NaN, 1, 0.3)).toBeNaN();
    expect(errorHalfWidth("sd", NaN, 1, 0.3)).toBeNaN();
  });

  it("only the 'column' kind names the column in the footnote", () => {
    expect(errorBarNote("column", "SD")).toBe("Error bars: SD (error column)");
    expect(errorBarNote("se", "SD")).toBe("Error bars: SE of the mean");
    expect(errorBarNote("column")).toMatch(/^[\x20-\x7e]+$/);
  });

  it("an unpicked bar kind defaults to the column when one is bound; a picked one is kept", () => {
    const bar = resolveStatMarks("bar", null);
    expect(withErrorColumn(bar, "bar", null, true).errorBars).toBe("column");
    expect(withErrorColumn(bar, "bar", null, false).errorBars).toBe("se");
    expect(withErrorColumn(resolveStatMarks("bar", { errorBars: "sd" }), "bar", { errorBars: "sd" }, true).errorBars).toBe("sd");
  });

  it("a stored 'column' with nothing to read falls back to the mode's default", () => {
    const stored = { errorBars: "column" as const };
    expect(sanitizeStatMarks(stored)).toEqual(stored);
    expect(withErrorColumn(resolveStatMarks("bar", stored), "bar", stored, false).errorBars).toBe("se");
    expect(withErrorColumn(resolveStatMarks("box", stored), "box", stored, true).errorBars).toBe("ci95");
  });
});

describe("error bars from a bound column — the picker", () => {
  it("offers and shows 'from column' when a column is bound, and not otherwise", () => {
    const setMarks = vi.fn();
    const marks = { ...resolveStatMarks("bar", null), errorBars: "column" as const };
    const { unmount } = render(<StatMarksControls mode="bar" marks={marks} setMarks={setMarks} grouped errorColumn="SD" />);
    const select = screen.getByRole("combobox", { name: "error bars" });
    expect(select).toHaveDisplayValue("from column");
    expect(select.getAttribute("title")).toMatch(/values of SD/);
    fireEvent.change(select, { target: { value: "se" } });
    expect(setMarks).toHaveBeenCalledWith({ errorBars: "se" }, "set error bars");
    unmount();
    render(<StatMarksControls mode="bar" marks={resolveStatMarks("bar", null)} setMarks={setMarks} grouped />);
    expect(screen.queryByRole("option", { name: "from column" })).toBeNull();
  });
});

describe("error bars from a bound column — stage, footnote and export agree", () => {
  it("a summary table draws its SD column by default and says so; SE draws nothing at n = 1", async () => {
    const { result } = renderHook(() => useStatStage(params()));
    act(() => result.current.setMode("bar"));
    act(() => result.current.setGroupCol(2));
    await waitFor(() => expect(result.current.marks.errorBars).toBe("column"));
    expect(result.current.errorColumn).toBe("SD");
    expect(result.current.errorNote).toBe("Error bars: SD (error column)");
    const draw = result.current.draw;
    if (draw?.mode !== "bar") throw new Error("expected a bar draw");
    expect(draw.data.groups.map((g) => barErrorHalf(draw, g.series[0]))).toEqual([0.3, 0.4, 0.2, 0.6]);
    await act(async () => {
      await result.current.exportFigure("svg");
    });
    expect(vi.mocked(exportCategoricalFigure).mock.calls.at(-1)![0].errors).toEqual([[0.3], [0.4], [0.2], [0.6]]);

    act(() => result.current.setMarks({ errorBars: "se" }));
    await waitFor(() => expect(result.current.marks.errorBars).toBe("se"));
    expect(result.current.errorNote).toBeNull();
    await act(async () => {
      await result.current.exportFigure("svg");
    });
    expect(vi.mocked(exportCategoricalFigure).mock.calls.at(-1)![0].errors).toEqual([[null], [null], [null], [null]]);
  });
});
