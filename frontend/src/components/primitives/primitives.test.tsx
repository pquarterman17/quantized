import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Badge, Button, Card, MetaRow, Pill, Switch } from "./index";

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
});
