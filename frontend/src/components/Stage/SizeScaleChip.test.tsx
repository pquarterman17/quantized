import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { buildColorByColumns } from "../../lib/colorscatter";
import { sizeLegendEntries } from "../../lib/sizescatter";
import type { DataStruct } from "../../lib/types";
import SizeScaleChip from "./SizeScaleChip";

const ds: DataStruct = {
  time: [0, 1, 2],
  values: [[1, 0], [2, 2], [3, 4]],
  labels: ["M", "mass"],
  units: ["", "g"],
  metadata: {},
};

describe("SizeScaleChip (N5 size key)", () => {
  it("names the channel and shows three discs at the min / middle / max size", () => {
    const cols = buildColorByColumns(ds, [0], { 0: { sizeBy: 1, sizeRange: [4, 12] } });
    const [entry] = sizeLegendEntries(ds, [...cols.values()]);
    const { container } = render(<SizeScaleChip scale={entry} />);
    const chip = screen.getByRole("img");
    expect(chip.getAttribute("aria-label")).toBe("Marker size mass (g): 0 to 4");
    const dots = [...container.querySelectorAll<HTMLElement>(".qzk-sizekey-dot")].map((d) => d.style.width);
    expect(dots).toEqual(["4px", "8px", "12px"]);
  });
});
