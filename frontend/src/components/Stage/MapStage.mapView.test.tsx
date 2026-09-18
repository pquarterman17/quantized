// Audit P2.8 — "Preserve existing H/V/segment slices and link positions",
// tested at the layer the user experiences: the slice is DRAWN on the map, and
// it is still drawn after the operations that used to have nothing to lose
// because nothing was kept.
//
// jsdom lays nothing out, so `clientWidth`/`clientHeight` are stubbed on
// HTMLElement (the GridViewport.test.tsx precedent) to give MapStage a real,
// bounded host box — without one it never measures `hostSize` and mounts no
// overlay at all. `fetch` is stubbed to reject so `fetchMap` takes its
// documented offline client-regrid fallback: deterministic, no network, and
// the status line it sets is what the helpers below wait on (the payload is
// not store state, so there is nothing else observable to wait for, and
// waiting on a mock call is the ratcheted anti-pattern).

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_MAP_VIEWS, mapViewFor } from "../../lib/mapView";
import type { Dataset } from "../../lib/types";
import { serializeWorkspace } from "../../lib/workspace";
import { useAnnotationTextDialog } from "../../store/annotationTextDialog";
import { useApp } from "../../store/useApp";
import { shouldAutosave, type AutosaveState } from "../../useWorkspaceAutosave";
import MapStage from "./MapStage";

const W = 600;
const H = 400;

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** A minimal angular RSM: 2Theta / Omega / Intensity, `is2D`, with the regular
 *  `map_shape` the H/V cut buttons are gated on. Units "deg"/"deg" keep
 *  `plotRect` on its plain (non-aspect-locked) branch, so the plot rect is
 *  exactly MARGIN-inset and a click at (200, 150) lands inside it. */
function rsm(id: string): Dataset {
  const values: number[][] = [];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      // The Q columns deliberately span a range that CONTAINS the angular
      // one (28..34 / 13..19 vs 30..33 / 15..18). Physically nonsense, and
      // the point: with realistic Å⁻¹ values an angular slice would fall off
      // the Q axes and go undrawn for the wrong reason, so deleting the
      // overlay's `space` guard would not fail anything. Overlapping ranges
      // make the guard the ONLY thing that can hide it.
      values.push([30 + i, 15 + j, 100 * (i + 1) + j, 28 + i * 2, 13 + j * 2]);
    }
  }
  return {
    id,
    name: `${id}.xrdml`,
    data: {
      time: values.map((_, k) => k),
      values,
      // Qx/Qz make the toolbar's angular⇄Q toggle available — the one axis
      // swap that is NOT a dataset change, and so the one the slice overlay's
      // `space` guard has to survive.
      labels: ["2Theta", "Omega", "Intensity", "Qx", "Qz"],
      units: ["deg", "deg", "counts", "Ang^-1", "Ang^-1"],
      metadata: { is2D: true, axis1_name: "Omega", map_shape: [4, 4] },
    },
  };
}

const viewOf = (id: string) => mapViewFor(useApp.getState().mapViews, id);

let widthSpy: PropertyDescriptor | undefined;
let heightSpy: PropertyDescriptor | undefined;

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
  widthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  heightSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: W });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: H });
});

afterAll(() => {
  vi.unstubAllGlobals();
  if (widthSpy) Object.defineProperty(HTMLElement.prototype, "clientWidth", widthSpy);
  if (heightSpy) Object.defineProperty(HTMLElement.prototype, "clientHeight", heightSpy);
});

beforeEach(() => {
  useAnnotationTextDialog.getState().close();
  useApp.getState().loadWorkspace({ datasets: [rsm("ds-a"), rsm("ds-b")], activeId: "ds-a" });
  useApp.setState({ mapViews: EMPTY_MAP_VIEWS, mapRes: 100, history: [], future: [], status: "" });
});

/** The offline regrid has landed and the host box is measured. */
async function mapReady() {
  await waitFor(() => expect(useApp.getState().status).toMatch(/offline grid/));
}

/** Render, wait for the regridded payload to reach the canvas, and take one
 *  H-cut by arming the toolbar's H button and clicking the map. */
async function renderWithOneHSlice() {
  const view = render(<MapStage />);
  await mapReady();
  const canvas = view.container.querySelector("canvas")!;
  fireEvent.click(screen.getByTitle(/^H-cut:/));
  fireEvent.click(canvas, { clientX: 200, clientY: 150 });
  await waitFor(() => expect(viewOf("ds-a").slices).toHaveLength(1));
  return view;
}

describe("MapStage — slices survive (P2.8)", () => {
  it("an H-cut leaves a slice drawn at the position it was taken", async () => {
    await renderWithOneHSlice();
    const line = await screen.findByTestId("map-slice-line");
    expect(line).toHaveAttribute("data-slice-kind", "h");
    const def = viewOf("ds-a").slices[0]!;
    // The LINK POSITION is the clicked data point, not a pixel.
    expect(def.a.x).toBeGreaterThan(30);
    expect(def.a.x).toBeLessThan(33);
    expect(def.space).toBe("angular");
    // Drawn at that y: a horizontal line spanning the plot rect.
    expect(line.getAttribute("y1")).toBe(line.getAttribute("y2"));
    expect(Number(line.getAttribute("x2"))).toBeGreaterThan(Number(line.getAttribute("x1")));
    // GROUND TRUTH (review round 2, finding 8): the click is at clientY 150,
    // and jsdom's zeroed bounding rect makes that the canvas y too, so the
    // hitTest -> dataToPx round trip must put the line back on that pixel. The
    // first cut asserted only y1 === y2 and x2 > x1, which a wholesale swap of
    // the projector (raw data coordinates) satisfied just as well.
    expect(Number(line.getAttribute("y1"))).toBeCloseTo(150, 1);
  });

  it("survives a REGRID — a resolution change refetches the map, the slice stays put", async () => {
    await renderWithOneHSlice();
    const before = screen.getByTestId("map-slice-line").getAttribute("y1");
    const def = viewOf("ds-a").slices[0]!;

    useApp.getState().setMapRes(400);
    await waitFor(() => expect(useApp.getState().mapRes).toBe(400));
    await waitFor(() => expect(screen.getByTestId("map-slice-line")).toBeInTheDocument());
    expect(viewOf("ds-a").slices[0]).toEqual(def);
    expect(screen.getByTestId("map-slice-line").getAttribute("y1")).toBe(before);
  });

  it("survives a GRID-METHOD change (the other half of a regrid)", async () => {
    await renderWithOneHSlice();
    const def = viewOf("ds-a").slices[0]!;
    useApp.getState().setMapMethod("nearest");
    await waitFor(() => expect(screen.getByTestId("map-slice-line")).toBeInTheDocument());
    expect(viewOf("ds-a").slices[0]).toEqual(def);
  });

  it("survives a COLOUR-LIMIT change", async () => {
    await renderWithOneHSlice();
    const def = viewOf("ds-a").slices[0]!;
    useApp.getState().setMapColorLimits("ds-a", [50, 400]);
    await waitFor(() => expect(viewOf("ds-a").colorLimits).toEqual([50, 400]));
    expect(screen.getByTestId("map-slice-line")).toBeInTheDocument();
    expect(viewOf("ds-a").slices[0]).toEqual(def);
  });

  it("survives RE-ACTIVATING the same dataset", async () => {
    await renderWithOneHSlice();
    const def = viewOf("ds-a").slices[0]!;
    useApp.getState().setActive("ds-a");
    await waitFor(() => expect(screen.getByTestId("map-slice-line")).toBeInTheDocument());
    expect(viewOf("ds-a").slices[0]).toEqual(def);
  });

  // Review round 2, finding 1: the first cut DESTROYED the slice on a switch
  // (one shared record, rebound on mount/activation). Each dataset now keeps
  // its own view, so the switch merely shows the other map's — empty — one,
  // and switching back brings the slice back rather than resurrecting nothing.
  it("a dataset switch shows the OTHER map's own view, and switching back restores this one", async () => {
    await renderWithOneHSlice();
    const def = viewOf("ds-a").slices[0]!;

    useApp.getState().setActive("ds-b");
    await waitFor(() => expect(screen.queryByTestId("map-slice-line")).toBeNull());
    expect(viewOf("ds-b").slices).toEqual([]);
    expect(viewOf("ds-a").slices[0]).toEqual(def); // NOT destroyed

    useApp.getState().setActive("ds-a");
    await waitFor(() => expect(screen.getByTestId("map-slice-line")).toBeInTheDocument());
    expect(viewOf("ds-a").slices[0]).toEqual(def);
  });

  it("a SECOND open map on another dataset cannot destroy the first one's slices", async () => {
    const stage = await renderWithOneHSlice();
    const def = viewOf("ds-a").slices[0]!;

    // Exactly what a `kind:"map"` DocumentWindow mounts: a MapStage bound to
    // an EXPLICIT dataset, alongside the Stage tab's own.
    const other = useApp.getState().datasets.find((d) => d.id === "ds-b")!;
    const win = render(<MapStage dataset={other} />);
    await waitFor(() =>
      expect(within(win.container).getByTitle(/^H-cut:/)).toBeInTheDocument(),
    );

    expect(viewOf("ds-a").slices[0]).toEqual(def);
    // …and it is still DRAWN over the first map, not merely still in the store.
    expect(within(stage.container).getByTestId("map-slice-line")).toBeInTheDocument();
    expect(within(win.container).queryByTestId("map-slice-line")).toBeNull();
    win.unmount();
  });

  // Review round 2, finding 2: the first cut's mount effect wrote an
  // all-default record carrying the dataset id, which made `shouldAutosave`
  // true — the same comparison `useWorkspaceAutosave` calls `markProjectDirty`
  // on — and grew the saved document by a field recording no decision.
  it("merely OPENING a map is not an edit — no write, no autosave, no field", async () => {
    const before = useApp.getState().mapViews;
    const beforeDoc = serializeWorkspace(useApp.getState());
    const beforeAutosave = useApp.getState() as unknown as AutosaveState;

    render(<MapStage />);
    await mapReady();

    expect(useApp.getState().mapViews).toBe(before);
    expect(useApp.getState().history).toHaveLength(0);
    expect(
      shouldAutosave(useApp.getState() as unknown as AutosaveState, beforeAutosave),
    ).toBe(false);
    const norm = (s: string) => s.replace(/"savedAt": "[^"]*"/, '"savedAt": "X"');
    expect(norm(serializeWorkspace(useApp.getState()))).toBe(norm(beforeDoc));
    expect(JSON.parse(beforeDoc)).not.toHaveProperty("mapViews");
  });

  it("the chip removes the slice, and the removal is undoable", async () => {
    await renderWithOneHSlice();
    fireEvent.click(screen.getByTestId("map-slice-chip"));
    await waitFor(() => expect(screen.queryByTestId("map-slice-line")).toBeNull());
    useApp.getState().undo();
    await waitFor(() => expect(screen.getByTestId("map-slice-line")).toBeInTheDocument());
  });

  it("the colormap pick survives an UNMOUNT — closing and reopening the map view", async () => {
    const view = render(<MapStage />);
    await mapReady();
    fireEvent.change(screen.getByLabelText("map"), { target: { value: "magma" } });
    await waitFor(() => expect(viewOf("ds-a").colormap).toBe("magma"));

    view.unmount();
    render(<MapStage />);
    await waitFor(() => expect(screen.getByLabelText("map")).toHaveValue("magma"));
  });

  it("an angular slice/label is NOT redrawn on the Q axes — and comes back on the toggle back", async () => {
    await renderWithOneHSlice();
    const at = viewOf("ds-a").slices[0]!.a;
    useApp.setState((st) => ({
      mapViews: {
        ...st.mapViews,
        "ds-a": {
          ...mapViewFor(st.mapViews, "ds-a"),
          annotations: [{ id: "mann-a", x: at.x, y: at.y, text: "film peak", space: "angular" }],
        },
      },
    }));
    expect(screen.getByTestId("map-slice-line")).toHaveAttribute("data-slice-kind", "h");
    expect(await screen.findByTestId("map-annotation")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle(/Reciprocal-space axes/));
    await waitFor(() => expect(screen.queryByTestId("map-slice-line")).toBeNull());
    expect(screen.queryByTestId("map-annotation")).toBeNull();
    // The DEFINITIONS are kept — only the drawing is space-matched.
    expect(viewOf("ds-a").slices).toHaveLength(1);
    expect(viewOf("ds-a").annotations).toHaveLength(1);

    fireEvent.click(screen.getByTitle(/Angular axes/));
    await waitFor(() => expect(screen.getByTestId("map-slice-line")).toBeInTheDocument());
    expect(screen.getByTestId("map-annotation")).toBeInTheDocument();
  });

  // Review round 2, finding 3: while the definition cannot be drawn it had NO
  // UI at all — invisible and, with undo out of reach after a reopen,
  // permanent. Every definition of the bound dataset now has a handle.
  it("a slice that cannot be drawn is still listed, and still removable", async () => {
    await renderWithOneHSlice();
    fireEvent.click(screen.getByTitle(/Reciprocal-space axes/));
    await waitFor(() => expect(screen.queryByTestId("map-slice-line")).toBeNull());

    const chip = await screen.findByTestId("map-parked-chip");
    expect(chip).toHaveAttribute("data-parked-kind", "slice");
    expect(chip.getAttribute("title")).toMatch(/angular space/);
    fireEvent.click(chip);
    await waitFor(() => expect(viewOf("ds-a").slices).toEqual([]));
    expect(screen.queryByTestId("map-parked-chip")).toBeNull();
  });

  it("double-clicking an idle map pins a label where it was clicked", async () => {
    const view = render(<MapStage />);
    await mapReady();
    fireEvent.doubleClick(view.container.querySelector("canvas")!, { clientX: 200, clientY: 150 });
    await waitFor(() => expect(useAnnotationTextDialog.getState().resolve).not.toBeNull());
    act(() => useAnnotationTextDialog.getState().resolve!("film peak"));
    await waitFor(() => expect(viewOf("ds-a").annotations).toHaveLength(1));
    expect(await screen.findByTestId("map-annotation")).toHaveTextContent("film peak");
  });

  it("does NOT pin a label while a cut tool owns the gestures", async () => {
    const view = render(<MapStage />);
    await mapReady();
    fireEvent.click(screen.getByTitle(/^H-cut:/));
    fireEvent.doubleClick(view.container.querySelector("canvas")!, { clientX: 200, clientY: 150 });
    expect(useAnnotationTextDialog.getState().resolve).toBeNull();
  });

  it("a persisted slice is drawn as soon as the map opens (reopen a saved project)", async () => {
    useApp.setState({
      mapViews: {
        "ds-a": {
          colormap: "viridis",
          logZ: false,
          colorLimits: null,
          slices: [
            { id: "mslice-saved", kind: "v", a: { x: 31, y: 16 }, width: 0, space: "angular" },
          ],
          annotations: [{ id: "mann-saved", x: 31, y: 16, text: "film peak", space: "angular" }],
        },
      },
    });
    render(<MapStage />);
    const line = await screen.findByTestId("map-slice-line");
    expect(line).toHaveAttribute("data-slice-kind", "v");
    expect(line.getAttribute("x1")).toBe(line.getAttribute("x2")); // vertical
    expect(await screen.findByTestId("map-annotation")).toHaveTextContent("film peak");
  });
});
