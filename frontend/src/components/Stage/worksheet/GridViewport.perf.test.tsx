// Perf validation at Origin-project scale (WORKSHEET_PLAN item 10): measure,
// don't assume. A synthetic 100k-row × 200-column dataset through the REAL
// virtualized grid, with a real (non-degenerate) measured viewport —
// asserting the invariant that actually matters (rendered DOM node count
// stays bounded regardless of data size) plus GENEROUS wall-clock ceilings
// (CI, especially Windows, runs several times slower than a dev machine —
// see the repo's other perf-test precedent for this discipline) so this is a
// regression guard, not a tight micro-benchmark. Measured numbers from a
// real run are logged via console.info and also recorded in
// plans/WORKSHEET_PLAN.md's item 10 write-up.
//
// The stats-footer fan-out (one `/api/stats/descriptive` call per column —
// 201 requests at 200 columns, flagged as a risk in the plan) is measured
// separately below: `Promise.all` already parallelizes every call, so wall
// time should track the SLOWEST single call, not the sum — this test proves
// that with a mocked artificial per-call latency, so the un-batched fan-out
// is not itself a source of serialized slowdown. The plan's escape valve (a
// batched endpoint) is only warranted if a REAL deployment shows otherwise
// (browser per-origin connection limits, not JS-side serialization).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { statsDescriptive } from "../../../lib/api";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import Worksheet from "../Worksheet";
import GridViewport from "./GridViewport";

vi.mock("../../../lib/api", () => ({
  statsDescriptive: vi.fn(),
  applyCorrections: vi.fn(),
  uploadFile: vi.fn(),
}));

function makeWideData(nRows: number, nCols: number): DataStruct {
  return {
    time: Array.from({ length: nRows }, (_, i) => i),
    values: Array.from({ length: nRows }, (_, i) => Array.from({ length: nCols }, (_, c) => i * nCols + c)),
    labels: Array.from({ length: nCols }, (_, c) => `C${c}`),
    units: Array.from({ length: nCols }, () => ""),
    metadata: {},
  };
}

/** Stub a bounded viewport (jsdom never lays elements out) and re-trigger
 *  GridViewport's measurement effect, matching GridViewport.test.tsx. */
function measureAs(scrollEl: HTMLElement, width: number, height: number) {
  Object.defineProperty(scrollEl, "clientWidth", { configurable: true, value: width });
  Object.defineProperty(scrollEl, "clientHeight", { configurable: true, value: height });
  fireEvent(window, new Event("resize"));
}

const noop = () => {};

describe("GridViewport perf validation at scale (item 10)", () => {
  // Explicit generous test timeouts (well above vitest's 5000ms default):
  // building + mounting a 100k×200 array can exceed 5s under full-suite
  // parallel-worker CPU contention even though the assertions below (the
  // actual perf budget) stay comfortably under their own bounds in isolation.
  it("mounts a 100k-row x 200-column dataset with a bounded DOM node count and a generous time budget", () => {
    const data = makeWideData(100_000, 200);
    const t0 = performance.now();
    const { container } = render(
      <GridViewport
        data={data}
        xName="x"
        xUnit=""
        order={data.time.map((_, i) => i)}
        masked={new Set()}
        filteredOut={new Set()}
        selected={new Set()}
        channelRoles={{}}
        sortMark={() => ""}
        selectedCols={new Set()}
        onToggleColSelect={noop}
        onSelectColRange={noop}
        onToggleSelect={noop}
        onSelectRange={noop}
        onEditCell={noop}
        baseCount={200}
        onRemoveFormula={noop}
        showStats={false}
        colStats={null}
        statsErr={false}
        textCols={[]}
      />,
    );
    const scrollEl = container.querySelector(".qzk-grid") as HTMLElement;
    measureAs(scrollEl, 900, 600);
    const mountMs = performance.now() - t0;

    const renderedRows = screen.getAllByRole("row").length; // header + windowed data rows
    const renderedCells = container.querySelectorAll(".qzk-grid-cell, .qzk-grid-headcell").length;

    // eslint-disable-next-line no-console
    console.info(`[perf/item10] mount 100k×200: ${mountMs.toFixed(1)}ms, ${renderedRows} rows, ${renderedCells} cells in DOM`);

    // The invariant that matters: virtualization caps DOM size independent of
    // data size — nowhere near 100,000 rows or 200 columns get real nodes.
    expect(renderedRows).toBeLessThan(60);
    expect(renderedCells).toBeLessThan(3000);
    // Generous ceiling (not a tight benchmark) — measured ~900ms on a dev
    // machine; Windows CI runs several times slower, so this leaves ~8x
    // headroom. Catches an accidental de-virtualization (e.g. someone
    // mapping over `data.values` directly), not micro-regressions.
    expect(mountMs).toBeLessThan(8000);
  }, 120_000);

  it("scrolling a 100k-row grid re-windows in a bounded time (not a full re-render of all rows)", () => {
    const data = makeWideData(100_000, 200);
    const { container } = render(
      <GridViewport
        data={data}
        xName="x"
        xUnit=""
        order={data.time.map((_, i) => i)}
        masked={new Set()}
        filteredOut={new Set()}
        selected={new Set()}
        channelRoles={{}}
        sortMark={() => ""}
        selectedCols={new Set()}
        onToggleColSelect={noop}
        onSelectColRange={noop}
        onToggleSelect={noop}
        onSelectRange={noop}
        onEditCell={noop}
        baseCount={200}
        onRemoveFormula={noop}
        showStats={false}
        colStats={null}
        statsErr={false}
        textCols={[]}
      />,
    );
    const scrollEl = container.querySelector(".qzk-grid") as HTMLElement;
    measureAs(scrollEl, 900, 600);

    const t0 = performance.now();
    Object.defineProperty(scrollEl, "scrollTop", { configurable: true, value: 500_000 });
    fireEvent.scroll(scrollEl);
    const scrollMs = performance.now() - t0;

    // eslint-disable-next-line no-console
    console.info(`[perf/item10] scroll re-window at 100k rows: ${scrollMs.toFixed(1)}ms`);
    expect(screen.getAllByRole("row").length).toBeLessThan(60); // still windowed after the jump
    expect(scrollMs).toBeLessThan(800); // measured ~18ms on a dev machine — generous CI headroom
  }, 120_000);

  it("the stats-footer fan-out (201 requests at 200 columns) parallelizes — wall time tracks the SLOWEST call, not the sum", async () => {
    const LATENCY_MS = 15;
    vi.mocked(statsDescriptive).mockImplementation(
      (col: number[]) =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ mean: col[0] ?? 0, std: 0, min: 0, max: 0, median: 0, N: col.length }), LATENCY_MS),
        ),
    );
    const data = makeWideData(50, 200); // row count doesn't matter here, only column fan-out
    useApp.setState({ datasets: [{ id: "d1", name: "wide.dat", data }], activeId: "d1", status: "" });

    render(<Worksheet />);
    const t0 = performance.now();
    fireEvent.click(screen.getByRole("button", { name: /Stats/ }));
    await waitFor(() => expect(statsDescriptive).toHaveBeenCalledTimes(201)); // x + 200 channels
    const fanoutMs = performance.now() - t0;

    // eslint-disable-next-line no-console
    console.info(`[perf/item10] stats fan-out (201 parallel calls @ ${LATENCY_MS}ms simulated latency): ${fanoutMs.toFixed(1)}ms`);
    // If the 201 calls were serialized (a bug), this would be >= 201*15 = 3015ms.
    // Promise.all already parallelizes them client-side (measured ~120ms on a
    // dev machine). Under full-suite parallel vitest workers the wall clock
    // inflates ~8x regardless of parallelism (876ms was measured at the old
    // 5ms latency / 700ms bound — a load flake, not a serialization). 2000ms
    // stays 33% below the serialized floor while giving that inflation 2.5x
    // headroom, so the assertion still only trips on real serialization.
    expect(fanoutMs).toBeLessThan(2000);
  });
});
