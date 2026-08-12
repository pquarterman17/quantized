// The map's drawing-tool glyphs.
//
// Owner report from a real release test: "the controls were confusing (the
// icon wasn't super clear)". Two distinct problems sat behind it, and both are
// the kind a green suite happily ignores, so they get pinned here:
//
//   1. The box and the ruler wore ▭ and ▱ — a rectangle and a near-rectangle,
//      the same silhouette at 13 px.
//   2. Both glyphs were ALREADY spoken for elsewhere in the app: ▭ is the
//      Rectangle shape tool (and the Background Region tool) in
//      plotToolbarDefs, ▱ is the plot toolbar's shape-dock button. So the map
//      was wearing two other tools' icons.
//
// Neither is a matter of taste, which is why they're tests: (1) is "these two
// buttons must not be confusable" and (2) is "one glyph, one meaning".

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SHAPE_TOOLS, TOOL_DEFS } from "../../lib/plotToolbarDefs";
import MapToolbar, { type MapToolbarProps } from "./MapToolbar";

function renderToolbar(overrides: Partial<MapToolbarProps> = {}) {
  const props: MapToolbarProps = {
    qAvailable: true, isAngular: true, isQ: false, onAngular: vi.fn(), onQ: vi.fn(),
    labels: ["2Theta", "Omega", "Intensity", "Qx", "Qz"], keys: [0, 1, 2], onKeyChange: vi.fn(),
    cmap: "viridis", cmapOptions: ["viridis"], onCmapChange: vi.fn(),
    logZ: false, onToggleLogZ: vi.fn(), contourOn: false, onToggleContour: vi.fn(),
    cutSpace: "angular", gridable: true, cutMode: "off", onSetCutMode: vi.fn(),
    cutWidth: 0, onSetCutWidth: vi.fn(), cutWidthTooltip: "", onProjection: vi.fn(),
    roiMode: "off", onToggleRoi: vi.fn(),
    rulerMode: "off", onToggleRuler: vi.fn(),
    wedgeMode: "off", onToggleWedge: vi.fn(),
    onSavePng: vi.fn(),
    ...overrides,
  } as MapToolbarProps;
  render(<MapToolbar {...props} />);
}

/** The one button whose tooltip starts with `lead`. Selecting by the tooltip
 *  rather than the glyph is deliberate: the glyph is the thing under test. */
function toolByTitle(lead: string): HTMLElement {
  const match = screen
    .getAllByRole("button")
    .filter((b) => (b.getAttribute("title") ?? "").startsWith(lead));
  expect(match, `no tool titled "${lead}…"`).toHaveLength(1);
  return match[0]!;
}

describe("MapToolbar drawing-tool glyphs", () => {
  it("does not give the box and the ruler the same silhouette", () => {
    renderToolbar();
    const box = toolByTitle("Integration box").textContent;
    const ruler = toolByTitle("Angled line cut").textContent;
    expect(box).not.toBe(ruler);
    // ▭ vs ▱ was "different string, same picture". Both of those are now out
    // of this toolbar entirely — see the collision test below, which is what
    // actually enforces it; this one only guards the trivial case.
    expect([box, ruler]).not.toContain("▭");
    expect([box, ruler]).not.toContain("▱");
  });

  it("does not reuse a glyph that already means something else in the app", () => {
    renderToolbar();
    // Every glyph the plot toolbar has already claimed: the shape dock's
    // flyout items and every tool with a ToolDef (which includes the ▱ dock
    // button's own fallback and the ▭ Background Region tool).
    const claimed = new Set<string>([
      ...SHAPE_TOOLS.map((s) => s.glyph),
      ...Object.values(TOOL_DEFS).flatMap((d) => (d ? [d.glyph] : [])),
      "▱", // PlotToolbar's shape-dock button fallback
    ]);
    for (const lead of ["Integration box", "Angled line cut", "Sector wedge"]) {
      const glyph = toolByTitle(lead).textContent ?? "";
      expect(claimed, `${lead} reuses "${glyph}", which the plot toolbar already means something else by`).not.toContain(glyph);
    }
  });

  it("leads each tooltip with what the tool produces, not with its shape", () => {
    renderToolbar();
    // "Box ROI:" / "Cut ruler:" named the drawing; someone trying to integrate
    // a region has to translate. These name the outcome first.
    expect(toolByTitle("Integration box")).toHaveAttribute(
      "title",
      expect.stringContaining("drag on the map to draw one"),
    );
    expect(toolByTitle("Angled line cut")).toHaveAttribute(
      "title",
      expect.stringContaining("drag along the cut direction"),
    );
  });

  it("still marks the armed tool active, one at a time", () => {
    renderToolbar({ roiMode: "roi" });
    expect(toolByTitle("Integration box").className).toContain("active");
    expect(toolByTitle("Angled line cut").className).not.toContain("active");
  });
});
