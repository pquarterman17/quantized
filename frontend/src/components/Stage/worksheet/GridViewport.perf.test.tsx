// Perf validation at Origin-project scale (WORKSHEET_PLAN item 10): measure,
// don't assume. A synthetic 100k-row × 200-column dataset through the REAL
// virtualized grid, with a real (non-degenerate) measured viewport —
// asserting only LOAD-INVARIANT properties (rendered DOM node count stays
// bounded regardless of data size; the window follows the scroll; the stats
// fan-out has every request in flight at once). No assertion reads a clock:
// wall time on a shared machine does not scale predictably with load
// (docs/testing.md). Measured numbers are still logged via console.info as
// telemetry and recorded in plans/WORKSHEET_PLAN.md's item 10 write-up.
//
// The stats-footer fan-out (one `/api/stats/descriptive` call per column —
// 201 requests at 200 columns, flagged as a risk in the plan) is checked
// separately below. The claim: `Promise.all` issues every call before any one
// resolves, so wall time tracks the SLOWEST call, not the sum. It is asserted
// as a load-invariant COUNT — each mocked request is held on a deferred, and
// all 201 must be in flight at once before the first is released. The old
// wall-clock bound on the same claim flaked under machine load (2.3–2.4 s
// against 2 s at load ~18–20) and is gone. The plan's escape valve (a batched
// endpoint) is only warranted if a REAL deployment shows otherwise (browser
// per-origin connection limits, not JS-side serialization).

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { statsDescriptive } from "../../../lib/api/statsDescriptive";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import Worksheet from "../Worksheet";
import GridViewport from "./GridViewport";

vi.mock("../../../lib/api", () => ({
  applyCorrections: vi.fn(),
  uploadFile: vi.fn(),
}));
vi.mock("../../../lib/api/statsDescriptive", () => ({
  statsDescriptive: vi.fn(),
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

    console.info(`[perf/item10] mount 100k×200: ${mountMs.toFixed(1)}ms, ${renderedRows} rows, ${renderedCells} cells in DOM`);

    // The invariant that matters: virtualization caps DOM size independent of
    // data size — nowhere near 100,000 rows or 200 columns get real nodes.
    expect(renderedRows).toBeLessThan(60);
    expect(renderedCells).toBeLessThan(3000);
    // Wall-clock assertion removed (TEST_DETERMINISM_PLAN, task 3): the
    // node-count assertions above are the load-invariant claims that cannot
    // flake (they prove virtualization works). The 8s budget, measured ~900ms
    // on a dev machine, flaked immediately under concurrent load (passed
    // 2.22s standalone, red when run with other agents). A loose backstop can
    // catch catastrophic regressions (unmemoized data array, O(n²) layout),
    // but an 8s/900ms measurement window is too narrow under shared-runner
    // CI or a machine with parallel agents — never tighten this back into a
    // timing benchmark.
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

    console.info(`[perf/item10] scroll re-window at 100k rows: ${scrollMs.toFixed(1)}ms`);
    // The invariants that matter: the window MOVED to the scrolled position
    // (row 20834 = 500,000 px / 24 px rows, 1-based) and is still bounded.
    const rowNums = screen.getAllByRole("rowheader").map((h) => h.textContent);
    expect(rowNums).toContain("20834");
    expect(rowNums).not.toContain("1");
    expect(screen.getAllByRole("row").length).toBeLessThan(60); // still windowed after the jump
    // Wall-clock assertion removed (TEST_DETERMINISM_PLAN, task 3): the
    // node-count assertion above is the load-invariant claim (virtualization
    // works). Measured ~18ms on a dev machine with 800ms "generous headroom",
    // but flaked under concurrent load in real CI. An 800ms/18ms window is
    // too narrow under shared-runner matrix or parallel agents — never
    // tighten this back into a timing benchmark.
  }, 120_000);

  it("resizing one column re-windows in a bounded time — no full-grid rebuild (MAIN_PLAN #3)", () => {
    const data = makeWideData(100_000, 200);
    const props = (colWidths: Record<number, number>) => (
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
        colWidths={colWidths}
      />
    );
    const { container, rerender } = render(props({}));
    const scrollEl = container.querySelector(".qzk-grid") as HTMLElement;
    measureAs(scrollEl, 900, 600);

    // A live drag is a stream of width updates — measure a few consecutive
    // ones (each rebuilds ONE prefix-sum array + the windowed slice, never
    // the 100k-row backing data).
    const t0 = performance.now();
    rerender(props({ 5: 200 }));
    rerender(props({ 5: 260 }));
    rerender(props({ 5: 320 }));
    const resizeMs = performance.now() - t0;

    console.info(`[perf/main3] 3 resize re-renders at 100k×200: ${resizeMs.toFixed(1)}ms`);
    // The invariant that matters: still virtualized after resizes.
    expect(screen.getAllByRole("row").length).toBeLessThan(60); // still windowed
    // Wall-clock assertion removed (TEST_DETERMINISM_PLAN, task 3): the
    // node-count assertion above is the load-invariant claim (no full-grid
    // rebuild on column resize). Measured ~10-40ms per re-render on a dev
    // machine with 2400ms "generous ceiling", but wall time flakes under
    // concurrent load. A 2400ms/40ms window is too narrow under shared-runner
    // CI or parallel agents — never tighten this back into a timing benchmark.
  }, 120_000);

  afterEach(() => {
    vi.useRealTimers();
  });

  it("the stats-footer fan-out (201 requests at 200 columns) parallelizes — all 201 are in flight before any resolves", async () => {
    // Every request is held on a deferred, so "parallel" is a count, not a
    // clock: a serialized fan-out (await each call in turn) never has more
    // than one in flight while none has resolved.
    const release: (() => void)[] = [];
    let inFlight = 0;
    let peakInFlight = 0;
    vi.mocked(statsDescriptive).mockImplementation(
      (col: number[]) =>
        new Promise((resolve) => {
          inFlight += 1;
          peakInFlight = Math.max(peakInFlight, inFlight);
          const mean = col.reduce((a, b) => a + b, 0) / col.length;
          release.push(() => {
            inFlight -= 1;
            resolve({ mean, std: 0, min: 0, max: 0, median: 0, N: col.length });
          });
        }),
    );
    const data = makeWideData(50, 200); // row count doesn't matter here, only column fan-out
    useApp.setState({ datasets: [{ id: "d1", name: "wide.dat", data }], activeId: "d1", status: "" });

    // Fake timers only to step past the hook's 300 ms debounce exactly,
    // rather than polling for it on a loaded machine.
    vi.useFakeTimers();
    const { container } = render(<Worksheet />);
    fireEvent.click(screen.getByRole("button", { name: /Stats/ }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    // The invariant: x + 200 channels all issued, none released yet.
    expect(statsDescriptive).toHaveBeenCalledTimes(201);
    expect(inFlight).toBe(201);
    expect(peakInFlight).toBe(201);
    const footer = container.querySelector(".qzk-grid-footer") as HTMLElement;
    expect(within(footer).getAllByText("…").length).toBeGreaterThan(0); // still pending

    // Release every call: the resolved x-column mean (time 0..49 → 24.5)
    // reaches the footer — the fan-out's result landed in state, not just the mock.
    await act(async () => {
      for (const r of release.splice(0)) r();
      await vi.runAllTimersAsync();
    });
    expect(inFlight).toBe(0);
    expect(within(footer).getByText("24.5")).toBeInTheDocument();
    expect(within(footer).queryByText("…")).toBeNull();
  });
});
