import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ChannelsPanel from "./ChannelsPanel";

const LABELS = ["A", "B", "C"];

function renderPanel(overrides: {
  channelRoles?: Record<number, "label" | "ignore">;
  xKey?: number | null;
  yKeys?: number[] | null;
  y2Keys?: number[] | null;
  fallbackYKeys?: readonly number[];
  labels?: readonly string[];
} = {}) {
  const onXKey = vi.fn();
  const onToggleY = vi.fn();
  const onToggleY2 = vi.fn();
  // "yKeys" in overrides, not `?? [0, 1, 2]` -- the auto sentinel is an
  // EXPLICIT null, and `??` treats a passed-in null the same as "absent",
  // silently discarding the very case some tests exist to cover.
  render(
    <ChannelsPanel
      labels={overrides.labels ?? LABELS}
      channelRoles={overrides.channelRoles}
      xKey={overrides.xKey ?? null}
      yKeys={"yKeys" in overrides ? (overrides.yKeys ?? null) : [0, 1, 2]}
      y2Keys={overrides.y2Keys ?? null}
      fallbackYKeys={overrides.fallbackYKeys ?? [0, 1, 2]}
      onXKey={onXKey}
      onToggleY={onToggleY}
      onToggleY2={onToggleY2}
    />,
  );
  return { onXKey, onToggleY, onToggleY2 };
}

describe("ChannelsPanel", () => {
  it("offers the auto sentinel plus every column as X-axis options", () => {
    renderPanel();
    const select = screen.getByLabelText("X axis channel") as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    expect(optionLabels).toEqual(["Row index (default)", "A", "B", "C"]);
  });

  it("selects null for the auto sentinel and a numeric channel otherwise", () => {
    const { onXKey } = renderPanel();
    const select = screen.getByLabelText("X axis channel");
    fireEvent.change(select, { target: { value: "1" } });
    expect(onXKey).toHaveBeenCalledWith(1);
    fireEvent.change(select, { target: { value: "" } });
    expect(onXKey).toHaveBeenCalledWith(null);
  });

  it("skips the current X channel's row -- it is not a Y candidate", () => {
    renderPanel({ xKey: 1 });
    expect(screen.queryByLabelText("B")).not.toBeInTheDocument();
    expect(screen.getByLabelText("A")).toBeInTheDocument();
    expect(screen.getByLabelText("C")).toBeInTheDocument();
  });

  it("checks a channel's box when it is in the plotted (Y) set", () => {
    renderPanel({ yKeys: [0, 2] });
    expect(screen.getByLabelText("A")).toBeChecked();
    expect(screen.getByLabelText("B")).not.toBeChecked();
    expect(screen.getByLabelText("C")).toBeChecked();
  });

  it("resolves the auto sentinel (yKeys=null) against the caller's fallback", () => {
    renderPanel({ yKeys: null, fallbackYKeys: [0, 1] });
    expect(screen.getByLabelText("A")).toBeChecked();
    expect(screen.getByLabelText("B")).toBeChecked();
    expect(screen.getByLabelText("C")).not.toBeChecked();
  });

  it("toggles Y membership by channel index on checkbox click", () => {
    const { onToggleY } = renderPanel();
    fireEvent.click(screen.getByLabelText("B"));
    expect(onToggleY).toHaveBeenCalledWith(1);
  });

  it("disables a roled (label/ignore) channel's checkbox -- a non-data column can't be plotted", () => {
    renderPanel({ channelRoles: { 1: "label" } });
    expect(screen.getByLabelText("B")).toBeDisabled();
    expect(screen.getByLabelText("A")).not.toBeDisabled();
  });

  it("marks a channel's Y2 pill active when it is in the secondary-axis set", () => {
    renderPanel({ y2Keys: [1] });
    expect(screen.getByLabelText("Plot B on the secondary Y axis")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Plot A on the secondary Y axis")).toHaveAttribute("aria-pressed", "false");
  });

  it("disables the Y2 pill until the channel is plotted", () => {
    renderPanel({ yKeys: [0] });
    expect(screen.getByLabelText("Plot A on the secondary Y axis")).not.toBeDisabled();
    expect(screen.getByLabelText("Plot B on the secondary Y axis")).toBeDisabled();
  });

  it("disables the Y2 pill for a roled channel even if somehow plotted", () => {
    renderPanel({ channelRoles: { 1: "ignore" }, yKeys: [0, 1] });
    expect(screen.getByLabelText("Plot B on the secondary Y axis")).toBeDisabled();
  });

  it("toggles Y2 membership by channel index on pill click", () => {
    const { onToggleY2 } = renderPanel({ yKeys: [0, 1] });
    fireEvent.click(screen.getByLabelText("Plot B on the secondary Y axis"));
    expect(onToggleY2).toHaveBeenCalledWith(1);
  });

  it("shows a hint and no rows for a dataset with no columns", () => {
    renderPanel({ labels: [], yKeys: [] });
    expect(screen.getByText("No data columns to assign.")).toBeInTheDocument();
  });
});
