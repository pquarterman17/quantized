// Audit P2.8 review round 2, finding 16 — the Inspector's map colour-limit
// fields had no test of their own, while `store/mapView.ts`'s header makes a
// claim ABOUT them: "two typed fields committed on blur/Enter, so one gesture
// is one entry and undo stays useful rather than noisy".
//
// Also pins the two things that make it the ACTIVE dataset's control now that
// the views are keyed by dataset id.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { EMPTY_MAP_VIEWS, mapViewFor } from "../../lib/mapView";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import MapColorLimits from "./MapColorLimits";

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
const lo = () => screen.getByLabelText("Map colour minimum");
const hi = () => screen.getByLabelText("Map colour maximum");

/** Type a value and commit it the way the user does: Enter, then blur. */
function commit(field: HTMLElement, value: string) {
  fireEvent.change(field, { target: { value } });
  fireEvent.keyDown(field, { key: "Enter" });
  fireEvent.blur(field);
}

beforeEach(() => {
  useApp.getState().loadWorkspace({ datasets: [ds("ds-a"), ds("ds-b")], activeId: "ds-a" });
  useApp.setState({ mapViews: EMPTY_MAP_VIEWS, mapPaintedLimits: {}, history: [], future: [] });
});

const effectiveRow = () => screen.queryByTestId("map-colour-limits-effective");

describe("MapColorLimits (P2.8)", () => {
  it("typing alone changes nothing — the store waits for a commit", () => {
    render(<MapColorLimits />);
    fireEvent.change(lo(), { target: { value: "10" } });
    fireEvent.change(hi(), { target: { value: "50" } });
    expect(view("ds-a").colorLimits).toBeNull();
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("ONE gesture is ONE undo entry, and it lands on the ACTIVE dataset", () => {
    render(<MapColorLimits />);
    fireEvent.change(lo(), { target: { value: "10" } });
    commit(hi(), "50");
    expect(view("ds-a").colorLimits).toEqual([10, 50]);
    expect(useApp.getState().history.map((h) => h.label)).toEqual(["change map colour limits \"ds-a.xrdml\""]);
    // The other dataset's view is untouched — these limits are in ds-a's z units.
    expect(view("ds-b").colorLimits).toBeNull();
  });

  it("an inverted range leaves the store alone", () => {
    render(<MapColorLimits />);
    fireEvent.change(lo(), { target: { value: "900" } });
    commit(hi(), "50");
    expect(view("ds-a").colorLimits).toBeNull();
    expect(useApp.getState().history).toHaveLength(0);
  });

  // Pinned as it BEHAVES, not as one might wish: a blank field reads as 0
  // through `Number("")`, inherited verbatim from the sibling AxisLimits.tsx
  // this control was copied from. So "clip the top, leave the bottom auto" is
  // not expressible — only both-blank restores auto. Recorded here rather than
  // changed, because changing it would fork the two controls' one shared idiom.
  it("a half-filled pair commits with the blank side read as 0", () => {
    render(<MapColorLimits />);
    commit(hi(), "50");
    expect(view("ds-a").colorLimits).toEqual([0, 50]);
  });

  it("clearing both fields restores auto, in one entry", () => {
    useApp.getState().setMapColorLimits("ds-a", [10, 50]);
    render(<MapColorLimits />);
    expect(lo()).toHaveValue("10");
    fireEvent.change(lo(), { target: { value: "" } });
    commit(hi(), "");
    expect(view("ds-a").colorLimits).toBeNull();
    expect(useApp.getState().history.map((h) => h.label)).toEqual([
      "change map colour limits \"ds-a.xrdml\"",
      "change map colour limits \"ds-a.xrdml\"",
    ]);
  });

  it("follows the ACTIVE dataset — switching shows that map's own limits", () => {
    useApp.getState().setMapColorLimits("ds-a", [10, 50]);
    useApp.getState().setMapColorLimits("ds-b", [1, 2]);
    const v = render(<MapColorLimits />);
    expect(lo()).toHaveValue("10");
    useApp.getState().setActive("ds-b");
    v.rerender(<MapColorLimits />);
    expect(lo()).toHaveValue("1");
    expect(hi()).toHaveValue("2");
  });
});

// Review round 3, finding 2. Round 1 asked for two things when an explicit
// pair cannot be honoured: fall back to the auto extent, and SURFACE it. Only
// the first landed, so the Inspector went on showing a range the canvas was
// ignoring — type -1 … 2 in log mode on data starting at 7 and the map paints
// 7 … 9 while these fields say -1 and 2. The renderer now reports what it
// painted and this row says so, without touching the stored pair.
describe("the row says what the map is actually painting (round 3, finding 2)", () => {
  it("shows the effective pair when the renderer replaced the stored one", () => {
    useApp.getState().setMapColorLimits("ds-a", [-1, 2]);
    useApp.getState().setMapLogZ("ds-a", true);
    useApp.getState().reportMapPaintedLimits("ds-a", [7, 9]);
    render(<MapColorLimits />);

    // The typed pair is still in the fields — still editable, still recoverable.
    expect((lo() as HTMLInputElement).value).toBe("-1");
    expect((hi() as HTMLInputElement).value).toBe("2");
    expect(effectiveRow()).toHaveTextContent("effective 7 – 9");
  });

  it("says nothing when the map is painting exactly what was typed", () => {
    useApp.getState().setMapColorLimits("ds-a", [10, 50]);
    useApp.getState().reportMapPaintedLimits("ds-a", [10, 50]);
    render(<MapColorLimits />);
    expect(effectiveRow()).toBeNull();
  });

  it("says nothing on auto — there is no stored pair to contradict", () => {
    useApp.getState().reportMapPaintedLimits("ds-a", [0, 119]);
    render(<MapColorLimits />);
    expect(effectiveRow()).toBeNull();
  });

  it("says nothing when no map has painted yet", () => {
    useApp.getState().setMapColorLimits("ds-a", [10, 50]);
    render(<MapColorLimits />);
    expect(effectiveRow()).toBeNull();
  });

  it("reports a map with nothing paintable at all", () => {
    useApp.getState().setMapColorLimits("ds-a", [10, 50]);
    useApp.getState().reportMapPaintedLimits("ds-a", null);
    render(<MapColorLimits />);
    expect(effectiveRow()).toHaveTextContent("nothing to paint");
  });

  it("follows the ACTIVE dataset here too — ds-b's painted pair is not shown on ds-a", () => {
    useApp.getState().setMapColorLimits("ds-a", [10, 50]);
    useApp.getState().setMapColorLimits("ds-b", [-1, 2]);
    useApp.getState().reportMapPaintedLimits("ds-b", [7, 9]);
    const v = render(<MapColorLimits />);
    expect(effectiveRow()).toBeNull();

    useApp.setState({ activeId: "ds-b" });
    v.rerender(<MapColorLimits />);
    expect(effectiveRow()).toHaveTextContent("effective 7 – 9");
  });

  it("formats to 4 significant figures, like every other number on the map", () => {
    useApp.getState().setMapColorLimits("ds-a", [1, 2]);
    useApp.getState().reportMapPaintedLimits("ds-a", [0.000123456, 1234567]);
    render(<MapColorLimits />);
    expect(effectiveRow()).toHaveTextContent("effective 1.23e-4 – 1.23e+6");
  });
});
