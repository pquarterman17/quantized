import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RegionShade } from "../../../lib/types";
import RegionShadePropertiesPanel from "./RegionShadePropertiesPanel";

const SHADE_1: RegionShade = { id: "sh1", x1: 0, y1: 1, x2: 2, y2: 3, fill: "#336699" };
const SHADE_2: RegionShade = { id: "sh2", x1: 4, y1: 5, x2: 6, y2: 7, fill: "#993366", axis: 1 };

function renderPanel(regionShades: RegionShade[]) {
  const onPatch = vi.fn();
  const onAdd = vi.fn();
  const onRemove = vi.fn();
  render(
    <RegionShadePropertiesPanel
      regionShades={regionShades}
      onPatch={onPatch}
      onAdd={onAdd}
      onRemove={onRemove}
    />,
  );
  return { onPatch, onAdd, onRemove };
}

describe("RegionShadePropertiesPanel — rows", () => {
  it("lists every shade with its flat draw-order label", () => {
    renderPanel([SHADE_1, SHADE_2]);
    expect(screen.getByText("Shade 1")).toBeInTheDocument();
    expect(screen.getByText("Shade 2")).toBeInTheDocument();
  });

  it("exposes the FULL phrase to assistive tech, not just the compact text", () => {
    renderPanel([SHADE_1]);
    expect(screen.getByLabelText("Region shade 1 x1")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove Region shade 1")).toBeInTheDocument();
  });

  it("edits a shade's coordinate through the required-numeric field", () => {
    const { onPatch } = renderPanel([SHADE_1]);
    fireEvent.change(screen.getByLabelText("Region shade 1 x2"), { target: { value: "50" } });
    expect(onPatch).toHaveBeenCalledWith("sh1", { x2: 50 });
  });

  it("clearing a coordinate field does not commit an undefined write", () => {
    const { onPatch } = renderPanel([SHADE_1]);
    fireEvent.change(screen.getByLabelText("Region shade 1 x1"), { target: { value: "" } });
    expect(onPatch).not.toHaveBeenCalled();
  });

  it("edits a shade's fill color", () => {
    const { onPatch } = renderPanel([SHADE_1]);
    fireEvent.change(screen.getByLabelText("Region shade 1 fill"), { target: { value: "#00ff00" } });
    expect(onPatch).toHaveBeenCalledWith("sh1", { fill: "#00ff00" });
  });

  it("shows the row's current axis and toggles it, unlike RefLinePropertiesPanel's fixed axis", () => {
    // Both the row AND the Add form carry a "Y"/"Y2" segmented control, so
    // the row's is the FIRST of each pair (rows render before the Add form).
    const { onPatch } = renderPanel([SHADE_1]);
    fireEvent.click(screen.getAllByRole("tab", { name: "Y2" })[0]);
    expect(onPatch).toHaveBeenCalledWith("sh1", { axis: 1 });
  });

  it("toggling axis: 1 back to Y commits the explicit primary value 0", () => {
    const { onPatch } = renderPanel([SHADE_2]);
    fireEvent.click(screen.getAllByRole("tab", { name: "Y" })[0]);
    expect(onPatch).toHaveBeenCalledWith("sh2", { axis: 0 });
  });

  it("removes a shade via its remove button", () => {
    const { onRemove } = renderPanel([SHADE_1, SHADE_2]);
    fireEvent.click(screen.getByLabelText("Remove Region shade 2"));
    expect(onRemove).toHaveBeenCalledWith("sh2");
  });
});

describe("RegionShadePropertiesPanel — Add form", () => {
  it("renders the Add form with no shades yet, so the first shade is reachable here", () => {
    renderPanel([]);
    expect(screen.getByLabelText("new shade x1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeEnabled();
  });

  it("adds a shade with the entered coordinates + fill + axis", () => {
    const { onAdd } = renderPanel([]);
    fireEvent.change(screen.getByLabelText("new shade x1"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("new shade y1"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("new shade x2"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("new shade y2"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("new shade fill"), { target: { value: "#ff0000" } });
    fireEvent.click(screen.getByRole("tab", { name: "Y2" }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onAdd).toHaveBeenCalledWith({ x1: 10, y1: 20, x2: 30, y2: 40, fill: "#ff0000", axis: 1 });
  });

  it("defaults a fresh shade to the primary axis (no axis key at all)", () => {
    const { onAdd } = renderPanel([]);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onAdd).toHaveBeenCalledWith(expect.not.objectContaining({ axis: expect.anything() }));
  });

  it("disables Add and explains why for a non-numeric coordinate", () => {
    const { onAdd } = renderPanel([]);
    fireEvent.change(screen.getByLabelText("new shade x1"), { target: { value: "abc" } });
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    expect(screen.getByText("coordinates must be numbers")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("disables Add for a blank coordinate without shouting an error at an untouched field", () => {
    renderPanel([]);
    fireEvent.change(screen.getByLabelText("new shade x1"), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    expect(screen.queryByText("enter every coordinate")).not.toBeInTheDocument();
  });

  it("commits on Enter from any coordinate field, matching the Stage card's keyboard affordance", () => {
    const { onAdd } = renderPanel([]);
    const field = screen.getByLabelText("new shade x1");
    fireEvent.change(field, { target: { value: "5" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ x1: 5 }));
  });

  it("ignores Enter when a coordinate is not addable", () => {
    const { onAdd } = renderPanel([]);
    const field = screen.getByLabelText("new shade x1");
    fireEvent.change(field, { target: { value: "abc" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("resets the Add coordinate fields after a successful add", () => {
    renderPanel([]);
    fireEvent.change(screen.getByLabelText("new shade x1"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByLabelText("new shade x1")).toHaveValue("0");
  });
});
