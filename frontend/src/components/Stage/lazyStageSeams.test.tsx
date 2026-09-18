// COLD-path DOM coverage for the two plot-canvas render seams taken out of
// the eager bundle on 2026-09-18 (`plans/BUNDLE_HEADROOM.md` slice 4):
//
//   * `components/Stage/PlotResultChips.tsx` — the ∫ / ∩ / ROI-gadget result
//     chips, now `lazy()` in PlotStageOverlays behind the component's own
//     visibility predicate (`resultChipsVisible`); and
//   * `components/Stage/PlotContextMenu.tsx` — the plot canvas's right-click
//     menu, now `lazy()` in PlotStageMenus behind the gate that was already
//     there (`menu && displayPayload`).
//
// `src/architecture.test.ts`'s SEAMS list holds the STATIC half (nothing may
// value-import either, and the loader must reach it with a dynamic
// `import()`); that grep cannot see whether the thing still RENDERS. Each test
// asserts both halves at the DOM layer: nothing on the first synchronous flush
// (the `Suspense fallback={null}` while the chunk is in flight — which is what
// proves the seam is real rather than a no-op refactor), and the real content
// once it resolves. The gate is asserted too, since a seam mounted
// unconditionally would fetch its chunk on the plot's first paint and give
// back none of the deferral this slice was measured for.
//
// `PlotResultChips` also returns null internally when nothing is committed
// (`resultChipsVisible` is the same predicate on both sides), so with no
// result the DOM looks identical whether the outer gate is real or deleted —
// a `querySelector` cannot tell those apart. The `loaded` import recorder
// below (same pattern as `lazySectionSeams.test.tsx`) pins that half
// directly. `PlotContextMenu`'s gate needs no such recorder: deleting
// `menu &&` dereferences `menu.x` on a null menu and throws, so the existing
// DOM test already catches it.
//
// Both boundaries inherit the repo-wide `lazy()` caveat: a chunk that will not
// load has no reporting of its own and unmounts the React root at the nearest
// boundary. That is UX-003 in `plans/BUGS_AND_ISSUES.md` for all such sites at
// once, not something these two introduced or can fix locally.

import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type uPlot from "uplot";

import PlotStageMenus from "./PlotStageMenus";
import PlotStageOverlays from "./PlotStageOverlays";
import type { PlotStageActions } from "./usePlotStageActions";
import type { GadgetChipState } from "./useGadgetChip";
import type { PlotPayload } from "../../lib/plotdata";
import { useApp } from "../../store/useApp";

// jsdom has no `matchMedia`, and uPlot's module init calls it — PlotStageOverlays
// reaches uPlot transitively through `useWindowCommands`. The same lightweight
// recorder WindowCanvas.test.tsx / lazyRenderSeams.test.tsx use; nothing here
// needs a real canvas.
vi.mock("uplot", () => ({
  default: class MockUPlot {
    scales = { x: { min: 0, max: 1 } };
    destroy(): void {}
    setSize(): void {}
    setScale(): void {}
  },
}));

vi.mock("../../store/annotationTextDialog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../store/annotationTextDialog")>()),
  askAnnotationText: vi.fn(),
}));

// Records whether `PlotResultChips` has actually been IMPORTED. The DOM
// assertions below cannot distinguish a real gate from an unconditionally
// mounted `<Suspense>{"<PlotResultChips>"}</Suspense>`: with no committed
// result the chip renders nothing either way, so a gate deleted in
// `PlotStageOverlays.tsx` (mounting the boundary, and fetching the chunk, on
// every plot's first paint) would be invisible to `querySelector`. Same
// `vi.hoisted` recorder pattern as `lazySectionSeams.test.tsx`.
const { loaded, track } = vi.hoisted(() => {
  const loaded = new Set<string>();
  const track =
    (name: string) =>
    async (importOriginal: () => Promise<Record<string, unknown>>): Promise<Record<string, unknown>> => {
      loaded.add(name);
      return await importOriginal();
    };
  return { loaded, track };
});
vi.mock("./PlotResultChips", track("PlotResultChips"));

const actions: PlotStageActions = {
  resetView: vi.fn(),
  smartScale: vi.fn(),
  savePng: vi.fn(),
  copyData: vi.fn(),
  copyFigure: vi.fn(),
  snapshot: vi.fn(),
};

const payload = {
  series: [
    { label: "A", unit: "" },
    { label: "B", unit: "" },
  ],
} as unknown as PlotPayload;

const gadget = { mode: "fit", roi: null, cursors: null, busy: false, error: null } as unknown as GadgetChipState;

function fakePlot(): uPlot {
  return {
    over: {
      getBoundingClientRect: () => ({ left: 100, top: 100, right: 500, bottom: 400, width: 400, height: 300 }),
    },
    data: [
      [0, 100, 200, 300, 400],
      [10, 20, 150, 40, 50],
      [10, 20, 300, 40, 50],
    ],
    series: [{}, { scale: "y" }, { scale: "y" }],
    scales: { x: { min: 0, max: 400 }, y: { min: 0, max: 300 } },
    posToVal: (px: number) => px,
    valToPos: (v: number) => v,
  } as unknown as uPlot;
}

const overlays = (over: { integral?: { xlo: number; xhi: number; area: number } | null } = {}) => (
  <PlotStageOverlays
    displayPayload={null}
    active={null}
    tool="pointer"
    insetMode={false}
    showLegend={false}
    styleList={undefined}
    seriesCycle={{ positions: [], count: 0 } as never}
    plotted={[]}
    hidden={undefined}
    colorByColumns={new Map()}
    isDarkBg={false}
    inkColor="#000"
    defaultTrace="Line"
    actions={actions}
    readout={null}
    measurement={null}
    stats={null}
    integral={over.integral ?? null}
    fwhm={null}
    onClearIntegral={vi.fn()}
    onClearFwhm={vi.fn()}
    gadget={gadget}
  />
);

const menus = (menu: { x: number; y: number } | null) => (
  <PlotStageMenus
    menu={menu}
    onCloseMenu={vi.fn()}
    displayPayload={payload}
    plotRef={{ current: fakePlot() }}
    plotted={[0, 1]}
    hidden={[false, false]}
    actions={actions}
    annotationMenu={null}
    onCloseAnnotationMenu={vi.fn()}
    axisLabelMenu={null}
    onCloseAxisLabelMenu={vi.fn()}
    shapeMenu={null}
    onCloseShapeMenu={vi.fn()}
  />
);

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    seriesStyles: {},
    seriesLabels: {},
    hiddenChannels: [],
    y2Keys: null,
    showGrid: true,
    showLegend: true,
    legendPos: "ne",
    xScale: "linear",
    yScale: "linear",
    annotations: [],
    selectedAnnotationId: null,
    history: [],
    future: [],
    plotTool: "pointer",
  });
});

describe("plot result chips — chunk-deferred renderer", () => {
  it("renders a committed ∫ result only after the chunk resolves", async () => {
    // The gate half: with nothing committed the gate stays closed, so a
    // render+flush must not start the dynamic import at all — a deleted gate
    // (`{true && <Suspense>...}`) starts it on every plot's first paint
    // regardless of `resultChipsVisible(...)`, which a DOM assertion alone
    // cannot see (the closed-gate DOM is empty either way).
    const closed = render(overlays());
    await act(async () => {});
    expect([...loaded]).not.toContain("PlotResultChips");
    closed.unmount();

    const { container } = render(overlays({ integral: { xlo: 0, xhi: 4, area: 8 } }));
    // The seam itself: the gate is open, the boundary is mounted, and its
    // fallback is null — so no chip exists on this flush.
    expect(container.querySelector(".qzk-result-chip")).toBeNull();
    await waitFor(() => expect(container.querySelector(".qzk-result-chip")).not.toBeNull());
    expect(container.textContent).toContain("∫");
    expect([...loaded]).toContain("PlotResultChips");
  });

  it("stays absent with no committed result, chunk or no chunk", async () => {
    // Synchronize on a real resolution (the chunk is warm from the test
    // above), then assert the gate still holds with nothing committed.
    const warm = render(overlays({ integral: { xlo: 0, xhi: 4, area: 8 } }));
    await waitFor(() => expect(warm.container.querySelector(".qzk-result-chip")).not.toBeNull());
    warm.unmount();

    const { container } = render(overlays());
    expect(container.querySelector(".qzk-result-chips")).toBeNull();
  });
});

describe("plot context menu — chunk-deferred renderer", () => {
  it("renders the right-click menu only after the chunk resolves", async () => {
    render(menus({ x: 300, y: 250 }));
    // The menu's always-present sections are the marker; neither is in the
    // DOM while the chunk is in flight.
    expect(screen.queryByText("X axis")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("X axis")).toBeInTheDocument());
    expect(screen.getByText("Reset zoom (autoscale)")).toBeInTheDocument();
  });

  it("stays absent until a right-click sets the menu position", async () => {
    const warm = render(menus({ x: 300, y: 250 }));
    await waitFor(() => expect(screen.getByText("X axis")).toBeInTheDocument());
    warm.unmount();

    render(menus(null));
    expect(screen.queryByText("X axis")).not.toBeInTheDocument();
  });
});
