import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import WorkbookPropertiesDialog from "./WorkbookPropertiesDialog";
import { useWorkbookPropertiesDialog } from "../../store/workbookPropertiesDialog";

beforeEach(() => useWorkbookPropertiesDialog.setState({ properties: null }));

function open(): void {
  act(() => useWorkbookPropertiesDialog.getState().open({
    name: "Book 1", location: "Project / Runs", source: "Linked source", sourcePath: "C:/source.opju", originBook: "Book1",
    availability: "1 loaded; 1 available on demand", worksheetCount: 2, artifactCount: 1,
    tags: ["sample", "urgent"], importedAt: "2026-09-20T12:00:00.000Z",
  }));
}

describe("WorkbookPropertiesDialog", () => {
  it("is an accessible, read-only inspector", () => {
    render(<WorkbookPropertiesDialog />);
    open();
    const dialog = screen.getByRole("dialog", { name: "Properties — Book 1" });
    // R12: no `aria-modal` (it hid the app's live regions); the background
    // `inert` of lib/modalInert.ts carries the modality instead.
    expect(dialog).not.toHaveAttribute("aria-modal");
    expect(dialog).toHaveTextContent("Project / Runs");
    expect(dialog).toHaveTextContent("2 worksheets");
    expect(dialog).toHaveTextContent("1 artifact");
    expect(dialog).toHaveTextContent("1 loaded; 1 available on demand");
    expect(dialog).toHaveTextContent("Linked source");
    expect(dialog).toHaveTextContent("C:/source.opju");
    expect(dialog).toHaveTextContent("sample, urgent");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("restores focus to its invoking Library item on close", () => {
    const { container } = render(<><button type="button">Workbook row</button><WorkbookPropertiesDialog /></>);
    const opener = screen.getByRole("button", { name: "Workbook row" });
    opener.focus();
    open();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  // R12: this dialog restores focus EAGERLY, inside its close handler, while
  // it is still mounted — i.e. while the background (the opener included) is
  // still `inert`, where a browser refuses `focus()`. jsdom does not refuse,
  // so what is pinned is the precondition: at the moment the opener is
  // focused, nothing above it is inert any more.
  it("lifts the background inert before its eager focus restore", () => {
    render(<><div><button type="button">Workbook row</button></div><WorkbookPropertiesDialog /></>);
    const opener = screen.getByRole("button", { name: "Workbook row" });
    opener.focus();
    open();
    expect(opener.closest("[inert]")).not.toBeNull();
    const inertAtFocus: boolean[] = [];
    const realFocus = HTMLElement.prototype.focus;
    const spy = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (
      this: HTMLElement,
      ...args: Parameters<HTMLElement["focus"]>
    ) {
      if (this === opener) inertAtFocus.push(opener.closest("[inert]") !== null);
      return realFocus.apply(this, args);
    });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    spy.mockRestore();
    // The FIRST focus of the opener is the eager one, from the close handler.
    expect(inertAtFocus[0]).toBe(false);
    expect(document.querySelectorAll("[inert]")).toHaveLength(0);
    expect(document.activeElement).toBe(opener);
  });

  it("Escape closes only this modal and restores the opener", () => {
    render(<><button type="button">Workbook tile</button><WorkbookPropertiesDialog /></>);
    const opener = screen.getByRole("button", { name: "Workbook tile" });
    opener.focus();
    open();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
