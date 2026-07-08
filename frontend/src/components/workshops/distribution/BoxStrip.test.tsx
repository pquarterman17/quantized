import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import BoxStrip from "./BoxStrip";

describe("BoxStrip", () => {
  it("renders titles for min/Q1-Q3/median/max", () => {
    render(<BoxStrip min={10} q1={20} median={35} q3={50} max={60} />);
    expect(screen.getByTitle("min 10")).toBeInTheDocument();
    expect(screen.getByTitle("max 60")).toBeInTheDocument();
    expect(screen.getByTitle("median 35")).toBeInTheDocument();
    expect(screen.getByTitle("Q1 20 – Q3 50 (IQR)")).toBeInTheDocument();
  });

  it("renders nothing when any quantile is non-finite (sparse column)", () => {
    const { container } = render(<BoxStrip min={10} q1={NaN} median={35} q3={50} max={60} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is present (labelled) for a valid strip", () => {
    render(<BoxStrip min={0} q1={1} median={2} q3={3} max={4} />);
    expect(screen.getByLabelText("box-quantile strip")).toBeInTheDocument();
  });
});
