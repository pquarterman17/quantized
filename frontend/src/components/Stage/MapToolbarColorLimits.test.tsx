// PRIMARY_SOFTWARE_AUDIT_PLAN P2.8 residual (a) (review round 3, finding 8):
// a `kind:"map"` document window on a NON-active dataset had no colour-limit
// control — the Inspector's `MapColorLimits.tsx` edits only the ACTIVE
// dataset by rule, and `MapToolbar` covered colormap/scale per window but not
// limits. This control closes that gap: same commit/undo/effective-pair
// contract as the Inspector row (shared `useMapColorLimitsField`), but always
// bound to the `datasetId` it is passed — which for a document window is
// that window's OWN dataset, never `activeId`.
//
// Rendered directly (not through `MapToolbar`/`MapStage`) so every assertion
// below is about THIS control's own contract; `MapStage.windowColorLimits.
// test.tsx` proves the same thing end to end through a real map window.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { EMPTY_MAP_VIEWS, mapViewFor } from "../../lib/mapView";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import MapToolbarColorLimits from "./MapToolbarColorLimits";

function ds(id: string): Dataset {
  return {
    id,
    name: `${id}.xrdml`,
    data: {
      time: [0, 1],
      values: [
        [1, 2],
        [3, 4],
      ],
      labels: ["A", "B"],
      units: ["", ""],
      metadata: {},
    },
  };
}

const view = (id: string) => mapViewFor(useApp.getState().mapViews, id);
const lo = () => screen.getByLabelText("Map window colour minimum");
const hi = () => screen.getByLabelText("Map window colour maximum");
const effectiveNote = () => screen.queryByTestId("map-toolbar-colour-limits-effective");

/** Type a value and commit it the way the user does: Enter, then blur. */
function commit(field: HTMLElement, value: string) {
  fireEvent.change(field, { target: { value } });
  fireEvent.keyDown(field, { key: "Enter" });
  fireEvent.blur(field);
}

beforeEach(() => {
  // ds-a is ACTIVE; the control under test is always bound to ds-b, the
  // window's own (non-active) dataset — see MULTI_PLOT_PLAN item 17.
  useApp.getState().loadWorkspace({ datasets: [ds("ds-a"), ds("ds-b")], activeId: "ds-a" });
  useApp.setState({ mapViews: EMPTY_MAP_VIEWS, mapPaintedLimits: {}, history: [], future: [] });
});

describe("MapToolbarColorLimits — P2.8 residual (a)", () => {
  it("renders for a map window bound to a NON-active dataset", () => {
    render(<MapToolbarColorLimits datasetId="ds-b" />);
    expect(lo()).toBeInTheDocument();
    expect(hi()).toBeInTheDocument();
    expect((lo() as HTMLInputElement).value).toBe(""); // auto, nothing typed
  });

  it("typing + Enter/blur commits to the WINDOW's dataset, never the active one", () => {
    render(<MapToolbarColorLimits datasetId="ds-b" />);
    fireEvent.change(lo(), { target: { value: "10" } });
    commit(hi(), "50");
    expect(view("ds-b").colorLimits).toEqual([10, 50]);
    // ds-a is the ACTIVE dataset and was never touched.
    expect(view("ds-a").colorLimits).toBeNull();
    expect(useApp.getState().history.map((h) => h.label)).toEqual([
      'change map colour limits "ds-b.xrdml"',
    ]);
  });

  it("both fields blank commits auto (null), in one entry", () => {
    useApp.getState().setMapColorLimits("ds-b", [10, 50]);
    render(<MapToolbarColorLimits datasetId="ds-b" />);
    expect((lo() as HTMLInputElement).value).toBe("10");
    fireEvent.change(lo(), { target: { value: "" } });
    commit(hi(), "");
    expect(view("ds-b").colorLimits).toBeNull();
    expect(useApp.getState().history.map((h) => h.label)).toEqual([
      'change map colour limits "ds-b.xrdml"',
      'change map colour limits "ds-b.xrdml"',
    ]);
  });

  it("shows the effective pair when a log-mode floor raise clamps the stored one", () => {
    useApp.getState().setMapColorLimits("ds-b", [-1, 2]);
    useApp.getState().setMapLogZ("ds-b", true);
    useApp.getState().reportMapPaintedLimits("ds-b", [7, 9]);
    render(<MapToolbarColorLimits datasetId="ds-b" />);
    expect(effectiveNote()).toHaveTextContent("eff 7–9");
    // The typed pair stays in the fields — still editable, still recoverable.
    expect((lo() as HTMLInputElement).value).toBe("-1");
    expect((hi() as HTMLInputElement).value).toBe("2");
  });

  it("says nothing when the map paints exactly what was typed", () => {
    useApp.getState().setMapColorLimits("ds-b", [10, 50]);
    useApp.getState().reportMapPaintedLimits("ds-b", [10, 50]);
    render(<MapToolbarColorLimits datasetId="ds-b" />);
    expect(effectiveNote()).toBeNull();
  });

  it("Escape reverts the field to the last committed pair, without committing", () => {
    useApp.getState().setMapColorLimits("ds-b", [10, 50]);
    const historyBefore = useApp.getState().history.length; // the setup commit above
    render(<MapToolbarColorLimits datasetId="ds-b" />);
    fireEvent.change(lo(), { target: { value: "999" } });
    expect((lo() as HTMLInputElement).value).toBe("999");
    fireEvent.keyDown(lo(), { key: "Escape" });
    expect((lo() as HTMLInputElement).value).toBe("10");
    // Nothing was committed by the Escape itself — the store and history are
    // exactly as the setup commit above left them.
    expect(view("ds-b").colorLimits).toEqual([10, 50]);
    expect(useApp.getState().history).toHaveLength(historyBefore);
  });

  it("Escape on a field with nothing yet committed reverts to blank (auto)", () => {
    render(<MapToolbarColorLimits datasetId="ds-b" />);
    fireEvent.change(hi(), { target: { value: "500" } });
    fireEvent.keyDown(hi(), { key: "Escape" });
    expect((hi() as HTMLInputElement).value).toBe("");
    expect(view("ds-b").colorLimits).toBeNull();
  });

  it("an inverted range commits nothing", () => {
    render(<MapToolbarColorLimits datasetId="ds-b" />);
    fireEvent.change(lo(), { target: { value: "900" } });
    commit(hi(), "50");
    expect(view("ds-b").colorLimits).toBeNull();
    expect(useApp.getState().history).toHaveLength(0);
  });
});
