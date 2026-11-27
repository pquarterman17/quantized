import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import FitOverlaysCard from "./FitOverlaysCard";
import { useApp } from "../../store/useApp";

beforeEach(() => {
  useApp.setState({ overlays: null, xScale: "linear", yScale: "linear", exchangeXY: false, waterfall: 0, waterfallDx: 0 });
});

describe("FitOverlaysCard", () => {
  it("starts with every overlay off", () => {
    render(<FitOverlaysCard />);
    fireEvent.click(screen.getByText("Fit overlays"));
    for (const name of ["Line of fit", "LOWESS smoother", "Ellipse"]) expect(screen.getByLabelText(name)).not.toBeChecked();
    expect(useApp.getState().overlays).toBeNull();
  });

  it("turning each overlay on stores it, and off again returns to null", () => {
    render(<FitOverlaysCard />);
    fireEvent.click(screen.getByText("Fit overlays"));
    fireEvent.click(screen.getByLabelText("Line of fit"));
    fireEvent.click(screen.getByLabelText("Ellipse"));
    expect(useApp.getState().overlays).toEqual({ line: { band: "none", level: 0.95 }, smoother: null, ellipse: { level: 0.95 } });
    fireEvent.click(screen.getByRole("radio", { name: "Confidence" }));
    expect(useApp.getState().overlays?.line?.band).toBe("confidence");
    fireEvent.click(screen.getByLabelText("Line of fit"));
    fireEvent.click(screen.getByLabelText("Ellipse"));
    expect(useApp.getState().overlays).toBeNull();
  });

  it("names the two ellipses, keeps the level when the kind changes, and offers centroid and hull", () => {
    render(<FitOverlaysCard />);
    fireEvent.click(screen.getByText("Fit overlays"));
    fireEvent.click(screen.getByLabelText("Ellipse"));
    expect(screen.getByText(/Data ellipse: where the points fall/)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "99%" }));
    fireEvent.click(screen.getByRole("radio", { name: "Mean ellipse" }));
    expect(useApp.getState().overlays?.ellipse).toEqual({ level: 0.99, kind: "mean" });
    expect(screen.getByText(/where the group mean lies/)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Data ellipse" }));
    expect(useApp.getState().overlays?.ellipse).toEqual({ level: 0.99 });
    fireEvent.click(screen.getByLabelText("Group centroid"));
    fireEvent.click(screen.getByLabelText("Convex hull"));
    expect(useApp.getState().overlays).toMatchObject({ centroid: true, hull: true });
    fireEvent.click(screen.getByLabelText("Ellipse"));
    fireEvent.click(screen.getByLabelText("Group centroid"));
    fireEvent.click(screen.getByLabelText("Convex hull"));
    expect(useApp.getState().overlays).toBeNull();
  });

  it("each change is one undo step", () => {
    render(<FitOverlaysCard />);
    fireEvent.click(screen.getByText("Fit overlays"));
    fireEvent.click(screen.getByLabelText("LOWESS smoother"));
    expect(useApp.getState().overlays?.smoother).toEqual({ span: 0.5 });
    useApp.getState().undo();
    expect(useApp.getState().overlays).toBeNull();
  });

  it("explains when the view cannot show them", () => {
    useApp.setState({ yScale: "log" });
    render(<FitOverlaysCard />);
    fireEvent.click(screen.getByText("Fit overlays"));
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByLabelText("Line of fit"));
    expect(screen.getByRole("status")).toHaveTextContent(/need linear axes/);
  });
});
