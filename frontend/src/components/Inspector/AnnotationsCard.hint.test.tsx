// UX8-I: the Annotations card teaches the `$...$` syntax, previews it live, and
// captions the bare number fields (X, Y, size).

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import AnnotationsCard from "./AnnotationsCard";
import { useApp } from "../../store/useApp";

beforeEach(() => {
  useApp.setState({ annotations: [{ id: "a1", x: 1, y: 2, text: "peak", size: 14 }] });
});

describe("AnnotationsCard sub/superscript hint and captions", () => {
  it("shows the $...$ hint until markup is typed, then a rendered preview", () => {
    render(<AnnotationsCard />);
    expect(screen.getByText(/Use \$…\$ for sub\/superscripts/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "New annotation text" }), { target: { value: "$T_{B}$ = 120 K" } });
    expect(screen.queryByText(/Use \$…\$ for sub\/superscripts/)).toBeNull();
    const preview = screen.getByLabelText("Annotation preview");
    expect(preview.querySelector("sub")).not.toBeNull(); // rendered, not literal "_{B}"
  });

  it("captions the new-annotation and per-row number fields", () => {
    render(<AnnotationsCard />);
    expect(screen.getAllByText("X", { selector: ".qzk-field-lbl" })).toHaveLength(2);
    expect(screen.getAllByText("Y", { selector: ".qzk-field-lbl" })).toHaveLength(2);
    expect(screen.getByText("Size (px)", { selector: ".qzk-field-lbl" })).toBeInTheDocument();
  });
});
