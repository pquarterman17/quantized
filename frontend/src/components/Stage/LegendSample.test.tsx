// Gap audit 2 #6: the legend swatch draws the canvas' open / solid symbol.

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import LegendSample from "./LegendSample";

describe("LegendSample marker interior", () => {
  it("hollow leaves circle and closed glyphs unfilled; solid fills the circle", () => {
    const fillOf = (markerFill: "hollow" | "solid" | undefined, markerShape: "circle" | "square") => {
      const { container, unmount } = render(
        <LegendSample color="#f00" style={{ marker: true, markerShape, markerFill }} />,
      );
      const el = container.querySelector(markerShape === "circle" ? "circle" : "rect");
      const fill = el?.getAttribute("fill");
      unmount();
      return fill;
    };
    expect(fillOf("hollow", "circle")).toBe("none");
    expect(fillOf("hollow", "square")).toBe("none");
    expect(fillOf("solid", "circle")).toBe("#f00");
    expect(fillOf(undefined, "circle")).toBe("#fff"); // unchanged default
    expect(fillOf(undefined, "square")).toBe("#f00");
  });
});
