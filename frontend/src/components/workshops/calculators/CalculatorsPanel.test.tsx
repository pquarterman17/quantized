// Pins the CalculatorsPanel default ToolWindow geometry (owner report,
// 2026-08-02): the panel used to open at ToolWindow's generic 360-wide
// default, and card-heavy tabs from Electrical onward needed a manual resize
// before their options were visible — see the reasoning in CalculatorsPanel.tsx.
// Also pins the tab inventory CalculatorsContent renders (Home through
// Vacuum/Substrates and beyond), so a future edit that silently drops a
// domain group is caught here rather than by a user hunting for a missing tab.

import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useApp } from "../../../store/useApp";
import CalculatorsPanel from "./CalculatorsPanel";
import { TAB_GROUPS } from "./CalculatorsContent";

vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return {
    ...actual,
    // useCalculators fetches constants unconditionally on mount; stub it so
    // the test never depends on a real network round trip.
    getConstants: vi.fn().mockResolvedValue({ constants: {} }),
  };
});

function winEl(container: HTMLElement): HTMLElement {
  const el = container.querySelector(".qzk-win");
  if (!el) throw new Error("ToolWindow root not rendered");
  return el as HTMLElement;
}

beforeEach(() => {
  useApp.setState({ toolWindowLayout: {} });
});

describe("CalculatorsPanel default size", () => {
  it("opens wide enough that a typical card row doesn't wrap onto extra lines", () => {
    const { container } = render(<CalculatorsPanel />);
    expect(winEl(container).style.width).toBe("480px");
  });

  it("opens close enough to the top chrome to leave headroom under the max-height clamp", () => {
    const { container } = render(<CalculatorsPanel />);
    expect(winEl(container).style.top).toBe("70px");
  });

  it("keeps ToolWindow's own default x (unchanged — only width/y were the fix)", () => {
    const { container } = render(<CalculatorsPanel />);
    expect(winEl(container).style.left).toBe("120px");
  });
});

describe("CalculatorsContent tab inventory", () => {
  it("covers all 20 calculator domains across the 8 domain groups", () => {
    const total = TAB_GROUPS.reduce((n, g) => n + g.tabs.length, 0);
    expect(total).toBe(20);
  });

  it("includes every domain group Home through Electrochemistry, in order", () => {
    expect(TAB_GROUPS.map((g) => g.group)).toEqual([
      "Session",
      "Conversion",
      "Structure",
      "Transport",
      "Optics & Vacuum",
      "Devices",
      "Magnetism",
      "Electrochemistry",
    ]);
  });
});
