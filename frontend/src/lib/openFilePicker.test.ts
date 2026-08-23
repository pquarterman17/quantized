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

  // DEFECT B (Sol audit P1-6, 2026-08-21): a canceled dialog used to fire NO
  // event, so a Promise wrapped around this (store/reimport.ts's
  // `pickOneFile`) hung forever. `input`'s `cancel` event (Chromium/WebKit)
  // must now settle the callback with an empty array — the SAME shape
  // `onchange` already produces for "0 files chosen" — so every caller has
  // one settlement path for both.
  //
  // Every current caller was audited for tolerance of an empty array:
  //   - commands/fileCommands.ts "import-append": `if (files.length === 0) return;`
  //   - commands/fileCommands.ts "import-origin-template": importOriginTemplateFiles
  //     loops `for (const file of files)` — a no-op on [].
  //   - store/reimport.ts pickOneFile: `files[0] ?? null` — already null-safe.
  //   - lib/importEntry.ts / useGlobalShortcuts.ts / lib/reopenRecent.ts (x3):
  //     all call `store.importFiles(files)` directly with no length check —
  //     store/importDatasets.ts's `runImport` now guards `items.length === 0`
  //     itself (see that module's comment) so this is covered at that single
  //     choke point instead of patched at every call site.
  //   - lib/openWorkspaceCommand.ts: `const file = files[0]; if (!file) return;`
  it("fires the callback with an empty array on a canceled dialog (the input's `cancel` event)", () => {
    const onPick = vi.fn();
    const input = document.createElement("input");
    vi.spyOn(document, "createElement").mockReturnValueOnce(input);
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementationOnce(() => {});
    openFilePicker(onPick);
    input.dispatchEvent(new Event("cancel"));
    expect(onPick).toHaveBeenCalledWith([]);
    vi.restoreAllMocks();
  });

  it("a canceled dialog never also fires onchange (no double callback)", () => {
    const onPick = vi.fn();
    const input = document.createElement("input");
    vi.spyOn(document, "createElement").mockReturnValueOnce(input);
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementationOnce(() => {});
    openFilePicker(onPick);
    input.dispatchEvent(new Event("cancel"));
    expect(onPick).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});
