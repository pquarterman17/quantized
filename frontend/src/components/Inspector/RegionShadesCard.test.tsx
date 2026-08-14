// F2.3j: region shades are EDITABLE plot objects, not immutable provenance
// (owner decision 2026-08-13). This card follows RefLinesCard's "ADD belongs
// here" convention (a shade is fully specified by numbers) plus ShapesCard's
// editable-coordinate-fields convention (a shade has four coordinates + a
// fill color, not one value).

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import RegionShadesCard from "./RegionShadesCard";
import { useApp } from "../../store/useApp";

beforeEach(() => {
  useApp.setState({ regionShades: [] });
});

describe("RegionShadesCard — empty state + Add", () => {
  it("renders the Add form's coordinate fields with sensible defaults", () => {
    render(<RegionShadesCard />);
    expect(screen.getByPlaceholderText("x1")).toHaveValue("0");
    expect(screen.getByPlaceholderText("y1")).toHaveValue("0");
    expect(screen.getByPlaceholderText("x2")).toHaveValue("1");
    expect(screen.getByPlaceholderText("y2")).toHaveValue("1");
  });

  it("Add commits a new shade via addRegionShade with the entered coordinates + fill", () => {
    render(<RegionShadesCard />);
    fireEvent.change(screen.getByPlaceholderText("x1"), { target: { value: "2" } });
    fireEvent.change(screen.getByPlaceholderText("y1"), { target: { value: "3" } });
    fireEvent.change(screen.getByPlaceholderText("x2"), { target: { value: "4" } });
    fireEvent.change(screen.getByPlaceholderText("y2"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("New shade fill color"), { target: { value: "#ff0000" } });
    fireEvent.click(screen.getByText("Add"));
    expect(useApp.getState().regionShades).toEqual([
      expect.objectContaining({ x1: 2, y1: 3, x2: 4, y2: 5, fill: "#ff0000" }),
    ]);
  });

  it("Add defaults a fresh shade to the primary axis (no axis key at all)", () => {
    render(<RegionShadesCard />);
    fireEvent.click(screen.getByText("Add"));
    expect(useApp.getState().regionShades[0]).not.toHaveProperty("axis");
  });

  it("picking Y2 before Add tags the new shade axis: 1", () => {
    render(<RegionShadesCard />);
    fireEvent.click(screen.getAllByRole("tab", { name: "Y2" })[0]);
    fireEvent.click(screen.getByText("Add"));
    expect(useApp.getState().regionShades[0].axis).toBe(1);
  });

  it("disables Add and explains why when a coordinate is left blank", () => {
    render(<RegionShadesCard />);
    fireEvent.change(screen.getByPlaceholderText("x1"), { target: { value: "" } });
    expect(screen.getByText("Add")).toBeDisabled();
  });

  it("disables Add when a coordinate is not a number", () => {
    render(<RegionShadesCard />);
    fireEvent.change(screen.getByPlaceholderText("x1"), { target: { value: "abc" } });
    expect(screen.getByText("Add")).toBeDisabled();
  });
});

describe("RegionShadesCard — existing shade: edit + remove", () => {
  beforeEach(() => {
    useApp.setState({
      regionShades: [{ id: "sh1", x1: 1, y1: 2, x2: 3, y2: 4, fill: "#336699" }],
    });
  });

  it("shows the shade's current coordinates and fill in editable fields", () => {
    render(<RegionShadesCard />);
    expect(screen.getAllByPlaceholderText("x1")[0]).toHaveValue("1");
    expect(screen.getAllByPlaceholderText("y1")[0]).toHaveValue("2");
    expect(screen.getAllByPlaceholderText("x2")[0]).toHaveValue("3");
    expect(screen.getAllByPlaceholderText("y2")[0]).toHaveValue("4");
    expect(screen.getByLabelText("Fill color")).toHaveValue("#336699");
  });

  it("typing a new x2 commits it via updateRegionShade", () => {
    render(<RegionShadesCard />);
    fireEvent.change(screen.getAllByPlaceholderText("x2")[0], { target: { value: "10" } });
    expect(useApp.getState().regionShades[0].x2).toBe(10);
  });

  it("changing the fill color commits it via updateRegionShade", () => {
    render(<RegionShadesCard />);
    fireEvent.change(screen.getByLabelText("Fill color"), { target: { value: "#00ff00" } });
    expect(useApp.getState().regionShades[0].fill).toBe("#00ff00");
  });

  it("toggling the row's axis to Y2 commits axis: 1 via updateRegionShade", () => {
    render(<RegionShadesCard />);
    fireEvent.click(screen.getAllByRole("tab", { name: "Y2" })[0]);
    expect(useApp.getState().regionShades[0].axis).toBe(1);
  });

  it("toggling back to Y commits axis: 0 (not undefined) via updateRegionShade", () => {
    useApp.setState({
      regionShades: [{ id: "sh1", x1: 1, y1: 2, x2: 3, y2: 4, fill: "#336699", axis: 1 }],
    });
    render(<RegionShadesCard />);
    fireEvent.click(screen.getAllByRole("tab", { name: "Y" })[0]);
    expect(useApp.getState().regionShades[0].axis).toBe(0);
  });

  it("Remove drops the shade via removeRegionShade", () => {
    render(<RegionShadesCard />);
    fireEvent.click(screen.getByLabelText("Remove region shade"));
    expect(useApp.getState().regionShades).toHaveLength(0);
  });

  it("shows the shade count badge", () => {
    render(<RegionShadesCard />);
    expect(screen.getByText("1")).toBeInTheDocument();
  });
});
