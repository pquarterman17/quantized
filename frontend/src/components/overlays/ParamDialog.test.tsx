// ParamDialog / askParams — see the component's own header comment for the
// P0.4 finding 15 mechanism (2026-07-27): `values` used to reset via a
// useEffect that ran strictly AFTER the first commit/paint, leaving a real
// window (closed by a real browser's async effect scheduling, not by jsdom's
// act()) where a fast field edit could land before the reset and get
// overwritten-by or overwrite-over the defaults, producing a partial
// `values` object. The fix resets `values` synchronously DURING render
// instead (react.dev's "adjusting state when a prop changes" pattern), so
// there is no async gap left at all. jsdom's `act()` deliberately flushes
// effects synchronously too, so these tests can't reproduce the raw DOM/
// scheduling race itself (that needed a real browser — see
// tools/bench/export_envelope.mjs) — what they DO pin is the dialog's
// resulting CONTRACT: every open starts from a fully-defaulted `values`,
// edits merge onto it without dropping sibling fields, and back-to-back
// opens with DIFFERENT field sets never leak a stale key from the previous
// dialog into the next one's resolved result.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import ParamDialog, { askParams, type ParamField } from "./ParamDialog";
import type { ParamValues } from "../../lib/params";

/** Open the dialog inside act() so the render-time value reset commits. */
function open(title: string, fields: ParamField[]): Promise<ParamValues | null> {
  let p!: Promise<ParamValues | null>;
  act(() => {
    p = askParams(title, fields);
  });
  return p;
}

const EXPORT_FIELDS: ParamField[] = [
  { key: "fmt", label: "Format", type: "select", default: "pdf", options: ["pdf", "svg", "png", "tiff"] },
  { key: "style", label: "Style", type: "select", default: "default", options: ["default", "aps"] },
  { key: "dpi", label: "DPI", type: "number", default: 300 },
  { key: "title", label: "Title", type: "text", default: "" },
  { key: "x_label", label: "X label", type: "text", default: "" },
  { key: "y_label", label: "Y label", type: "text", default: "" },
];

describe("ParamDialog / askParams", () => {
  it("renders nothing until asked", () => {
    const { container } = render(<ParamDialog />);
    expect(container).toBeEmptyDOMElement();
  });

  it("Run resolves with EVERY field's default when nothing was edited", async () => {
    render(<ParamDialog />);
    const result = open("Export figure", EXPORT_FIELDS);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await expect(result).resolves.toEqual({
      fmt: "pdf",
      style: "default",
      dpi: 300,
      title: "",
      x_label: "",
      y_label: "",
    });
  });

  it("editing ONE field preserves every sibling field's default in the resolved result", async () => {
    render(<ParamDialog />);
    const result = open("Export figure", EXPORT_FIELDS);
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "svg" } }); // the Format field
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await expect(result).resolves.toEqual({
      fmt: "svg",
      style: "default", // NOT dropped by the fmt edit
      dpi: 300,
      title: "",
      x_label: "",
      y_label: "",
    });
  });

  it("resolves null on Cancel", async () => {
    render(<ParamDialog />);
    const result = open("Export figure", EXPORT_FIELDS);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await expect(result).resolves.toBeNull();
  });

  it("resolves null on Escape and null on backdrop mousedown", async () => {
    const { container } = render(<ParamDialog />);
    const escaped = open("Export figure", EXPORT_FIELDS);
    fireEvent.keyDown(screen.getByText("Export figure").closest(".qz-dialog")!, { key: "Escape" });
    await expect(escaped).resolves.toBeNull();

    const backdropped = open("Export figure", EXPORT_FIELDS);
    fireEvent.mouseDown(container.querySelector(".qz-overlay-backdrop")!);
    await expect(backdropped).resolves.toBeNull();
  });

  // The exact defect class: a SECOND dialog (different fields) opened right
  // after a first one must never resolve with a key from the first dialog's
  // schema — proves the reset is keyed per-open, not just per-mount.
  it("a dialog opened right after a DIFFERENT one starts from ITS OWN defaults, no leaked keys", async () => {
    render(<ParamDialog />);
    const RENAME_FIELDS: ParamField[] = [{ key: "label", label: "Label", type: "text", default: "series 0" }];

    const first = open("Rename series", RENAME_FIELDS);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await expect(first).resolves.toBeNull();

    const second = open("Export figure", EXPORT_FIELDS);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    const resolved = await second;
    expect(resolved).toEqual({
      fmt: "pdf",
      style: "default",
      dpi: 300,
      title: "",
      x_label: "",
      y_label: "",
    });
    expect(resolved).not.toHaveProperty("label"); // nothing leaked from the first dialog
  });

  it("a typed-0 number field survives (not coerced to the default via `Number(v) || default`)", async () => {
    render(<ParamDialog />);
    const result = open("Export figure", EXPORT_FIELDS);
    const dpiInput = screen.getByDisplayValue("300");
    fireEvent.change(dpiInput, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    const resolved = await result;
    expect(resolved?.dpi).toBe(0);
  });
});
