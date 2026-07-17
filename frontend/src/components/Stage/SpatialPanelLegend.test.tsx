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

  it("renders nothing without independently decoded title or entries", () => {
    const { container } = render(<SpatialPanelLegend entries={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
