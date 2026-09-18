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
  useApp.setState({ mapViews: EMPTY_MAP_VIEWS, history: [], future: [] });
});

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
    expect(useApp.getState().history.map((h) => h.label)).toEqual(["change map colour limits"]);
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
      "change map colour limits",
      "change map colour limits",
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
