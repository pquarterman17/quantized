// Audit P2.8 review round 2 — the slice overlay's own contracts, at the two
// levels the MapStage DOM suite cannot reach:
//
//   * GEOMETRY (finding 8). The commit's headline claim is that the overlay
//     projects DATA coordinates "through the SAME `mapRender.dataToPx` the
//     canvas paints with". Nothing tested it: the DOM assertions were
//     `y1 === y2`, `x2 > x1` and "y1 unchanged after a regrid", all of which a
//     wholesale projector swap (draw at the raw data coordinates) satisfies.
//     Here `dataToPx` is replaced by a known affine map and the drawn
//     attributes are compared against ITS output.
//   * EXTENT (finding 4). An `h` slice is defined by its y; the first cut
//     projected the whole clicked point and dropped the slice when only its
//     UNHELD x fell outside the payload — contradicting the module's own doc.
//
// `projector` decides which of the two the mocked `dataToPx` is: set it and the
// affine stand-in answers, leave it null and the REAL projector does, so the
// extent tests exercise the shipped maths rather than a mock of it.

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_MAP_VIEWS } from "../../lib/mapView";
import type { MapAnnotation, MapSliceDef } from "../../lib/mapView";
import type { MapPayload } from "../../lib/mapdataFetch";
import { useApp } from "../../store/useApp";
import MapSliceOverlay from "./MapSliceOverlay";
// Not mocked (the factory spreads the original), so this IS the shipped rect.
import { plotRect } from "./mapRender";

let projector: ((x: number, y: number) => [number, number] | null) | null = null;

vi.mock("./mapRender", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mapRender")>();
  return {
    ...actual,
    dataToPx: (p: MapPayload, w: number, h: number, x: number, y: number) =>
      projector ? projector(x, y) : actual.dataToPx(p, w, h, x, y),
  };
});

const W = 600;
const H = 400;

function payload(xLo: number, xHi: number): MapPayload {
  const xAxis = [xLo, (xLo + xHi) / 2, xHi];
  const yAxis = [15, 16, 17];
  return {
    xAxis,
    yAxis,
    zGrid: yAxis.map((_, j) => xAxis.map((_v, i) => j * 3 + i)),
    xLabel: "2Theta",
    xUnit: "deg",
    yLabel: "Omega",
    yUnit: "deg",
    zLabel: "I",
    zUnit: "cts",
    zMin: 0,
    zMax: 8,
  };
}

function renderOverlay(
  slices: MapSliceDef[],
  annotations: MapAnnotation[] = [],
  p: MapPayload = payload(30, 34),
  space: "angular" | "q" | null = "angular",
) {
  const onRemoveSlice = vi.fn();
  const onRemoveAnnotation = vi.fn();
  const view = render(
    <MapSliceOverlay
      payload={p}
      w={W}
      h={H}
      slices={slices}
      annotations={annotations}
      space={space}
      onRemoveSlice={onRemoveSlice}
      onRemoveAnnotation={onRemoveAnnotation}
    />,
  );
  return { view, onRemoveSlice, onRemoveAnnotation };
}

const slice = (over: Partial<MapSliceDef> = {}): MapSliceDef => ({
  id: "s1",
  kind: "h",
  a: { x: 32, y: 16 },
  width: 0,
  space: "angular",
  ...over,
});

beforeEach(() => {
  projector = null;
});
afterEach(() => {
  projector = null;
  vi.restoreAllMocks();
});

describe("geometry comes from mapRender.dataToPx (finding 8)", () => {
  it("a segment's endpoints ARE the projector's output", () => {
    projector = (x, y) => [x * 10 + 1, y * 10 + 2];
    renderOverlay([
      slice({ kind: "seg", a: { x: 1, y: 2 }, b: { x: 3, y: 4 } }),
    ]);
    const line = screen.getByTestId("map-slice-line");
    expect(line.getAttribute("x1")).toBe("11");
    expect(line.getAttribute("y1")).toBe("22");
    expect(line.getAttribute("x2")).toBe("31");
    expect(line.getAttribute("y2")).toBe("42");
  });

  it("an h slice sits at the projector's y and spans the plot rect in x", () => {
    projector = (x, y) => [x * 10 + 1, y * 10 + 2];
    renderOverlay([slice({ a: { x: 1, y: 2 } })]);
    const line = screen.getByTestId("map-slice-line");
    expect(line.getAttribute("y1")).toBe("22");
    expect(line.getAttribute("y2")).toBe("22");
    // The x ends come from the REAL plotRect, not from the projector.
    const rect = plotRect(payload(30, 34), W, H);
    expect(Number(line.getAttribute("x1"))).toBe(rect.x);
    expect(Number(line.getAttribute("x2"))).toBe(rect.x + rect.w);
  });

  it("an annotation is placed at the projector's point", () => {
    projector = (x, y) => [x * 10 + 1, y * 10 + 2];
    renderOverlay([], [{ id: "a1", x: 4, y: 5, text: "peak", space: "angular" }]);
    const chip = screen.getByTestId("map-annotation");
    expect(chip.style.left).toBe("41px");
    expect(chip.style.top).toBe("52px");
  });
});

describe("only the HELD coordinate decides an h/v slice's visibility (finding 4)", () => {
  it("an h slice survives an x that left the extent — its y is what it holds", () => {
    // Same slice, same host box: x 30..34 contains 33.5, x 31..32 does not.
    const wide = renderOverlay([slice({ a: { x: 33.5, y: 16 } })], [], payload(30, 34));
    const wideY = screen.getByTestId("map-slice-line").getAttribute("y1");
    expect(screen.queryByTestId("map-parked-chip")).toBeNull();
    wide.view.unmount();

    renderOverlay([slice({ a: { x: 33.5, y: 16 } })], [], payload(31, 32));
    const line = screen.getByTestId("map-slice-line");
    expect(line.getAttribute("y1")).toBe(wideY); // the held y is unmoved
    expect(screen.queryByTestId("map-parked-chip")).toBeNull();
  });

  it("…and is parked when its HELD y leaves the extent", () => {
    renderOverlay([slice({ a: { x: 32, y: 99 } })]);
    expect(screen.queryByTestId("map-slice-line")).toBeNull();
    const chip = screen.getByTestId("map-parked-chip");
    expect(chip.getAttribute("title")).toMatch(/Outside the map's current extent/);
  });

  it("a v slice holds x, so a y off the extent does not hide it", () => {
    renderOverlay([slice({ kind: "v", a: { x: 32, y: 99 } })]);
    const line = screen.getByTestId("map-slice-line");
    expect(line.getAttribute("x1")).toBe(line.getAttribute("x2"));
  });

  it("a SEGMENT keeps the strict both-ends test — both are real geometry", () => {
    renderOverlay([slice({ kind: "seg", a: { x: 32, y: 16 }, b: { x: 99, y: 16 } })]);
    expect(screen.queryByTestId("map-slice-line")).toBeNull();
    expect(screen.getByTestId("map-parked-chip")).toBeInTheDocument();
  });
});

describe("every definition keeps a handle (finding 3)", () => {
  it("a slice recorded in the other space is listed, says so, and removes", () => {
    const { onRemoveSlice } = renderOverlay([slice({ space: "q" })], [], payload(30, 34), "angular");
    expect(screen.queryByTestId("map-slice-line")).toBeNull();
    const chip = screen.getByTestId("map-parked-chip");
    expect(chip.getAttribute("title")).toMatch(/Recorded in reciprocal \(Q\) space/);
    fireEvent.click(chip);
    expect(onRemoveSlice).toHaveBeenCalledWith("s1");
  });

  it("an annotation recorded in the other space is listed and removes", () => {
    const { onRemoveAnnotation } = renderOverlay(
      [],
      [{ id: "a1", x: 32, y: 16, text: "film peak", space: "q" }],
      payload(30, 34),
      "angular",
    );
    expect(screen.queryByTestId("map-annotation")).toBeNull();
    const chip = screen.getByTestId("map-parked-chip");
    expect(chip).toHaveAttribute("data-parked-kind", "annotation");
    fireEvent.click(chip);
    expect(onRemoveAnnotation).toHaveBeenCalledWith("a1");
  });

  it("renders nothing at all when there is nothing to keep", () => {
    const { view } = renderOverlay([], []);
    expect(view.container.innerHTML).toBe("");
  });
});

// Review round 3, finding 11. The sanitizer caps a label at 200 CHARACTERS,
// which is not a budget in pixels: one such chip rendered as a single
// 202-character row, and several parked definitions wrapped the strip upward
// out of the bottom margin (MARGIN.bottom = 42), across the plot rect and
// under the colourbar (MARGIN.right = 78). Nothing bounded either dimension.
describe("the parked strip has a geometry budget (round 3, finding 11)", () => {
  const longLabel = "x".repeat(200);

  it("a chip is width-capped and truncates instead of growing", () => {
    renderOverlay([], [{ id: "a1", x: 32, y: 16, text: longLabel, space: "q" }], payload(30, 34), "angular");
    const chip = screen.getByTestId("map-parked-chip");
    expect(chip.style.maxWidth).toBe("180px");
    expect(chip.style.textOverflow).toBe("ellipsis");
    expect(chip.style.overflow).toBe("hidden");
    expect(chip.style.whiteSpace).toBe("nowrap");
    // The full text is still reachable — the title already carries the reason.
    expect(chip).toHaveTextContent(longLabel);
  });

  // Round 4 gave the strip a `maxHeight`/`overflowY` clip plus its own
  // `pointer-events: auto` so the resulting scrollbar could be grabbed.
  // Round 5 review (F1) measured, with a real browser hit-test, that opting
  // the WHOLE container into `auto` makes its full bounding box — not just
  // its chips — intercept clicks/drags on the map underneath: wrapped rows
  // rarely fill exactly to `max-width`, so the box routinely holds real dead
  // space. That breaks round 2's click-through guarantee. The strip goes
  // back to `pointer-events: none` (only chips opt in), and the clip/scroll
  // budget is dropped with it — a scrollbar under `pointer-events: none` was
  // never reachable, and a hard clip with no way to reach it would HIDE
  // parked chips outright, breaking round 2's "every slice stays removable"
  // guarantee. The strip wraps and grows instead.
  describe("the strip never intercepts the plot; it wraps and grows (round 5, finding 1)", () => {
    it("the strip container's own pointer-events is none; every chip's is auto", () => {
      renderOverlay(
        [],
        Array.from({ length: 3 }, (_, i) => ({
          id: `a${i}`,
          x: 32,
          y: 16,
          text: longLabel,
          space: "q" as const,
        })),
        payload(30, 34),
        "angular",
      );
      const strip = screen.getByTestId("map-parked-strip");
      expect(strip.style.pointerEvents).toBe("none");
      // The overlay's outer container was already click-through; unchanged.
      const outer = screen.getByTestId("map-slice-overlay");
      expect(outer.style.pointerEvents).toBe("none");
      for (const chip of screen.getAllByTestId("map-parked-chip")) {
        expect(chip.style.pointerEvents).toBe("auto");
      }
    });

    it("has no maxHeight/overflowY budget — it wraps and grows instead of clipping", () => {
      renderOverlay(
        [],
        Array.from({ length: 12 }, (_, i) => ({
          id: `a${i}`,
          x: 32,
          y: 16,
          text: longLabel,
          space: "q" as const,
        })),
        payload(30, 34),
        "angular",
      );
      const strip = screen.getByTestId("map-parked-strip");
      expect(strip.style.maxHeight).toBe("");
      expect(strip.style.overflowY).toBe("");
      expect(strip.style.flexWrap).toBe("wrap");
    });

    it("with 40 parked chips, all 40 remove buttons are in the DOM and clickable — removing the last one removes that store entry", () => {
      useApp.setState({ mapViews: EMPTY_MAP_VIEWS, history: [], future: [] });
      const datasetId = "ds-strip-40";
      const ids: string[] = [];
      for (let i = 0; i < 40; i++) {
        // Parked because it is recorded in "q" while the map shows "angular"
        // (same mechanism as the rest of this file's parked fixtures).
        const id = useApp.getState().addMapSlice(datasetId, {
          kind: "h",
          a: { x: 32, y: 16 },
          width: 0,
          space: "q",
        });
        expect(id).not.toBeNull();
        ids.push(id!);
      }
      const parked = useApp.getState().mapViews[datasetId]!.slices;
      expect(parked).toHaveLength(40);

      render(
        <MapSliceOverlay
          payload={payload(30, 34)}
          w={W}
          h={H}
          slices={parked}
          annotations={[]}
          space="angular"
          onRemoveSlice={(id) => useApp.getState().removeMapSlice(datasetId, id)}
          onRemoveAnnotation={() => {}}
        />,
      );

      const chips = screen.getAllByTestId("map-parked-chip");
      expect(chips).toHaveLength(40);
      const lastId = ids[ids.length - 1]!;
      const lastChip = chips.find((c) => c.getAttribute("data-slice-id") === lastId);
      expect(lastChip).toBeDefined();

      fireEvent.click(lastChip!);

      const after = useApp.getState().mapViews[datasetId]!.slices;
      expect(after).toHaveLength(39);
      expect(after.some((s) => s.id === lastId)).toBe(false);
    });
  });
});
