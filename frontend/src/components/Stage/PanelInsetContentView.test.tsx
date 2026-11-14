import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PanelInsetContent } from "../../lib/panelInset";
import PanelInsetContentView from "./PanelInsetContentView";

describe("PanelInsetContentView", () => {
  it("renders a dataset's series as an SVG polyline, with its title and legend", () => {
    const content: PanelInsetContent = {
      kind: "dataset",
      title: "Other dataset",
      x: [0, 1, 2],
      series: [{ label: "fit", y: [1, 2, 3], color: "#ff0000" }],
      legend: true,
    };
    render(<PanelInsetContentView content={content} />);
    expect(screen.getByText("Other dataset")).toBeInTheDocument();
    expect(screen.getByText("fit")).toBeInTheDocument();
    expect(document.querySelector("polyline")).toHaveAttribute("stroke", "#ff0000");
  });

  it("renders an image", () => {
    const content: PanelInsetContent = { kind: "image", dataUrl: "data:image/png;base64,AAAA", title: "Photo" };
    render(<PanelInsetContentView content={content} />);
    const img = screen.getByAltText("Photo");
    expect(img).toHaveAttribute("src", "data:image/png;base64,AAAA");
  });

  it("renders a table with headers and rows", () => {
    const content: PanelInsetContent = {
      kind: "table",
      headers: ["param", "value"],
      rows: [["x0", "1.23"]],
    };
    render(<PanelInsetContentView content={content} />);
    expect(screen.getByText("param")).toBeInTheDocument();
    expect(screen.getByText("1.23")).toBeInTheDocument();
  });
});
