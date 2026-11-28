// Plan item 50: the panel's legend corner picker and the Legend popup's offer
// ONE option list (lib/legendPositions.ts), and `corner={false}` (the Axes
// card in popup mode) keeps only the on/off toggle.

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { LEGEND_POS_OPTIONS } from "../../lib/legendPositions";
import { useApp } from "../../store/useApp";
import LegendPositionField from "../overlays/figuredialogs/LegendPositionField";
import LegendControls from "./LegendControls";

const labels = (el: HTMLElement) => [...el.querySelectorAll("option")].map((o) => o.textContent);

beforeEach(() => useApp.setState({ showLegend: true, legendPos: "auto" }));

describe("legend corner options", () => {
  it("the panel control and the popup field list the same corners", () => {
    const { unmount } = render(<LegendControls />);
    const panel = labels(screen.getByLabelText("Legend position"));
    unmount();
    render(<LegendPositionField value="auto" onChange={() => {}} />);
    const popup = labels(screen.getByLabelText("Legend position"));
    expect(panel).toEqual(LEGEND_POS_OPTIONS.map((o) => o.label));
    expect(popup).toEqual(panel);
  });

  it("corner={false} shows the toggle and no picker", () => {
    render(<LegendControls corner={false} />);
    expect(screen.getByLabelText("Legend")).toBeInTheDocument();
    expect(screen.queryByLabelText("Legend position")).toBeNull();
  });
});
