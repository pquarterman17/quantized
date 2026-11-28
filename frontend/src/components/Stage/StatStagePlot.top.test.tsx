// The facet grid stays below the tool bar when it takes over the flat plot's div (acceptance 14, C1):
// React cleared the old `inset` (and with it `top`) without reapplying the unchanged `top`.

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import StatStagePlot from "./StatStagePlot";
import type { FacetDraw } from "./useStatStageCompute";

vi.mock("./StatStageCanvas", () => ({ default: () => null }));

const box = { mode: "box", boxes: [], valueLabel: "y", groupLabel: "g" };
const facets = [{ label: "a", draw: box }, { label: "b", draw: box }] as unknown as FacetDraw[];

function plot(top: number, drawFacets: FacetDraw[] | null) {
  return <StatStagePlot draw={drawFacets ? null : (box as never)} drawFacets={drawFacets} theme={"dark" as never} accent={"violet" as never} sel={null} right={0} top={top} />;
}

describe("StatStagePlot top clearance", () => {
  it("applies the tool bar clearance to the grid after the flat plot had the same clearance", () => {
    const { container, rerender } = render(plot(170, null));
    expect((container.firstElementChild as HTMLElement).style.top).toBe("170px");
    rerender(plot(170, facets));
    const grid = container.firstElementChild as HTMLElement;
    expect(grid.style.display).toBe("grid");
    expect(grid.style.top).toBe("170px");
  });

  it("keeps it going back from the grid to the flat plot (a facet Box switched to Ridgeline)", () => {
    const { container, rerender } = render(plot(170, facets));
    rerender(plot(170, null));
    expect((container.firstElementChild as HTMLElement).style.top).toBe("170px");
  });

  it("follows a clearance that grows as the bar wraps", () => {
    const { container, rerender } = render(plot(50, facets));
    rerender(plot(170, facets));
    expect((container.firstElementChild as HTMLElement).style.top).toBe("170px");
  });
});
