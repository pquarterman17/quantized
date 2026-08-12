import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ErrorBinding } from "../../../lib/errorRoles";
import ErrorColumnsPanel from "./ErrorColumnsPanel";

const LABELS = ["X", "R", "dR"];
const SYM: ErrorBinding = { channel: 2, target: 1, axis: "y", side: "both" };

function renderPanel(bindings: ErrorBinding[], labels: readonly string[] = LABELS) {
  const onPatch = vi.fn();
  const onAdd = vi.fn();
  const onRemove = vi.fn();
  const onDetect = vi.fn();
  render(
    <ErrorColumnsPanel
      bindings={bindings}
      labels={labels}
      onPatch={onPatch}
      onAdd={onAdd}
      onRemove={onRemove}
      onDetect={onDetect}
    />,
  );
  return { onPatch, onAdd, onRemove, onDetect };
}

describe("ErrorColumnsPanel", () => {
  it("shows a hint and no rows when nothing is bound", () => {
    renderPanel([]);
    expect(screen.getByText(/No error columns bound/)).toBeInTheDocument();
  });

  it("lists a bound channel by its column label", () => {
    renderPanel([SYM]);
    expect(screen.getByTitle("dR")).toBeInTheDocument();
  });

  it("falls back to a channel index when the label is missing", () => {
    renderPanel([{ channel: 5, target: -1, axis: "x", side: "both" }]);
    expect(screen.getByTitle("ch 5")).toBeInTheDocument();
  });

  it("edits target through the select, forwarding the numeric channel index", () => {
    const { onPatch } = renderPanel([SYM]);
    fireEvent.change(screen.getByLabelText("error binding 1 target"), { target: { value: "-1" } });
    expect(onPatch).toHaveBeenCalledWith(0, { target: -1 });
  });

  it("edits axis through the select", () => {
    const { onPatch } = renderPanel([SYM]);
    fireEvent.change(screen.getByLabelText("error binding 1 axis"), { target: { value: "x" } });
    expect(onPatch).toHaveBeenCalledWith(0, { axis: "x" });
  });

  it("edits side through the select", () => {
    const { onPatch } = renderPanel([SYM]);
    fireEvent.change(screen.getByLabelText("error binding 1 side"), { target: { value: "+" } });
    expect(onPatch).toHaveBeenCalledWith(0, { side: "+" });
  });

  it("offers no per-row channel control -- which column holds the error values is fixed once bound", () => {
    renderPanel([SYM]);
    expect(screen.queryByLabelText("error binding 1 channel")).not.toBeInTheDocument();
  });

  it("removes a binding via its index, not identity", () => {
    const { onRemove } = renderPanel([
      SYM,
      { channel: 0, target: -1, axis: "x", side: "both" },
    ]);
    fireEvent.click(screen.getByLabelText("Remove error binding for X"));
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it("warns about a one-sided binding with no partner, and only that one", () => {
    renderPanel([
      { channel: 2, target: 1, axis: "y", side: "+" },
      { channel: 0, target: -1, axis: "x", side: "both" },
    ]);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("1 one-sided binding");
    // The guard: any qzk-ds-meta alert/note must also carry qzk-msg.
    expect(alert.className).toContain("qzk-msg");
  });

  it("does not warn once both halves of an asymmetric pair exist", () => {
    renderPanel([
      { channel: 2, target: 1, axis: "y", side: "+" },
      { channel: 1, target: 1, axis: "y", side: "-" },
    ]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("adds a binding from the four Add-form selects", () => {
    const { onAdd } = renderPanel([]);
    fireEvent.change(screen.getByLabelText("new error binding channel"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("new error binding target"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("new error binding axis"), { target: { value: "y" } });
    fireEvent.change(screen.getByLabelText("new error binding side"), { target: { value: "both" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onAdd).toHaveBeenCalledWith(2, 1, "y", "both");
  });

  it("disables Add and explains why when the dataset has no columns", () => {
    renderPanel([], []);
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    expect(screen.getByTitle("no data columns to bind")).toBeInTheDocument();
  });

  it("calls onDetect from the Detect from names button", () => {
    const { onDetect } = renderPanel([]);
    fireEvent.click(screen.getByRole("button", { name: "Detect from names" }));
    expect(onDetect).toHaveBeenCalledTimes(1);
  });
});
