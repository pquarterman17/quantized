import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import SpatialPanelLegend from "./SpatialPanelLegend";

describe("SpatialPanelLegend", () => {
  it("uses the ordinary legend swatch contract for line+symbol styles", () => {
    const { container } = render(
      <SpatialPanelLegend
        entries={[
          {
            label: "Measured",
            displayIndex: 0,
            style: { color: "#ff8000", width: 1.5, marker: true, markerShape: "square" },
          },
        ]}
      />,
    );
    const sample = container.querySelector(".qzk-legend-sample");
    expect(sample?.getAttribute("data-line")).toBe("true");
    expect(sample?.getAttribute("data-marker")).toBe("square");
    expect(container.textContent).toContain("Measured");
  });

  // Same rule as the export and PlotLegend: a zero-length label has no row.
  it("drops an entry whose label is empty, keeping the others", () => {
    const { container } = render(
      <SpatialPanelLegend
        entries={[
          { label: "", displayIndex: 0 },
          { label: "Kept", displayIndex: 1 },
        ]}
      />,
    );
    expect(container.querySelectorAll(".it")).toHaveLength(1);
    expect(container.querySelectorAll(".qzk-legend-sample")).toHaveLength(1);
    expect(container.textContent).toContain("Kept");
  });

  it("renders nothing when every entry is empty and there is no title", () => {
    const { container } = render(<SpatialPanelLegend entries={[{ label: "", displayIndex: 0 }]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing without independently decoded title or entries", () => {
    const { container } = render(<SpatialPanelLegend entries={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
