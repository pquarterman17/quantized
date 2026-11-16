// EllipseFitPanel — the fit request (finite pairs only), the parameter table
// with standard errors, the method switch and the output dataset. Mocked backend.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EllipseResult } from "../../../lib/api/analysisExtras";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import EllipseFitPanel from "./EllipseFitPanel";

const { ellipseMock } = vi.hoisted(() => ({ ellipseMock: vi.fn() }));
vi.mock("../../../lib/api/analysisExtras", () => ({ ellipseFit: ellipseMock }));

const DATA: DataStruct = {
  time: [0, 1, 2, Number.NaN, 4, 5],
  values: [[1], [2], [3], [4], [Number.NaN], [6]],
  labels: ["y"],
  units: ["um"],
  metadata: { x_column_name: "x", x_column_unit: "um" },
};

const RESULT: EllipseResult = {
  n_points: 4, geometric: true, converged: true, center_x: 3, center_y: -2, semi_major: 5, semi_minor: 2, angle_deg: 30,
  center_x_se: 0.01, center_y_se: 0.02, semi_major_se: 0.03, semi_minor_se: 0.04, angle_deg_se: 0.5, rms: 0.05, arc_coverage_deg: 350,
  algebraic: { center_x: 3, center_y: -2, semi_major: 5, semi_minor: 2, angle_deg: 30 }, residuals: [0, 0, 0, 0],
  curve_x: [1, 2, 3, 1], curve_y: [1, 2, 0, 1],
};

beforeEach(() => {
  vi.clearAllMocks();
  ellipseMock.mockResolvedValue(RESULT);
  useApp.setState({ datasets: [{ id: "d", name: "loop", data: DATA }], activeId: "d", status: "" });
});

describe("EllipseFitPanel", () => {
  it("sends only the finite pairs and shows each parameter with its SE", async () => {
    render(<EllipseFitPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Fit ellipse" }));
    await screen.findByText("semi-major a");
    expect(ellipseMock).toHaveBeenCalledWith({ x: [0, 1, 2, 5], y: [1, 2, 3, 6], geometric: true });
    const row = screen.getByRole("cell", { name: "angle of a (°)" }).closest("tr")!;
    expect(row).toHaveTextContent("30");
    expect(row).toHaveTextContent("0.5");
    expect(screen.getByRole("img", { name: /fitted ellipse/ })).toBeInTheDocument();
  });

  it("warns when the points cover only a short arc", async () => {
    ellipseMock.mockResolvedValueOnce({ ...RESULT, arc_coverage_deg: 95 });
    render(<EllipseFitPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Fit ellipse" }));
    expect(await screen.findByText(/cover only about 95° of the curve/)).toBeInTheDocument();
  });

  it("switches to the algebraic method", async () => {
    render(<EllipseFitPanel />);
    fireEvent.change(screen.getByLabelText("Method"), { target: { value: "algebraic" } });
    fireEvent.click(screen.getByRole("button", { name: "Fit ellipse" }));
    await screen.findByText("semi-major a");
    expect(ellipseMock).toHaveBeenCalledWith(expect.objectContaining({ geometric: false }));
  });

  it("reports a backend error and clears nothing else", async () => {
    ellipseMock.mockRejectedValueOnce(new Error("an ellipse fit needs at least 5 finite points"));
    render(<EllipseFitPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Fit ellipse" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("at least 5");
  });

  it("adds the fitted ellipse as a dataset", async () => {
    render(<EllipseFitPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Fit ellipse" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add fitted ellipse as dataset" }));
    const added = useApp.getState().datasets.find((d) => d.name === "loop (fitted ellipse)")!;
    expect(added.data.time).toEqual([1, 2, 3, 1]);
    expect(added.data.values.map((r) => r[0])).toEqual([1, 2, 0, 1]);
    expect(added.data.metadata["ellipse_fit"]).toMatchObject({ se: { center_x: 0.01, semi_major: 0.03, angle_deg: 0.5 }, rms: 0.05 });
  });
});
