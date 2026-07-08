import { describe, expect, it, vi } from "vitest";

import { IMPORT_ACCEPT, openFilePicker } from "./openFilePicker";

describe("IMPORT_ACCEPT", () => {
  // Guards the file-dialog filter against drift from the backend io/registry.py.
  // Every registered parser extension must be selectable in the GUI Open dialog.
  const REQUIRED = [
    ".dat", ".csv", ".tsv", ".xrdml", ".brml", ".raw", ".refl", ".pnr",
    ".datA", ".datB", ".datC", ".datD", ".jdx", ".dx", ".nc", ".cdf",
    ".xlsx", ".xlsm", ".spc", ".opus",
  ];
  const exts = IMPORT_ACCEPT.split(",");

  it.each(REQUIRED)("includes %s", (ext) => {
    expect(exts).toContain(ext);
  });

  it("has no duplicate or empty entries", () => {
    expect(exts.every((e) => e.startsWith("."))).toBe(true);
    expect(new Set(exts).size).toBe(exts.length);
  });
});

describe("openFilePicker", () => {
  it("creates a multiple file input with the accept filter and clicks it", () => {
    const clicks: HTMLInputElement[] = [];
    const orig = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      clicks.push(this as HTMLInputElement);
    };
    try {
      openFilePicker(() => {}, IMPORT_ACCEPT);
    } finally {
      HTMLInputElement.prototype.click = orig;
    }
    expect(clicks).toHaveLength(1);
    expect(clicks[0].type).toBe("file");
    expect(clicks[0].multiple).toBe(true);
    expect(clicks[0].accept).toBe(IMPORT_ACCEPT);
  });

  it("passes chosen files to the callback", () => {
    const onPick = vi.fn();
    const input = document.createElement("input");
    vi.spyOn(document, "createElement").mockReturnValueOnce(input);
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementationOnce(() => {});
    openFilePicker(onPick);
    const file = new File(["x"], "a.jdx");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.onchange?.(new Event("change"));
    expect(onPick).toHaveBeenCalledWith([file]);
    vi.restoreAllMocks();
  });
});
