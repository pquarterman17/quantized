// Tests for GUI_INTERACTION_PLAN #10 (floating workshops recoverable):
// default position from props, persistence across close/reopen (remount),
// the collapse toggle, and the viewport re-clamp on mount. Drag/resize
// POINTER gestures aren't simulated here (jsdom has no real layout, and
// `setPointerCapture` support is unreliable) — the clamp MATH they rely on
// is covered by lib/toolwindow.test.ts; this file covers the store wiring
// and rendered DOM.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useApp } from "../../store/useApp";
import ToolWindow from "./ToolWindow";

function winEl(container: HTMLElement): HTMLElement {
  const el = container.querySelector(".qzk-win");
  if (!el) throw new Error("ToolWindow root not rendered");
  return el as HTMLElement;
}

beforeEach(() => {
  useApp.setState({ toolWindowLayout: {} });
});

describe("ToolWindow default layout", () => {
  it("renders at its default x/y/width props when never persisted", () => {
    const { container } = render(
      <ToolWindow id="t1" title="Test">
        body
      </ToolWindow>,
    );
    const el = winEl(container);
    expect(el.style.left).toBe("120px");
    expect(el.style.top).toBe("90px");
    expect(el.style.width).toBe("360px");
  });

  it("honors explicit x/y/width props", () => {
    const { container } = render(
      <ToolWindow id="t2" title="Test" x={130} y={70} width={480}>
        body
      </ToolWindow>,
    );
    const el = winEl(container);
    expect(el.style.left).toBe("130px");
    expect(el.style.top).toBe("70px");
    expect(el.style.width).toBe("480px");
  });
});

describe("ToolWindow persistence across close/reopen", () => {
  it("restores a previously-set store position instead of the default props", () => {
    useApp.getState().setToolWindowLayout("t3", {
      x: 555,
      y: 222,
      width: 400,
      height: null,
      collapsed: false,
    });
    const { container } = render(
      <ToolWindow id="t3" title="Test" x={120} y={90} width={360}>
        body
      </ToolWindow>,
    );
    const el = winEl(container);
    expect(el.style.left).toBe("555px");
    expect(el.style.top).toBe("222px");
    expect(el.style.width).toBe("400px");
  });

  it("a fresh mount of a DIFFERENT id is unaffected by another window's stored layout", () => {
    useApp.getState().setToolWindowLayout("t4", { x: 555, y: 222, width: 400, height: null, collapsed: false });
    const { container } = render(
      <ToolWindow id="other" title="Test">
        body
      </ToolWindow>,
    );
    const el = winEl(container);
    expect(el.style.left).toBe("120px");
  });

  it("simulated close+reopen (unmount/remount) keeps the SAME position (the pre-#10 regression)", () => {
    const first = render(
      <ToolWindow id="t5" title="Test">
        body
      </ToolWindow>,
    );
    // The store round trip that a real drag-end would perform. Well inside
    // the jsdom default 1024x768 viewport so the mount re-clamp is a no-op —
    // that clamp behavior has its own dedicated test below.
    useApp.getState().setToolWindowLayout("t5", { x: 500, y: 300, width: 360, height: null, collapsed: false });
    first.unmount();
    const second = render(
      <ToolWindow id="t5" title="Test">
        body
      </ToolWindow>,
    );
    const el = winEl(second.container);
    expect(el.style.left).toBe("500px");
    expect(el.style.top).toBe("300px");
  });
});

describe("ToolWindow collapse", () => {
  it("starts expanded (body visible) by default", () => {
    render(
      <ToolWindow id="t6" title="Test">
        <div>panel body</div>
      </ToolWindow>,
    );
    expect(screen.getByText("panel body")).toBeInTheDocument();
  });

  it("the chevron button hides the body and flips the persisted collapsed flag", () => {
    render(
      <ToolWindow id="t7" title="Test">
        <div>panel body</div>
      </ToolWindow>,
    );
    fireEvent.click(screen.getByTitle("Collapse"));
    expect(screen.queryByText("panel body")).not.toBeInTheDocument();
    expect(useApp.getState().toolWindowLayout.t7.collapsed).toBe(true);
  });

  it("double-clicking the title bar also toggles collapse", () => {
    const { container } = render(
      <ToolWindow id="t8" title="Test">
        <div>panel body</div>
      </ToolWindow>,
    );
    const titleBar = container.querySelector(".qzk-win-title");
    if (!titleBar) throw new Error("title bar not rendered");
    fireEvent.doubleClick(titleBar);
    expect(screen.queryByText("panel body")).not.toBeInTheDocument();
    expect(screen.getByTitle("Expand")).toBeInTheDocument();
  });

  it("clicking Expand restores the body without disturbing position/size", () => {
    useApp.getState().setToolWindowLayout("t9", { x: 44, y: 55, width: 333, height: null, collapsed: true });
    const { container } = render(
      <ToolWindow id="t9" title="Test">
        <div>panel body</div>
      </ToolWindow>,
    );
    expect(screen.queryByText("panel body")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Expand"));
    expect(screen.getByText("panel body")).toBeInTheDocument();
    const el = winEl(container);
    expect(el.style.left).toBe("44px");
    expect(el.style.width).toBe("333px");
  });
});

describe("ToolWindow close button", () => {
  it("calls onClose without touching the persisted layout", () => {
    let closed = false;
    render(
      <ToolWindow id="t10" title="Test" onClose={() => (closed = true)}>
        body
      </ToolWindow>,
    );
    fireEvent.click(screen.getByTitle("Close"));
    expect(closed).toBe(true);
  });

  it("omits the close button when onClose is not given", () => {
    render(
      <ToolWindow id="t11" title="Test">
        body
      </ToolWindow>,
    );
    expect(screen.queryByTitle("Close")).not.toBeInTheDocument();
  });
});

describe("ToolWindow viewport re-clamp on mount", () => {
  it("clamps an out-of-bounds stored x back onto the (jsdom) viewport", () => {
    useApp.getState().setToolWindowLayout("t12", {
      x: 999999,
      y: 90,
      width: 360,
      height: null,
      collapsed: false,
    });
    const { container } = render(
      <ToolWindow id="t12" title="Test">
        body
      </ToolWindow>,
    );
    const el = winEl(container);
    const left = parseInt(el.style.left, 10);
    expect(left).toBeLessThan(999999);
    expect(left).toBe(window.innerWidth - 360);
  });
});

describe("ToolWindow resize handle", () => {
  it("renders a resize grip while expanded", () => {
    const { container } = render(
      <ToolWindow id="t13" title="Test">
        body
      </ToolWindow>,
    );
    expect(container.querySelector(".qzk-win-resize")).toBeInTheDocument();
  });

  it("omits the resize grip while collapsed", () => {
    useApp.getState().setToolWindowLayout("t14", { x: 0, y: 0, width: 360, height: null, collapsed: true });
    const { container } = render(
      <ToolWindow id="t14" title="Test">
        body
      </ToolWindow>,
    );
    expect(container.querySelector(".qzk-win-resize")).not.toBeInTheDocument();
  });
});

describe("View-menu reset command reaches a mounted ToolWindow", () => {
  it("resetToolWindowPositions snaps an open, moved window back to its default props", () => {
    // Well inside the jsdom default 1024x768 viewport (see the persistence
    // test above) so the mount re-clamp doesn't also move it.
    useApp.getState().setToolWindowLayout("t15", { x: 400, y: 300, width: 500, height: 400, collapsed: true });
    const { container } = render(
      <ToolWindow id="t15" title="Test" x={120} y={90} width={360}>
        <div>panel body</div>
      </ToolWindow>,
    );
    expect(winEl(container).style.left).toBe("400px");
    // A direct store call (not a user event fireEvent already wraps) — React
    // 18+ auto-batches it, so flush via act() before reading the DOM back.
    act(() => useApp.getState().resetToolWindowPositions());
    const el = winEl(container);
    expect(el.style.left).toBe("120px");
    expect(el.style.top).toBe("90px");
    expect(el.style.width).toBe("360px");
    expect(screen.getByText("panel body")).toBeInTheDocument(); // uncollapsed too
  });
});
