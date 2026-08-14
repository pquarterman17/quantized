import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AnnotationEditor from "./AnnotationEditor";

const ANNOTATIONS = [
  { text: "Peak A", x: 1, y: 2 },
  { text: "Peak B", x: 3, y: 4 },
];

const FIELDS = ["text", "x", "y", "font size", "anchor", "frame fill", "frame stroke", "frame opacity", "frame padding"];

describe("AnnotationEditor — label de-densification (item 9)", () => {
  it("keeps aria-label fully unique per annotation while dropping the repeated prefix from the VISIBLE label", () => {
    const { container } = render(<AnnotationEditor annotations={ANNOTATIONS} onChange={vi.fn()} />);

    // The unique, full strings must still resolve as accessible names —
    // getByLabelText / screen readers are unaffected by the density fix.
    for (const n of [1, 2]) {
      for (const field of FIELDS) {
        expect(screen.getByLabelText(`annotation ${n} ${field}`)).toBeInTheDocument();
      }
    }

    // The visible <label> text next to each field drops the "annotation N "
    // prefix entirely — one short word/phrase per field, for BOTH rows (the
    // "Annotation N" group header above each row already carries the ordinal).
    const visibleLabels = Array.from(container.querySelectorAll("label.qzk-field-lbl")).map(
      (el) => el.textContent,
    );
    expect(visibleLabels).toEqual([...FIELDS, ...FIELDS]);
  });
});

describe("AnnotationEditor — color field hints (item 10)", () => {
  it("gives frame fill/stroke a CSS-or-matplotlib-color tooltip", () => {
    render(<AnnotationEditor annotations={ANNOTATIONS} onChange={vi.fn()} />);
    const hint = 'CSS or matplotlib color: a name ("red") or hex ("#d33")';
    expect(screen.getByLabelText("annotation 1 frame fill")).toHaveAttribute("title", hint);
    expect(screen.getByLabelText("annotation 1 frame stroke")).toHaveAttribute("title", hint);
    expect(screen.getByLabelText("annotation 2 frame fill")).toHaveAttribute("title", hint);
    expect(screen.getByLabelText("annotation 2 frame stroke")).toHaveAttribute("title", hint);
  });
});

describe("AnnotationEditor — font size floor (item 8)", () => {
  it("uses a sane positivity floor (1) instead of Number.MIN_VALUE", () => {
    render(<AnnotationEditor annotations={ANNOTATIONS} onChange={vi.fn()} />);
    expect(screen.getByLabelText("annotation 1 font size")).toHaveAttribute("min", "1");
  });
});

// Data-loss class bug (lib/focusGuard): "Remove" unmounts its own row on
// click; without a focus handoff the browser drops focus to <body>, which
// useGlobalShortcuts.ts's Delete handler treats as "nothing is being edited"
// and removes the ACTIVE DATASET instead.
describe("AnnotationEditor — remove focus safety", () => {
  it("focus never lands on <body> after removing an annotation", () => {
    render(<AnnotationEditor annotations={ANNOTATIONS} onChange={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Remove annotation 1"));
    expect(document.activeElement).not.toBe(document.body);
  });

  // Focus alone is NOT sufficient — see Inspector/RegionShadesCard's test of
  // the same name for the full explanation.
  it("a Delete keystroke on the post-removal focus anchor is prevented, not left to bubble", () => {
    render(<AnnotationEditor annotations={ANNOTATIONS} onChange={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Remove annotation 1"));
    const event = new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
    document.activeElement?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
