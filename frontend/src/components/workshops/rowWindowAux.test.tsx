// The plot's row window on the polar map and the G15 plots (parallel coordinates, hexbin, 2-D KDE, Pareto,
// Bland-Altman), screen == export (ROW_RANGE_CONTRACT 3.3, item 31). The stage previews and Export send ONE request
// built from the sheet cut to the window's rows, less the sheet's exclusions re-based to the window; this file drives
// the real stage, the real hook and the real Export button, and pins the request per kind in
// `tests/fixtures/wire/row_range_aux.json`, which `tests/test_export_row_range_aux.py` renders and compares with a
// numpy selection of the same rows. The sheet outside the window holds 9000+ values, so a leaked row shows.
//
// Regenerate only after a DELIBERATE rule change:
//   ROW_RANGE_AUX_FIXTURE_WRITE=1 npx vitest run src/components/workshops/rowWindowAux.test.tsx

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { postDownload } from "../../lib/api/http";
import type { Plots2Kind } from "../../lib/plots2Mode";
import type { Dataset } from "../../lib/types";
import { setPlotRowRange } from "../../store/plotRowRangeSet";
import { useToasts } from "../../store/toasts";
import { useApp } from "../../store/useApp";
import { windowForExport } from "./ternary/auxRowWindow";
import Plots2Stage from "./plots2/Plots2Stage";
import { setPolarMapMode } from "../../lib/polarMapMode";
import PolarStage from "../Stage/PolarStage";

const previews: { body: Record<string, unknown> | null }[] = [];
vi.mock("./ternary/auxFigurePreview", () => ({
  useFigurePreview: (_path: string, body: Record<string, unknown> | null) => {
    previews.push({ body });
    return { preview: null, error: null, busy: false };
  },
}));
vi.mock("../../lib/api/http", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/api/http")>()), postDownload: vi.fn(async () => undefined) }));
vi.mock("../../lib/excludedRowsChoice", () => ({ askExcludedRows: vi.fn(async () => "omit") }));

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "tests", "fixtures", "wire", "row_range_aux.json");
const N = 200;
const WINDOW = { from: 20, to: 43 };
const inWindow = (r: number) => r >= WINDOW.from && r <= WINDOW.to;
const NAMES = ["dust", "scratch", "pit", "crack"];
/** Window rows are small and varied; every other row is 9000+, so a leaked row is unmistakable. */
const sheet = (): Dataset => ({
  id: "d1", name: "aux.dat", excludedRows: [25],
  data: {
    time: Array.from({ length: N }, (_v, r) => r + 1), // 1..n: an Origin text X names category positions, so its labels follow the X value, never the row
    values: Array.from({ length: N }, (_v, r) => [(7 * r) % 91, (47 * r) % 360, inWindow(r) ? 10 + ((13 * r) % 17) : 9000 + r, inWindow(r) ? (5 * r) % 11 : 9000 + r]),
    labels: ["Chi", "Phi", "Intensity", "B"], units: ["", "", "", ""],
    metadata: { x_category_labels: Array.from({ length: N }, (_v, r) => NAMES[(3 * r) % 4]) },
  },
});
const WINDOW_ROWS = Array.from({ length: WINDOW.to - WINDOW.from + 1 }, (_v, i) => WINDOW.from + i).filter((r) => r !== 25);

type Body = { dataset: { time: number[]; values: number[][] } } & Record<string, unknown>;
const exported = () => vi.mocked(postDownload).mock.calls.map((c) => c[1] as Body);
const lastPreview = () => previews.at(-1)?.body as Body | null;
const strip = (b: Body) => {
  const { fmt: _f, dpi: _d, ...rest } = b as Body & { fmt?: unknown; dpi?: unknown };
  return rest;
};
async function exportNow() {
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  await waitFor(() => expect(exported().length).toBeGreaterThan(0));
  return exported().at(-1)!;
}

interface Kind {
  kind: "polarMap" | Plots2Kind;
  draw: () => void;
}
const pick = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const KINDS: Kind[] = [
  { kind: "parallel", draw: () => void render(<Plots2Stage kind="parallel" />) },
  { kind: "hexbin", draw: () => void render(<Plots2Stage kind="hexbin" />) },
  { kind: "kde2d", draw: () => { render(<Plots2Stage kind="kde2d" />); fireEvent.click(screen.getByLabelText("show points")); } },
  { kind: "pareto", draw: () => { render(<Plots2Stage kind="pareto" />); pick("Category column", "-1"); pick("Value column", "2"); } },
  { kind: "blandAltman", draw: () => void render(<Plots2Stage kind="blandAltman" />) },
  { kind: "polarMap", draw: () => { setPolarMapMode(true); render(<PolarStage />); } },
];

beforeEach(() => {
  previews.length = 0;
  setPolarMapMode(false);
  vi.mocked(postDownload).mockClear();
  useToasts.setState({ toasts: [] });
  useApp.setState(useApp.getInitialState(), true);
  useApp.setState({ datasets: [sheet()], activeId: "d1", excludedDisplay: "hide" });
});

const cases: { kind: string; request: unknown }[] = [];
afterAll(() => {
  if (!process.env.ROW_RANGE_AUX_FIXTURE_WRITE) return;
  const order: string[] = KINDS.map((k) => k.kind);
  cases.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  writeFileSync(FIXTURE, `${JSON.stringify({ cases }, null, 2)}\n`, "utf8");
});

describe.each(KINDS)("$kind under a plot row window", ({ kind, draw }) => {
  it("previews and exports ONE request holding the window's rows only (the exclusion re-based)", async () => {
    setPlotRowRange(WINDOW);
    draw();
    const preview = lastPreview()!;
    expect(preview.dataset.time).toEqual(WINDOW_ROWS.map((r) => r + 1));
    expect(preview.dataset.values.map((v) => v[2])).toEqual(WINDOW_ROWS.map((r) => 10 + ((13 * r) % 17)));
    const sent = await exportNow();
    expect(strip(sent)).toEqual(strip(preview));
    cases.push({ kind, request: JSON.parse(JSON.stringify(sent)) });
  });

  it("matches the committed fixture the backend half renders", async () => {
    setPlotRowRange(WINDOW);
    draw();
    const sent = await exportNow();
    const want = (JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: { kind: string; request: unknown }[] }).cases.find((c) => c.kind === kind);
    expect(JSON.parse(JSON.stringify(sent))).toEqual(want?.request);
  });

  it("draws every analysis row without a window", () => {
    draw();
    expect(lastPreview()!.dataset.time).toHaveLength(N - 1); // row 26 is excluded
  });

  it("does not apply a window past the sheet on screen, and the export refuses it", async () => {
    setPlotRowRange({ from: 20, to: 999 });
    draw();
    expect(lastPreview()!.dataset.time).toHaveLength(N - 1);
    expect(screen.getByRole("status").textContent).toContain("not applied");
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(useToasts.getState().toasts.some((t) => /plot row range.*beyond the worksheet/i.test(t.msg))).toBe(true));
    expect(exported()).toHaveLength(0);
  });

  it("a named link that cannot be read draws no rows, says why, and the export refuses with the same reason", async () => {
    useApp.setState({ rowRange: { from: 20, to: 43, named: "nr1:x", namedAs: "Baseline", refused: "named range removed" } });
    draw();
    expect(lastPreview()).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("no rows");
    expect(screen.getAllByText(/named range removed/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled(); // fails closed on screen
    expect(exported()).toHaveLength(0);
    // ...and the export itself refuses with the same reason, whoever calls it
    expect(() => windowForExport(sheet(), useApp.getState().rowRange)).toThrow(/Plot row range: named range removed/);
  });

  it("the chip carries no draws-every-row notice", () => {
    setPlotRowRange(WINDOW);
    draw();
    const chip = screen.getByRole("status").textContent ?? "";
    expect(chip).toContain("rows 21-44 of 200");
    expect(chip).not.toContain("draws every row");
  });
});
