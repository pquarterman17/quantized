import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Badge, Button, Card, MetaRow, Pill, RangeSlider, Switch } from "./index";

describe("primitives", () => {
  it("Button applies the primary variant class", () => {
    render(<Button variant="primary">Run fit</Button>);
    const btn = screen.getByRole("button", { name: "Run fit" });
    expect(btn).toHaveClass("qz-btn", "qz-primary");
  });

  it("Card renders a collapsible details with its title", () => {
    render(<Card title="CORRECTIONS">body</Card>);
    expect(screen.getByText("CORRECTIONS")).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("MetaRow shows label and value", () => {
    render(<MetaRow label="Points" value={201} />);
    expect(screen.getByText("Points")).toBeInTheDocument();
    expect(screen.getByText("201")).toBeInTheDocument();
  });

  it("Badge carries its tone class", () => {
    render(<Badge tone="accent">3ch</Badge>);
    expect(screen.getByText("3ch")).toHaveClass("qz-badge", "qz-accent");
  });

  it("Switch reflects checked state via aria + qz-on", () => {
    render(<Switch checked />);
    const sw = screen.getByRole("switch");
    expect(sw).toHaveClass("qz-switch", "qz-on");
    expect(sw).toHaveAttribute("aria-checked", "true");
  });

  it("Pill toggles aria-pressed from active", () => {
    render(<Pill active>field</Pill>);
    expect(screen.getByRole("button", { name: "field" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  describe("RangeSlider", () => {
    it("renders two labelled thumbs at their given values", () => {
      render(<RangeSlider min={0} max={10} lo={2} hi={8} onChange={vi.fn()} />);
      expect(screen.getByLabelText("minimum")).toHaveValue("2");
      expect(screen.getByLabelText("maximum")).toHaveValue("8");
    });

    it("moving the low thumb reports the clamped [lo, hi] pair", () => {
      const onChange = vi.fn();
      render(<RangeSlider min={0} max={10} lo={2} hi={8} onChange={onChange} />);
      fireEvent.change(screen.getByLabelText("minimum"), { target: { value: "5" } });
      expect(onChange).toHaveBeenCalledWith(5, 8);
    });

    it("the low thumb never crosses the current high value", () => {
      const onChange = vi.fn();
      render(<RangeSlider min={0} max={10} lo={2} hi={8} onChange={onChange} />);
      fireEvent.change(screen.getByLabelText("minimum"), { target: { value: "20" } });
      expect(onChange).toHaveBeenCalledWith(8, 8);
    });

    it("moving the high thumb reports the clamped pair and never crosses lo", () => {
      const onChange = vi.fn();
      render(<RangeSlider min={0} max={10} lo={2} hi={8} onChange={onChange} />);
      fireEvent.change(screen.getByLabelText("maximum"), { target: { value: "1" } });
      expect(onChange).toHaveBeenCalledWith(2, 2);
    });

    it("uses caller-supplied thumb labels", () => {
      render(
        <RangeSlider min={0} max={10} lo={2} hi={8} onChange={vi.fn()} loLabel="A min" hiLabel="A max" />,
      );
      expect(screen.getByLabelText("A min")).toBeInTheDocument();
      expect(screen.getByLabelText("A max")).toBeInTheDocument();
    });
  });
});
