// AnnotationTextDialog / askAnnotationText (MAIN #25) — same promise+zustand
// shape as ConfirmDialog.test.tsx, plus the markup round-trip this dialog
// exists for (RichLabelInput instead of a plain askParams text field).

import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import AnnotationTextDialog, { askAnnotationText } from "./AnnotationTextDialog";

/** Open the dialog inside act() so its state update + effect flush. */
function open(...args: Parameters<typeof askAnnotationText>): Promise<string | null> {
  let p!: Promise<string | null>;
  act(() => {
    p = askAnnotationText(...args);
  });
  return p;
}

describe("AnnotationTextDialog / askAnnotationText", () => {
  it("renders nothing until asked", () => {
    const { container } = render(<AnnotationTextDialog />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the title and seeds the field with the initial text", () => {
    render(<AnnotationTextDialog />);
    open("Edit annotation text", "Tc");
    expect(screen.getByText("Edit annotation text")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("Tc");
  });

  it("resolves the edited text when Done is clicked", async () => {
    render(<AnnotationTextDialog />);
    const result = open("Edit annotation text", "Tc");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "New label" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await expect(result).resolves.toBe("New label");
    expect(screen.queryByText("Edit annotation text")).not.toBeInTheDocument(); // closed
  });

  it("resolves null on Cancel, leaving the annotation untouched by the caller", async () => {
    render(<AnnotationTextDialog />);
    const result = open("Edit annotation text", "Tc");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "discarded" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await expect(result).resolves.toBeNull();
  });

  it("resolves null on Escape", async () => {
    render(<AnnotationTextDialog />);
    const result = open("Edit annotation text", "Tc");
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    await expect(result).resolves.toBeNull();
  });

  it("resolves the current draft on Enter", async () => {
    render(<AnnotationTextDialog />);
    const result = open("Edit annotation text", "Tc");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Enter-committed" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await expect(result).resolves.toBe("Enter-committed");
  });

  it("resolves null when the backdrop is clicked", async () => {
    const { container } = render(<AnnotationTextDialog />);
    const result = open("Edit annotation text", "Tc");
    fireEvent.mouseDown(container.querySelector(".qz-overlay-backdrop")!);
    await expect(result).resolves.toBeNull();
  });

  // MAIN #25: the dialog is the RichLabelInput editor, not a plain text
  // field — a `$...$` markup string round-trips through it unchanged.
  it("round-trips existing rich-text markup unedited", async () => {
    render(<AnnotationTextDialog />);
    const result = open("Edit annotation text", "$\\mu_0H$");
    expect(screen.getByRole("textbox")).toHaveValue("$\\mu_0H$");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await expect(result).resolves.toBe("$\\mu_0H$");
  });

  it("commits newly typed rich-text markup", async () => {
    render(<AnnotationTextDialog />);
    const result = open("Edit annotation text", "Tc");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "$M_s$" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await expect(result).resolves.toBe("$M_s$");
  });
});
