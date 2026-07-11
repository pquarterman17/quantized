import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import SeriesFillColorControls from "./SeriesFillColorControls";

const LABELS = ["M", "T", "z"];

describe("SeriesFillColorControls (MAIN #13)", () => {
  it("defaults the Fill select to 'None'", () => {
    const setSeriesStyle = vi.fn();
    render(
      <SeriesFillColorControls channel={0} style={{}} labels={LABELS} setSeriesStyle={setSeriesStyle} />,
    );
    expect(screen.getByDisplayValue("None")).toBeInTheDocument();
  });

  it("picking 'Under' sets fill: 'under'", () => {
    const setSeriesStyle = vi.fn();
    render(
      <SeriesFillColorControls channel={0} style={{}} labels={LABELS} setSeriesStyle={setSeriesStyle} />,
    );
    fireEvent.change(screen.getByDisplayValue("None"), { target: { value: "under" } });
    expect(setSeriesStyle).toHaveBeenCalledWith(0, { fill: "under" });
  });

  it("picking 'Between…' seeds fill: {vs} at the first OTHER channel (never itself)", () => {
    const setSeriesStyle = vi.fn();
    render(
      <SeriesFillColorControls channel={0} style={{}} labels={LABELS} setSeriesStyle={setSeriesStyle} />,
    );
    fireEvent.change(screen.getByDisplayValue("None"), { target: { value: "between" } });
    expect(setSeriesStyle).toHaveBeenCalledWith(0, { fill: { vs: 1 } });
  });

  it("shows the vs-channel picker (excluding the row's own channel) once fill is 'between'", () => {
    const setSeriesStyle = vi.fn();
    render(
      <SeriesFillColorControls
        channel={1}
        style={{ fill: { vs: 2 } }}
        labels={LABELS}
        setSeriesStyle={setSeriesStyle}
      />,
    );
    const vsSelect = screen.getByTitle("Fill against") as HTMLSelectElement;
    const optionLabels = [...vsSelect.options].map((o) => o.textContent);
    expect(optionLabels).toEqual(["M", "z"]); // channel 1 ("T", itself) excluded
    expect(vsSelect.value).toBe("2");
  });

  it("changing the vs picker updates fill.vs", () => {
    const setSeriesStyle = vi.fn();
    render(
      <SeriesFillColorControls
        channel={0}
        style={{ fill: { vs: 1 } }}
        labels={LABELS}
        setSeriesStyle={setSeriesStyle}
      />,
    );
    fireEvent.change(screen.getByTitle("Fill against"), { target: { value: "2" } });
    expect(setSeriesStyle).toHaveBeenCalledWith(0, { fill: { vs: 2 } });
  });

  it("picking 'None' clears the override to undefined (not the 'none' literal)", () => {
    const setSeriesStyle = vi.fn();
    render(
      <SeriesFillColorControls
        channel={0}
        style={{ fill: "under" }}
        labels={LABELS}
        setSeriesStyle={setSeriesStyle}
      />,
    );
    fireEvent.change(screen.getByDisplayValue("Under (to zero)"), { target: { value: "none" } });
    expect(setSeriesStyle).toHaveBeenCalledWith(0, { fill: undefined });
  });
});
