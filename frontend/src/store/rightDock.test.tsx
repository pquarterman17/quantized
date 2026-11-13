// A docked Curve Fit / Peak Analyzer makes the stage reflow to its left
// (fitting live check: the docked window covered ~60 px of the plot and the
// legend). The registry, the clearance and ToolWindow's registration.

import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import ToolWindow from "../components/overlays/ToolWindow";
import { DOCK_GAP, isRightDocked, rightDockClearance, setRightDock, useRightDockLeft } from "./rightDock";
import { useApp } from "./useApp";

function Probe({ out }: { out: { left: number | null } }) {
  out.left = useRightDockLeft();
  return null;
}

afterEach(() => {
  setRightDock("a", null);
  setRightDock("b", null);
  useApp.setState({ toolWindowLayout: {} });
});

describe("right dock", () => {
  it("clears the stage by how far it reaches under the left-most docked window", () => {
    expect(rightDockClearance(1305, null)).toBe(0);
    expect(rightDockClearance(1305, 1244)).toBe(1305 - 1244 + DOCK_GAP);
    // A window wholly over the side column needs no room from the stage.
    expect(rightDockClearance(1200, 1300)).toBe(0);
    setRightDock("a", 1244);
    setRightDock("b", 1164);
    const out = { left: null as number | null };
    render(<Probe out={out} />);
    expect(out.left).toBe(1164);
  });

  it("a window is docked only while its right edge is at the viewport's", () => {
    expect(isRightDocked(1244, 340, 1600)).toBe(true);
    expect(isRightDocked(900, 340, 1600)).toBe(false);
  });

  it('a dock="right" ToolWindow registers while docked and unregisters on close', () => {
    const out = { left: null as number | null };
    const x = window.innerWidth - 340 - 16;
    const { unmount } = render(
      <>
        <Probe out={out} />
        <ToolWindow id="a" title="Curve Fit" width={340} x={x} dock="right">body</ToolWindow>
      </>,
    );
    expect(out.left).toBe(x);
    unmount();
    const after = { left: 0 as number | null };
    render(<Probe out={after} />);
    expect(after.left).toBeNull();
  });

  it("a ToolWindow without dock, or dragged away from the edge, does not reserve room", () => {
    const out = { left: null as number | null };
    render(
      <>
        <Probe out={out} />
        <ToolWindow id="a" title="Plain" width={340} x={window.innerWidth - 356}>body</ToolWindow>
        <ToolWindow id="b" title="Floating" width={340} x={100} dock="right">body</ToolWindow>
      </>,
    );
    expect(out.left).toBeNull();
  });
});
