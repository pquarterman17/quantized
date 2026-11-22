import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import SeriesBarsControl from "./SeriesBarsControl";

describe("SeriesBarsControl", () => {
  it("turns bars on (horizontal) and off through the style patch", () => {
    const set = vi.fn();
    const { rerender } = render(<SeriesBarsControl channel={2} style={{}} setSeriesStyle={set} />);
    fireEvent.change(screen.getByLabelText("Bars"), { target: { value: "horizontal" } });
    expect(set).toHaveBeenCalledWith(2, { bars: "horizontal", marker: false, fill: undefined });
    rerender(<SeriesBarsControl channel={2} style={{ bars: true }} setSeriesStyle={set} />);
    expect((screen.getByLabelText("Bars") as HTMLSelectElement).value).toBe("vertical");
    fireEvent.change(screen.getByLabelText("Bars"), { target: { value: "none" } });
    expect(set).toHaveBeenLastCalledWith(2, { bars: undefined, float: undefined });
  });
});
