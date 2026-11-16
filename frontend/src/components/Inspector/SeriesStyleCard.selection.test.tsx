// UX-A (L4): a curve selection opens its style row and a deselect closes it
// again — but never a row the user opened by hand.

import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Dataset } from "../../lib/types";
import SeriesStyleCard from "./SeriesStyleCard";

const DS: Dataset = {
  id: "d1",
  name: "ds",
  data: { time: [0, 1], values: [[1, 2], [3, 4]], labels: ["A", "B"], units: ["", ""], metadata: {} },
};

const row = (c: number) => document.getElementById(`series-style-${c}`) as HTMLDetailsElement;
/** What a click on the row's summary does in a browser: flip, then `toggle`. */
const userToggle = (c: number) =>
  act(() => {
    row(c).open = !row(c).open;
    fireEvent(row(c), new Event("toggle"));
  });

describe("series style rows and the selection", () => {
  it("a deselect never closes a row the user opened", () => {
    const { rerender } = render(<SeriesStyleCard active={DS} />);
    userToggle(1);
    expect(row(1).open).toBe(true);
    rerender(<SeriesStyleCard active={DS} selectedChannel={1} />);
    rerender(<SeriesStyleCard active={DS} />);
    expect(row(1).open).toBe(true);
  });

  it("a row the selection opened closes with the deselect, and the user can collapse it meanwhile", () => {
    const { rerender } = render(<SeriesStyleCard active={DS} selectedChannel={0} />);
    expect(row(0).open).toBe(true);
    rerender(<SeriesStyleCard active={DS} />);
    expect(row(0).open).toBe(false);
    rerender(<SeriesStyleCard active={DS} selectedChannel={0} />);
    userToggle(0);
    expect(row(0).open).toBe(false);
  });
});
