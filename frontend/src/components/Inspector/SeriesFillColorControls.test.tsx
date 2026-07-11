import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import SeriesFillColorControls from "./SeriesFillColorControls";
import type { SeriesStyle } from "../../lib/types";

const LABELS = ["M", "T", "z"];

describe("SeriesFillColorControls (MAIN #13/#14)", () => {
  it("defaults the Fill select to 'None' and the Colour-by checkbox to unchecked", () => {
    const setSeriesStyle = vi.fn();
    render(
      <SeriesFillColorControls channel={0} style={{}} labels={LABELS} setSeriesStyle={setSeriesStyle} />,
    );
    expect(screen.getByDisplayValue("None")).toBeInTheDocument();
    expect(screen.getByText("Colour by")).toBeInTheDocument();
    const checkbox = screen.getByText("Colour by").closest("label")!.querySelector("input")!;
    expect(checkbox).not.toBeChecked();
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

  it("checking Colour by seeds colorBy at the first other channel and shows the colormap picker", () => {
    const setSeriesStyle = vi.fn();
    const { rerender } = render(
      <SeriesFillColorControls channel={0} style={{}} labels={LABELS} setSeriesStyle={setSeriesStyle} />,
    );
    const checkbox = screen.getByText("Colour by").closest("label")!.querySelector("input")!;
    fireEvent.click(checkbox);
    expect(setSeriesStyle).toHaveBeenCalledWith(0, { colorBy: 1 });

    rerender(
      <SeriesFillColorControls
        channel={0}
        style={{ colorBy: 1 } as SeriesStyle}
        labels={LABELS}
        setSeriesStyle={setSeriesStyle}
      />,
    );
    expect(screen.getByTitle("Colormap")).toBeInTheDocument();
    expect(screen.getByTitle("Colour-by channel")).toBeInTheDocument();
  });

  it("unchecking Colour by clears colorBy to undefined", () => {
    const setSeriesStyle = vi.fn();
    render(
      <SeriesFillColorControls
        channel={0}
        style={{ colorBy: 2 }}
        labels={LABELS}
        setSeriesStyle={setSeriesStyle}
      />,
    );
    const checkbox = screen.getByText("Colour by").closest("label")!.querySelector("input")!;
    fireEvent.click(checkbox);
    expect(setSeriesStyle).toHaveBeenCalledWith(0, { colorBy: undefined });
  });

  it("changing the colormap picker updates colormap", () => {
    const setSeriesStyle = vi.fn();
    render(
      <SeriesFillColorControls
        channel={0}
        style={{ colorBy: 2 }}
        labels={LABELS}
        setSeriesStyle={setSeriesStyle}
      />,
    );
    fireEvent.change(screen.getByTitle("Colormap"), { target: { value: "magma" } });
    expect(setSeriesStyle).toHaveBeenCalledWith(0, { colormap: "magma" });
  });
});
