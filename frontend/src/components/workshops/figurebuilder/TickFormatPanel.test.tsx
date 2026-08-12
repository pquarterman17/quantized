import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AxisFormat } from "../../../lib/types";
import TickFormatPanel from "./TickFormatPanel";

const AUTO: AxisFormat = { mode: "auto", digits: 2 };

function renderPanel(overrides: Partial<Parameters<typeof TickFormatPanel>[0]> = {}) {
  const onXFmt = vi.fn();
  const onYFmt = vi.fn();
  const onY2Fmt = vi.fn();
  render(
    <TickFormatPanel
      xFmt={AUTO}
      yFmt={AUTO}
      y2Fmt={null}
      hasY2={false}
      xIsDate={false}
      onXFmt={onXFmt}
      onYFmt={onYFmt}
      onY2Fmt={onY2Fmt}
      {...overrides}
    />,
  );
  return { onXFmt, onYFmt, onY2Fmt };
}

describe("TickFormatPanel", () => {
  it("commits a mode change per axis", () => {
    const { onXFmt, onYFmt } = renderPanel();
    fireEvent.click(screen.getAllByRole("tab", { name: "Sci" })[0]);
    expect(onXFmt).toHaveBeenCalledWith({ mode: "sci", digits: 2 });
    fireEvent.click(screen.getAllByRole("tab", { name: "Fixed" })[1]);
    expect(onYFmt).toHaveBeenCalledWith({ mode: "fixed", digits: 2 });
  });

  it("shows the digits field only for a non-auto numeric mode", () => {
    renderPanel();
    expect(screen.queryByLabelText("X digits")).not.toBeInTheDocument();
    renderPanel({ xFmt: { mode: "fixed", digits: 3 } });
    expect(screen.getByLabelText("X digits")).toHaveValue("3");
  });

  it("commits a clamped digit count and ignores a half-typed one", () => {
    const { onXFmt } = renderPanel({ xFmt: { mode: "fixed", digits: 3 } });
    fireEvent.change(screen.getByLabelText("X digits"), { target: { value: "99" } });
    expect(onXFmt).toHaveBeenCalledWith({ mode: "fixed", digits: 20 });
    onXFmt.mockClear();
    fireEvent.change(screen.getByLabelText("X digits"), { target: { value: "" } });
    expect(onXFmt).not.toHaveBeenCalled();
  });

  it("hides the date select unless the data says X is timestamps", () => {
    renderPanel();
    expect(screen.queryByLabelText("X date/time format")).not.toBeInTheDocument();
    renderPanel({ xIsDate: true });
    expect(screen.getByLabelText("X date/time format")).toBeInTheDocument();
  });

  it("offers date modes on X only, never Y", () => {
    renderPanel({ xIsDate: true });
    expect(screen.queryByLabelText("Y date/time format")).not.toBeInTheDocument();
  });

  it("maps the date select's Numeric option back to auto", () => {
    const { onXFmt } = renderPanel({ xIsDate: true, xFmt: { mode: "datetime", digits: 2 } });
    fireEvent.change(screen.getByLabelText("X date/time format"), { target: { value: "numeric" } });
    expect(onXFmt).toHaveBeenCalledWith({ mode: "auto", digits: 2 });
  });

  it("shows a date mode as Auto in the numeric segmented control, not as an unselected row", () => {
    // The four numeric modes cannot represent "datetime"; falling back to Auto
    // is the honest display, and the date select beside it carries the truth.
    renderPanel({ xIsDate: true, xFmt: { mode: "date", digits: 2 } });
    expect(screen.getAllByRole("tab", { name: "Auto" })[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("X date/time format")).toHaveValue("date");
  });

  it("hides the Y2 row entirely with no secondary axis plotted", () => {
    renderPanel({ hasY2: false });
    expect(screen.queryByLabelText("inherits Y")).not.toBeInTheDocument();
  });

  it("shows Y2 as inheriting Y until it is given its own format", () => {
    renderPanel({ hasY2: true, y2Fmt: null });
    expect(screen.getByLabelText("inherits Y")).toBeChecked();
    expect(screen.queryByLabelText("Y2 digits")).not.toBeInTheDocument();
  });

  it("seeds Y2 from the CURRENT Y format when inheritance is turned off", () => {
    // Not a fresh default: unticking must show what the axis is already
    // rendering, so the first edit is a tweak rather than a surprise reset.
    const { onY2Fmt } = renderPanel({ hasY2: true, y2Fmt: null, yFmt: { mode: "sci", digits: 4 } });
    fireEvent.click(screen.getByLabelText("inherits Y"));
    expect(onY2Fmt).toHaveBeenCalledWith({ mode: "sci", digits: 4 });
  });

  it("restores inheritance by writing null, the renderer's own inherit sentinel", () => {
    const { onY2Fmt } = renderPanel({ hasY2: true, y2Fmt: { mode: "fixed", digits: 1 } });
    fireEvent.click(screen.getByLabelText("inherits Y"));
    expect(onY2Fmt).toHaveBeenCalledWith(null);
  });

  it("edits an independent Y2 format once inheritance is off", () => {
    const { onY2Fmt } = renderPanel({ hasY2: true, y2Fmt: { mode: "fixed", digits: 1 } });
    fireEvent.change(screen.getByLabelText("Y2 digits"), { target: { value: "5" } });
    expect(onY2Fmt).toHaveBeenCalledWith({ mode: "fixed", digits: 5 });
  });
});
