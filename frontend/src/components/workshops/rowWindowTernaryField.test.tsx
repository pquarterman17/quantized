// The plot's row window on the TERNARY and VECTOR-FIELD workshops (#1224 left them drawing every row; plan item 51).
// Screen == export: the panel previews and Export sends ONE request built from the sheet cut to the window's rows (the
// exclusion re-based), and the panel SAYS which rows are drawn, in source rows. Driven through the real panels, the
// real hooks and the real Export button; the window is set the way the user sets it (`setPlotRowRange`).
//
// The request each panel sends is pinned in `tests/fixtures/wire/row_range_ternary_field.json`, which
// `tests/test_export_row_range_ternary_field.py` renders and compares with a numpy selection of the same rows. Rows
// outside the window hold values that no window row has, so a leaked row shows.
//
// Regenerate only after a DELIBERATE rule change:
//   ROW_RANGE_TF_FIXTURE_WRITE=1 npx vitest run src/components/workshops/rowWindowTernaryField.test.tsx

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { exportFieldFigure, exportTernaryFigure } from "../../lib/api/figures";
import { postBlob } from "../../lib/api/http";
import type { Dataset } from "../../lib/types";
import { setPlotRowRange } from "../../store/plotRowRangeSet";
import { useToasts } from "../../store/toasts";
import { useApp } from "../../store/useApp";
import FieldPlotPanel from "./fieldplot/FieldPlotPanel";
import { useAuxFigureStore } from "./ternary/auxFigureStore";
import TernaryPanel from "./ternary/TernaryPanel";

vi.mock("../../lib/api/http", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/api/http")>()), postBlob: vi.fn() }));
vi.mock("../../lib/api/figures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api/figures")>()),
  exportTernaryFigure: vi.fn(),
  exportFieldFigure: vi.fn(),
}));
vi.mock("../../lib/excludedRowsChoice", () => ({ askExcludedRows: vi.fn(async () => "omit") }));

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "tests", "fixtures", "wire", "row_range_ternary_field.json");
const N = 40;
const WINDOW = { from: 8, to: 19 }; // rows 9-20 of the sheet, as the user reads them
const inWindow = (r: number) => r >= WINDOW.from && r <= WINDOW.to;
const EXCLUDED = 14;

/** Ternary sheet: A = r + 1, B = 2, C = 3 inside the window; every other row is a different, far composition. */
const ternarySheet = (): Dataset => ({
  id: "t1", name: "alloys.csv", excludedRows: [EXCLUDED],
  data: {
    time: Array.from({ length: N }, (_v, r) => r + 1),
    values: Array.from({ length: N }, (_v, r) => (inWindow(r) ? [r + 1, 2, 3] : [900 + r, 7, 9])),
    labels: ["Fe", "Co", "Ni"], units: ["", "", ""], metadata: {},
  },
});
/** Field sheet: a 4-wide grid, y-major (x = r mod 4, y = floor(r / 4)); the window (rows 8-19) is y = 2..4, whole rows. */
const fieldSheet = (): Dataset => ({
  id: "f1", name: "flow.dat",
  data: {
    time: Array.from({ length: N }, (_v, r) => r + 1),
    values: Array.from({ length: N }, (_v, r) => [r % 4, Math.floor(r / 4), r + 1, -(r + 1) / 2]),
    labels: ["x", "y", "u", "v"], units: ["", "", "", ""], metadata: {},
  },
});
const WINDOW_TERNARY_ROWS = Array.from({ length: WINDOW.to - WINDOW.from + 1 }, (_v, i) => WINDOW.from + i).filter((r) => r !== EXCLUDED);

const previews = () => vi.mocked(postBlob).mock.calls.map((c) => c[1] as Record<string, unknown>);
const strip = (b: Record<string, unknown>) => {
  const { fmt: _f, dpi: _d, ...rest } = b;
  return rest;
};
const cases: { kind: string; request: unknown }[] = [];
afterAll(() => {
  if (!process.env.ROW_RANGE_TF_FIXTURE_WRITE) return;
  cases.sort((a, b) => a.kind.localeCompare(b.kind));
  writeFileSync(FIXTURE, `${JSON.stringify({ cases }, null, 2)}\n`, "utf8");
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(postBlob).mockResolvedValue(new Blob(["png"], { type: "image/png" }));
  vi.mocked(exportTernaryFigure).mockResolvedValue(undefined);
  vi.mocked(exportFieldFigure).mockResolvedValue(undefined);
  useToasts.setState({ toasts: [] });
  useApp.setState(useApp.getInitialState(), true);
  useAuxFigureStore.setState({ ternaryOpen: true, fieldOpen: true });
});

/** The panel's debounced server preview body (waits for it to be requested). */
async function lastPreview(): Promise<Record<string, unknown> & { data?: unknown; x_axis?: unknown; y_axis?: unknown; u_grid?: unknown; v_grid?: unknown }> {
  await waitFor(() => expect(previews().length).toBeGreaterThan(0), { timeout: 3000 });
  return previews().at(-1) as Record<string, unknown> & { data?: unknown; x_axis?: unknown; y_axis?: unknown; u_grid?: unknown; v_grid?: unknown };
}

describe("ternary figure under a plot row window", () => {
  const open = () => {
    useApp.setState({ datasets: [ternarySheet()], activeId: "t1", excludedDisplay: "grey" });
    setPlotRowRange(WINDOW);
    render(<TernaryPanel />);
  };

  it("previews and exports the window's rows only (the exclusion re-based), and names them in source rows", async () => {
    open();
    const preview = await lastPreview();
    expect(preview.data).toEqual(WINDOW_TERNARY_ROWS.map((r) => [r + 1, 2, 3]));
    expect(screen.getByText("Plot row range: only rows 9-20 of 40 are drawn.", { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(vi.mocked(exportTernaryFigure).mock.calls.length).toBe(1));
    const sent = vi.mocked(exportTernaryFigure).mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(strip(sent)).toEqual(strip(preview));
    cases.push({ kind: "ternary", request: JSON.parse(JSON.stringify(sent)) });
    const want = (JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: { kind: string; request: unknown }[] }).cases.find((c) => c.kind === "ternary");
    if (!process.env.ROW_RANGE_TF_FIXTURE_WRITE) expect(JSON.parse(JSON.stringify(sent))).toEqual(want?.request);
  });

  it("without a window every analysis row is drawn and no window is named", async () => {
    useApp.setState({ datasets: [ternarySheet()], activeId: "t1", excludedDisplay: "grey" });
    render(<TernaryPanel />);
    expect((await lastPreview()).data).toHaveLength(N - 1);
    expect(screen.queryByText("Plot row range", { exact: false })).toBeNull();
  });

  it("a window that does not fit the sheet is not applied on screen, says so, and the export refuses it", async () => {
    useApp.setState({ datasets: [ternarySheet()], activeId: "t1", excludedDisplay: "grey" });
    setPlotRowRange({ from: 60, to: 70 });
    render(<TernaryPanel />);
    expect((await lastPreview()).data).toHaveLength(N - 1);
    expect(screen.getByText("Plot row range rows 61-71 not applied", { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(useToasts.getState().toasts.length).toBeGreaterThan(0));
    expect(vi.mocked(exportTernaryFigure)).not.toHaveBeenCalled();
  });

  it("a named link that cannot be read draws nothing, disables Export and says why", () => {
    useApp.setState({ datasets: [ternarySheet()], activeId: "t1", excludedDisplay: "grey" });
    useApp.setState({ rowRange: { from: 0, to: 0, named: "nr1:x", namedAs: "Gone", refused: "the named range was deleted" } });
    render(<TernaryPanel />);
    expect(screen.getByText("Plot row range: the named range was deleted.", { exact: false })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Export" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("vector field under a plot row window", () => {
  const open = () => {
    useApp.setState({ datasets: [fieldSheet()], activeId: "f1", excludedDisplay: "grey" });
    setPlotRowRange(WINDOW);
    render(<FieldPlotPanel />);
  };

  it("previews and exports the grid of the window's rows only, and names them in source rows", async () => {
    open();
    const preview = await lastPreview();
    expect(preview.x_axis).toEqual([0, 1, 2, 3]);
    expect(preview.y_axis).toEqual([2, 3, 4]); // the whole sheet has y = 0..9
    expect(preview.u_grid).toEqual([[9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]]);
    expect(preview.v_grid).toEqual([[-4.5, -5, -5.5, -6], [-6.5, -7, -7.5, -8], [-8.5, -9, -9.5, -10]]);
    expect(screen.getByText("Plot row range: only rows 9-20 of 40 are drawn.", { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(vi.mocked(exportFieldFigure).mock.calls.length).toBe(1));
    const sent = vi.mocked(exportFieldFigure).mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(strip(sent)).toEqual(strip(preview));
    cases.push({ kind: "field", request: JSON.parse(JSON.stringify(sent)) });
    const want = (JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: { kind: string; request: unknown }[] }).cases.find((c) => c.kind === "field");
    if (!process.env.ROW_RANGE_TF_FIXTURE_WRITE) expect(JSON.parse(JSON.stringify(sent))).toEqual(want?.request);
  });

  it("without a window the whole grid is drawn", async () => {
    useApp.setState({ datasets: [fieldSheet()], activeId: "f1", excludedDisplay: "grey" });
    render(<FieldPlotPanel />);
    expect((await lastPreview()).y_axis).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("a window cutting the grid into an incomplete one says so rather than drawing a wrong field", () => {
    useApp.setState({ datasets: [fieldSheet()], activeId: "f1", excludedDisplay: "grey" });
    setPlotRowRange({ from: 9, to: 19 }); // starts mid-row: a gap in the first grid row
    render(<FieldPlotPanel />);
    expect((screen.getByRole("button", { name: "Export" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a window that does not fit the sheet is not applied on screen and the export refuses it", async () => {
    useApp.setState({ datasets: [fieldSheet()], activeId: "f1", excludedDisplay: "grey" });
    setPlotRowRange({ from: 60, to: 70 });
    render(<FieldPlotPanel />);
    expect((await lastPreview()).y_axis).toHaveLength(10);
    expect(screen.getByText("Plot row range rows 61-71 not applied", { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(useToasts.getState().toasts.length).toBeGreaterThan(0));
    expect(vi.mocked(exportFieldFigure)).not.toHaveBeenCalled();
  });
});
