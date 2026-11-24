// UX menus audit M5: a right-click inside a floating tool window must not reach
// the plot stage underneath (whose onContextMenu opened the plot's menu), the
// title bar gets its own menu, and an editable field keeps the native one.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useApp } from "../../store/useApp";
import ToolWindow from "./ToolWindow";

beforeEach(() => {
  useApp.setState({ toolWindowLayout: {} });
});

function renderUnderStage(onStageMenu: (e: React.MouseEvent) => void) {
  return render(
    <div data-testid="stage" onContextMenu={onStageMenu}>
      <ToolWindow id="ctx-test" title="Fit model" onClose={() => {}} classic>
        <ul><li>Columns list</li></ul>
        <input aria-label="field" />
      </ToolWindow>
    </div>,
  );
}

describe("ToolWindow right-click", () => {
  it("never bubbles to the stage, from the title bar or the body", () => {
    const stage = vi.fn();
    renderUnderStage(stage);
    fireEvent.contextMenu(screen.getByRole("group", { name: "Fit model title bar" }));
    fireEvent.contextMenu(screen.getByText("Columns list"));
    expect(stage).not.toHaveBeenCalled();
  });

  it("opens the window's own menu on the title bar", async () => {
    renderUnderStage(() => {});
    fireEvent.contextMenu(screen.getByRole("group", { name: "Fit model title bar" }));
    expect(await screen.findByRole("menuitem", { name: "Collapse" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Help for Fit model" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Close" })).toBeInTheDocument();
  });

  it("leaves the native menu to an editable field (and still stops the bubble)", () => {
    const stage = vi.fn();
    renderUnderStage(stage);
    const notPrevented = fireEvent.contextMenu(screen.getByLabelText("field"));
    expect(notPrevented).toBe(true); // not default-prevented: the browser menu opens
    expect(stage).not.toHaveBeenCalled();
  });

  it("does not open a menu from body text (native menu, never the plot's)", () => {
    renderUnderStage(() => {});
    const notPrevented = fireEvent.contextMenu(screen.getByText("Columns list"));
    expect(notPrevented).toBe(true);
    expect(screen.queryByRole("menuitem", { name: "Collapse" })).toBeNull();
  });
});
