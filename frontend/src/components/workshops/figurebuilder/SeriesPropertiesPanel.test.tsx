import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ErrorBinding } from "../../../lib/errorRoles";
import type { SeriesStyle } from "../../../lib/types";
import SeriesPropertiesPanel from "./SeriesPropertiesPanel";

const LABELS = ["Alpha", "Beta", "Alpha err"];
const ERRORS: ErrorBinding[] = [{ channel: 2, target: 0, axis: "y", side: "both" }];

function renderPanel(overrides: {
  styles?: Record<number, SeriesStyle>;
  hiddenChannels?: number[];
  seriesLabels?: Record<number, string>;
  errors?: ErrorBinding[];
} = {}) {
  const onStyle = vi.fn();
  const onHiddenChange = vi.fn();
  const onMove = vi.fn();
  render(
    <SeriesPropertiesPanel
      labels={LABELS}
      channels={[0, 1]}
      styles={overrides.styles ?? {}}
      hiddenChannels={overrides.hiddenChannels ?? []}
      seriesLabels={overrides.seriesLabels ?? {}}
      errors={overrides.errors ?? ERRORS}
      onStyle={onStyle}
      onHiddenChange={onHiddenChange}
      onMove={onMove}
    />,
  );
  return { onStyle, onHiddenChange, onMove };
}

describe("SeriesPropertiesPanel", () => {
  it("lists every plotted channel with its label and default mode", () => {
    renderPanel();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByLabelText("series 1 mode")).toHaveValue("line");
    expect(screen.getByLabelText("series 2 mode")).toHaveValue("line");
  });

  it("prefers a display-name override over the raw dataset label", () => {
    renderPanel({ seriesLabels: { 0: "Renamed" } });
    expect(screen.getByText("Renamed")).toBeInTheDocument();
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
  });

  it("changing mode to scatter sets width 0 + marker", () => {
    const { onStyle } = renderPanel();
    fireEvent.change(screen.getByLabelText("series 1 mode"), { target: { value: "scatter" } });
    expect(onStyle).toHaveBeenCalledWith(0, { width: 0, marker: true, step: undefined });
  });

  it("changing mode to step reveals the alignment select, defaulting to post", () => {
    const { onStyle } = renderPanel();
    expect(screen.queryByLabelText("series 1 step alignment")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("series 1 mode"), { target: { value: "step" } });
    expect(onStyle).toHaveBeenCalledWith(0, { step: "post", width: undefined });
  });

  it("shows and edits the step alignment once a series is already in step mode", () => {
    const { onStyle } = renderPanel({ styles: { 0: { step: "pre" } } });
    expect(screen.getByLabelText("series 1 mode")).toHaveValue("step");
    fireEvent.change(screen.getByLabelText("series 1 step alignment"), { target: { value: "mid" } });
    expect(onStyle).toHaveBeenCalledWith(0, { step: "mid" });
  });

  it("edits width through the unfinished-typing-safe number field", () => {
    const { onStyle } = renderPanel();
    fireEvent.change(screen.getByLabelText("series 2 width"), { target: { value: "2.5" } });
    expect(onStyle).toHaveBeenCalledWith(1, { width: 2.5 });
  });

  it("edits color via a palette preset and the custom picker", () => {
    const { onStyle } = renderPanel();
    fireEvent.click(screen.getByLabelText("series 1 color preset 3"));
    expect(onStyle).toHaveBeenCalledWith(0, { color: "--series-3" });

    fireEvent.change(screen.getByLabelText("series 2 color"), { target: { value: "#112233" } });
    expect(onStyle).toHaveBeenCalledWith(1, { color: "#112233" });
  });

  it("toggles visibility and reports the current hidden/shown state accessibly", () => {
    const { onHiddenChange } = renderPanel({ hiddenChannels: [1] });
    const hideAlpha = screen.getByLabelText("Hide series 1 (Alpha)");
    expect(hideAlpha).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(hideAlpha);
    expect(onHiddenChange).toHaveBeenCalledWith(0, true);

    const showBeta = screen.getByLabelText("Show series 2 (Beta)");
    expect(showBeta).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(showBeta);
    expect(onHiddenChange).toHaveBeenCalledWith(1, false);
  });

  it("disables move-up on the first row and move-down on the last row, and moves an interior row", () => {
    const { onMove } = renderPanel();
    expect(screen.getByLabelText("Move series 1 up")).toBeDisabled();
    expect(screen.getByLabelText("Move series 2 down")).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Move series 2 up"));
    expect(onMove).toHaveBeenCalledWith(1, -1);
  });

  it("displays a channel's Y error binding read-only, and 'none' when it has none", () => {
    renderPanel();
    expect(screen.getByText("Y error: Alpha err")).toBeInTheDocument(); // channel 0's binding
    expect(screen.getByText("Y error: none")).toBeInTheDocument(); // channel 1 has no binding
  });

  it("summarizes an x-axis-wide error binding once, above the per-series rows", () => {
    renderPanel({ errors: [{ channel: 2, target: -1, axis: "x", side: "both" }] });
    expect(screen.getByText("X error: Alpha err")).toBeInTheDocument();
  });

  it("omits the x-error line entirely when there is none", () => {
    renderPanel({ errors: [] });
    expect(screen.queryByText(/X error:/)).not.toBeInTheDocument();
  });
});
