// Q6 (b): a v3 recipe's thumbnail shows its multi-panel layout as a grid
// glyph and marks a recorded map view -- even when no curve preview was saved
// (a composite panel window records none), it never reads "no preview".

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RecipeThumbnail } from "./RecipeThumbnail";

const preview = { series: [[[0, 0], [1, 1]] as [number, number][]] };

describe("RecipeThumbnail glyph", () => {
  it("draws the panel grid's dividers and names the layout and map in its label", () => {
    render(<RecipeThumbnail preview={preview} label="R" glyph={{ grid: { rows: 2, cols: 3 }, map: true }} />);
    const thumb = screen.getByRole("img", { name: "R: preview, 2×3 panels, map view" });
    // 1 row divider + 2 column dividers.
    expect(thumb.querySelectorAll("line[data-grid]")).toHaveLength(3);
    expect(thumb.querySelector("[data-map]")).not.toBeNull();
  });

  it("shows the grid glyph instead of the dashed 'no preview' frame when only the layout was recorded", () => {
    render(<RecipeThumbnail preview={null} label="R" glyph={{ grid: { rows: 1, cols: 2 }, map: false }} />);
    expect(screen.queryByRole("img", { name: "R: no preview" })).toBeNull();
    const thumb = screen.getByRole("img", { name: "R: 1×2 panels" });
    expect(thumb.querySelectorAll("line[data-grid]")).toHaveLength(1);
  });

  it("is unchanged for a plain recipe", () => {
    render(<RecipeThumbnail preview={preview} label="R" glyph={{ grid: null, map: false }} />);
    const thumb = screen.getByRole("img", { name: "R: preview" });
    expect(thumb.querySelectorAll("line[data-grid]")).toHaveLength(0);
    expect(thumb.querySelector("[data-map]")).toBeNull();
  });
});
