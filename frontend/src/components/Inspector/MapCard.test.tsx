// Contour controls (ORIGIN_GAP_PLAN #17 remaining half): on/off toggle
// reveals level-count + spacing selects, store-backed like mapMethod/mapRes.

import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import MapCard from "./MapCard";
import { useApp } from "../../store/useApp";

beforeEach(() => {
  useApp.setState({
    mapMethod: "linear",
    mapRes: 200,
    contourOn: false,
    contourLevelCount: 8,
    contourScale: "linear",
  });
});

describe("MapCard contour controls", () => {
  it("hides level/spacing selects until contour is toggled on", () => {
    const { getByText, queryByText } = render(<MapCard />);
    expect(queryByText("Levels")).toBeNull();
    expect(queryByText("Spacing")).toBeNull();

    const checkbox = getByText("Contour lines").querySelector("input")!;
    fireEvent.click(checkbox);
    expect(useApp.getState().contourOn).toBe(true);
  });

  it("shows level/spacing selects once contour is on, and writes through to the store", () => {
    useApp.setState({ contourOn: true });
    const { getByText, container } = render(<MapCard />);
    expect(getByText("Levels")).toBeTruthy();
    expect(getByText("Spacing")).toBeTruthy();

    const selects = container.querySelectorAll("select");
    // [0] = grid method, [1] = resolution, [2] = level count, [3] = spacing.
    fireEvent.change(selects[2], { target: { value: "16" } });
    expect(useApp.getState().contourLevelCount).toBe(16);
    fireEvent.change(selects[3], { target: { value: "log" } });
    expect(useApp.getState().contourScale).toBe("log");
  });
});
