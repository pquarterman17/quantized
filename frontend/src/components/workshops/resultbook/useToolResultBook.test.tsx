// In-tool result-book actions (lane RB3 review): once saved, Copy table copies
// the SAVED table (row-bounded by the save), the one Send to report and Open
// as worksheet use; before saving, the full live table, and the status says so.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { copyTextMock } = vi.hoisted(() => ({ copyTextMock: vi.fn() }));
vi.mock("../../../lib/clipboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/clipboard")>()),
  copyText: copyTextMock,
}));

import type { AnalysisResult, AnalysisResultTable } from "../../../lib/analysisResult";
import { useApp } from "../../../store/useApp";
import { distribution, source } from "../analysisresults/resultBook.testkit";
import { useToolResultBook } from "./useToolResultBook";

const LIVE: AnalysisResultTable = { title: "Rows", columns: ["i"], rows: [[1], [2], [3]] };
const SAVED_ROWS: AnalysisResultTable = { title: "Rows", columns: ["i"], rows: [[1]] }; // the save cut it

function savedResult(): AnalysisResult {
  return { ...distribution(), id: "saved-1", tables: [SAVED_ROWS] };
}

beforeEach(() => {
  copyTextMock.mockReset().mockResolvedValue(true);
  useApp.setState({ datasets: [source], activeId: "source", analysisResults: [], status: "" });
});

describe("useToolResultBook Copy table", () => {
  it("copies the full live table before the result is saved, and says so", async () => {
    const { result } = renderHook(() => useToolResultBook({ savedId: "saved-1", liveTables: () => [LIVE] }));
    expect(result.current.copySource("Rows")).toBe("live");
    await act(async () => { result.current.copy("Rows"); });
    expect(copyTextMock).toHaveBeenCalledWith(expect.stringMatching(/1\n2\n3/));
    expect(useApp.getState().status).toMatch(/full live table; not saved yet/);
  });

  it("copies the saved (truncated) table once saved: Copy = Send to report = Open as worksheet", async () => {
    useApp.setState({ analysisResults: [savedResult()] });
    const { result } = renderHook(() => useToolResultBook({ savedId: "saved-1", liveTables: () => [LIVE] }));
    expect(result.current.copySource("Rows")).toBe("saved");
    await act(async () => { result.current.copy("Rows"); });
    const copied = copyTextMock.mock.calls[0][0] as string;
    expect(copied).toMatch(/\b1\b/);
    expect(copied).not.toMatch(/\b3\b/);
    expect(useApp.getState().status).toMatch(/the saved table/);
  });

  it("gives Copy a reason when neither table exists", () => {
    const { result } = renderHook(() => useToolResultBook({ savedId: null, liveTables: () => null }));
    expect(result.current.copyBlocked("Fitted quantiles")).toMatch(/not available yet/);
  });
});
