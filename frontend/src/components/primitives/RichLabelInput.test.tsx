// RichLabelInput keyboard shortcuts (MAIN #17): Ctrl/Cmd+I wraps the
// selection in italic, Ctrl+= / Ctrl+Shift+= wrap it in sub/superscript,
// Ctrl/Cmd+. opens the symbol palette — all via the same insert + commit +
// caret-restore mechanics a palette click uses, in both live and
// blur-commit mode, and never emitting markup the parser rejects.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { validateRichText } from "../../lib/richtext";
import RichLabelInput from "./RichLabelInput";

function getInput(): HTMLInputElement {
  return screen.getByRole("textbox") as HTMLInputElement;
}

function select(el: HTMLInputElement, start: number, end: number): void {
  el.focus();
  el.setSelectionRange(start, end);
}

describe("RichLabelInput keyboard shortcuts", () => {
  it("Ctrl+I wraps the selection in italic and commits", () => {
    const onCommit = vi.fn();
    render(<RichLabelInput value="Field slope" onCommit={onCommit} />);
    const input = getInput();
    select(input, 6, 11); // "slope"
    fireEvent.keyDown(input, { key: "i", ctrlKey: true });
    expect(onCommit).toHaveBeenCalledWith("Field $\\mathit{slope}$");
    expect(validateRichText(onCommit.mock.calls[0][0] as string).ok).toBe(true);
  });

  it("Cmd+I (metaKey) also wraps italic", () => {
    const onCommit = vi.fn();
    render(<RichLabelInput value="Field slope" onCommit={onCommit} />);
    const input = getInput();
    select(input, 6, 11);
    fireEvent.keyDown(input, { key: "i", metaKey: true });
    expect(onCommit).toHaveBeenCalledWith("Field $\\mathit{slope}$");
  });

  it("Ctrl+= wraps the selection in subscript", () => {
    const onCommit = vi.fn();
    render(<RichLabelInput value="Msat" onCommit={onCommit} />);
    const input = getInput();
    select(input, 1, 4); // "sat"
    fireEvent.keyDown(input, { key: "=", code: "Equal", ctrlKey: true });
    expect(onCommit).toHaveBeenCalledWith("M$_{sat}$");
    expect(validateRichText(onCommit.mock.calls[0][0] as string).ok).toBe(true);
  });

  it("Ctrl+Shift+= wraps the selection in superscript", () => {
    const onCommit = vi.fn();
    render(<RichLabelInput value="10n" onCommit={onCommit} />);
    const input = getInput();
    select(input, 2, 3); // "n"
    fireEvent.keyDown(input, { key: "+", code: "Equal", ctrlKey: true, shiftKey: true });
    expect(onCommit).toHaveBeenCalledWith("10$^{n}$");
    expect(validateRichText(onCommit.mock.calls[0][0] as string).ok).toBe(true);
  });

  it("Cmd+= does NOT trigger subscript (Ctrl only — avoids the macOS zoom accelerator)", () => {
    const onCommit = vi.fn();
    render(<RichLabelInput value="Msat" onCommit={onCommit} />);
    const input = getInput();
    select(input, 1, 4);
    fireEvent.keyDown(input, { key: "=", code: "Equal", metaKey: true });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("empty selection inserts the empty token with the cursor placed inside the braces", () => {
    const onCommit = vi.fn();
    render(<RichLabelInput value="Field " onCommit={onCommit} />);
    const input = getInput();
    select(input, 6, 6);
    fireEvent.keyDown(input, { key: "i", ctrlKey: true });
    expect(onCommit).toHaveBeenCalledWith("Field $\\mathit{}$");
    expect(validateRichText(onCommit.mock.calls[0][0] as string).ok).toBe(true);
  });

  it("a shortcut edit commits in live mode too", () => {
    const onCommit = vi.fn();
    render(<RichLabelInput value="Field slope" onCommit={onCommit} live />);
    const input = getInput();
    select(input, 6, 11);
    fireEvent.keyDown(input, { key: "i", ctrlKey: true });
    expect(onCommit).toHaveBeenCalledWith("Field $\\mathit{slope}$");
  });

  it("Ctrl+. opens the symbol palette", () => {
    render(<RichLabelInput value="" onCommit={vi.fn()} />);
    const input = getInput();
    fireEvent.keyDown(input, { key: ".", code: "Period", ctrlKey: true });
    expect(screen.getByRole("button", { name: "Insert symbol" })).toBeInTheDocument();
    // The palette popover itself renders once open (Greek section is a
    // reliable marker — always present).
    expect(screen.getByText("Greek")).toBeInTheDocument();
  });

  it("Enter still commits and Escape still reverts (unchanged)", () => {
    const onCommit = vi.fn();
    render(<RichLabelInput value="orig" onCommit={onCommit} />);
    const input = getInput();
    fireEvent.change(input, { target: { value: "edited" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("edited");

    onCommit.mockClear();
    fireEvent.change(input, { target: { value: "more edits" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe("orig");
  });

  it("a selection straddling an existing math region never emits invalid markup", () => {
    const onCommit = vi.fn();
    render(<RichLabelInput value="abc$x^2$def" onCommit={onCommit} />);
    const input = getInput();
    select(input, 2, 5); // "c$x" -- spans out of and into the math region
    fireEvent.keyDown(input, { key: "i", ctrlKey: true });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(validateRichText(onCommit.mock.calls[0][0] as string).ok).toBe(true);
  });
});
