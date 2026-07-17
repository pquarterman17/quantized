// Text-formatting help sheet (GOTO #11): the worked-examples table renders
// LIVE through the RichText primitive (so the sheet cannot drift from the
// lib/richtext parser), the syntax reference covers the shipped subset, the
// dialog follows ShortcutsDialog dismiss conventions, and the Help-menu
// command registry entry exists in commands/uiCommands.ts (source-scan,
// architecture.test style — the App tree is too heavy to render in jsdom).

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useApp } from "../../store/useApp";
import TextFormatHelp from "./TextFormatHelp";

beforeEach(() => useApp.getState().setTextFormatHelpOpen(false));

function open() {
  useApp.getState().setTextFormatHelpOpen(true);
  return render(<TextFormatHelp />);
}

describe("TextFormatHelp", () => {
  it("renders nothing while closed", () => {
    const { container } = render(<TextFormatHelp />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the worked examples live through RichText", () => {
    open();
    const table = screen.getByTestId("tfh-examples");
    const text = table.textContent ?? "";
    // Sources are shown verbatim (mono column)...
    for (const src of [
      "$\\mu_0H$ (T)",
      "Q ($\\AA^{-1}$)",
      "$\\chi''$",
      "$2\\theta$ (°)",
      "$M_{sat}$",
      "$10^{-6}$",
      "$\\mathrm{R}$ vs $R$",
    ]) {
      expect(text).toContain(src);
    }
    // ...and the preview column contains the PARSED renders: Greek glyphs,
    // primes, true minus, Å — proof the strings went through the parser.
    expect(text).toContain("μ");
    expect(text).toContain("Å");
    expect(text).toContain("χ′′"); // \chi'' -> chi + two primes
    expect(text).toContain("2θ");
    expect(text).toContain("−6"); // mathtext true minus in 10^{-6}
    // Sub/superscripts render as real <sub>/<sup> elements.
    const subs = table.querySelectorAll("sub");
    const sups = table.querySelectorAll("sup");
    expect(subs.length).toBeGreaterThan(0);
    expect(sups.length).toBeGreaterThan(0);
    expect(within(table).getAllByText("sat").length).toBeGreaterThan(0);
  });

  it("documents the full shipped subset in the syntax reference", () => {
    open();
    const text = screen.getByTestId("tfh-syntax").textContent ?? "";
    for (const token of [
      "_x",
      "_{...}",
      "^x",
      "^{...}",
      "\\alpha",
      "\\omega",
      "\\varepsilon",
      "\\Gamma",
      "\\Omega",
      "\\AA",
      "\\circ",
      "\\times",
      "\\cdot",
      "\\pm",
      "\\prime",
      "\\,",
      "\\mathrm{...}",
      "\\mathit{...}",
      "\\$",
    ]) {
      expect(text).toContain(token);
    }
    // Conventions + fallback are stated.
    expect(text).toContain("italic");
    expect(text).toContain("upright");
  });

  it("documents the label-editor keyboard shortcuts (MAIN #17)", () => {
    open();
    const text = screen.getByTestId("tfh-shortcuts").textContent ?? "";
    expect(text).toContain("Ctrl / Cmd + I");
    expect(text).toContain("Ctrl + =");
    expect(text).toContain("Ctrl + Shift + =");
    expect(text).toContain("Ctrl / Cmd + .");
  });

  it("cross-references the symbol palette and the literal fallback", () => {
    open();
    expect(screen.getByText("Symbol palette")).toBeInTheDocument();
    expect(screen.getByText(/Ω button/)).toBeInTheDocument();
    expect(screen.getByText("When markup is invalid")).toBeInTheDocument();
    expect(screen.getByText(/renders literally/)).toBeInTheDocument();
  });

  it("closes on Escape, backdrop click, and the Close button", () => {
    const { rerender } = open();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useApp.getState().textFormatHelpOpen).toBe(false);

    useApp.getState().setTextFormatHelpOpen(true);
    rerender(<TextFormatHelp />);
    fireEvent.mouseDown(document.querySelector(".qz-overlay-backdrop")!);
    expect(useApp.getState().textFormatHelpOpen).toBe(false);

    useApp.getState().setTextFormatHelpOpen(true);
    rerender(<TextFormatHelp />);
    fireEvent.click(screen.getByText("Close"));
    expect(useApp.getState().textFormatHelpOpen).toBe(false);
  });
});

describe("Help-menu command registry entry (GOTO #11)", () => {
  // commands/uiCommands.ts's curated actions array IS (part of) the command
  // registry (MenuBar and the ⌘K palette both consume the aggregated
  // appCommands.ts, via App). The App tree is too heavy to render in jsdom,
  // so assert on the registry's source — the same pattern architecture.test.ts
  // uses. (Extracted from App.tsx, MAIN_PLAN #1; Help moved from
  // appCommands.ts to commands/uiCommands.ts when that module was
  // decomposed by menu domain, 2026-07-17. The overlay mounts live in
  // AppOverlays.tsx.)
  const commandsSrc = Object.values(
    import.meta.glob("../../commands/uiCommands.ts", { query: "?raw", import: "default", eager: true }),
  )[0] as string;
  const overlaysSrc = Object.values(
    import.meta.glob("../../AppOverlays.tsx", { query: "?raw", import: "default", eager: true }),
  )[0] as string;

  it("commands/uiCommands.ts registers the Text formatting command in the Help group", () => {
    expect(commandsSrc).toContain('id: "text-format-help"');
    expect(commandsSrc).toContain('label: "Text formatting"');
    expect(commandsSrc).toContain("setTextFormatHelpOpen(true)");
  });

  it("AppOverlays.tsx mounts the dialog", () => {
    expect(overlaysSrc).toContain("<TextFormatHelp />");
  });
});
