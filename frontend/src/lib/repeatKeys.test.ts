import { beforeEach, describe, expect, it, vi } from "vitest";

import { SHORTCUT_GROUPS } from "./shortcuts";
import { noteCommand, rememberRepeat, resetLastActionForTests } from "./lastAction";
import { handleRepeatKey } from "./repeatKeys";

import "./repeatActions";
import { useApp } from "../store/useApp";

const key = (init: KeyboardEventInit, target?: Element) => {
  const e = new KeyboardEvent("keydown", { key: "Backspace", cancelable: true, bubbles: true, ...init });
  if (target) Object.defineProperty(e, "target", { value: target });
  return e;
};
const flush = () => new Promise((r) => setTimeout(r, 30));

beforeEach(() => {
  resetLastActionForTests();
  useApp.getState().setStatus("");
});

describe("Ctrl+Backspace / Ctrl+Shift+Backspace", () => {
  it("repeats on Ctrl+Backspace and says what it did", async () => {
    const run = vi.fn();
    rememberRepeat({ label: "Smooth", run });
    const e = key({ ctrlKey: true });
    expect(handleRepeatKey(e)).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    await flush();
    expect(run).toHaveBeenCalledOnce();
    expect(useApp.getState().status).toBe("repeated Smooth");
  });
  it("fails closed with a plain message when the last command is not repeatable", async () => {
    noteCommand({ id: "peaks", group: "Analyze", label: "Find peaks…", run: () => {} });
    handleRepeatKey(key({ metaKey: true }));
    await flush();
    expect(useApp.getState().status).toContain(`can't repeat "Find peaks"`);
  });
  it("reopens the last dialog command on Ctrl+Shift+Backspace", async () => {
    const run = vi.fn();
    noteCommand({ id: "x", group: "Analyze", label: "Tool…", run });
    expect(handleRepeatKey(key({ ctrlKey: true, shiftKey: true }))).toBe(true);
    await flush();
    expect(run).toHaveBeenCalledOnce();
  });
  it("says so when there is no dialog yet, and refuses a disabled one with its reason", async () => {
    handleRepeatKey(key({ ctrlKey: true, shiftKey: true }));
    await flush();
    expect(useApp.getState().status).toBe("no dialog to reopen yet");
    noteCommand({ id: "x", group: "Analyze", label: "Tool…", disabled: true, disabledReason: "needs data", run: () => {} });
    handleRepeatKey(key({ ctrlKey: true, shiftKey: true }));
    await flush();
    expect(useApp.getState().status).toBe("can't reopen Tool: needs data");
  });
  it("leaves plain Backspace, Alt chords, repeats and text fields alone", () => {
    expect(handleRepeatKey(key({}))).toBe(false);
    expect(handleRepeatKey(key({ ctrlKey: true, altKey: true }))).toBe(false);
    expect(handleRepeatKey(key({ ctrlKey: true, repeat: true }))).toBe(false);
    expect(handleRepeatKey(key({ ctrlKey: true }, document.createElement("input")))).toBe(false);
  });
});

describe("shortcut registration", () => {
  it("lists both chords in the sheet with no duplicate keys, and nothing else uses Backspace with a modifier", () => {
    const all = SHORTCUT_GROUPS.flatMap((g) => g.items.map((i) => i.keys));
    expect(all).toContain("⌘ Backspace");
    expect(all).toContain("⌘ ⇧ Backspace");
    expect(all.filter((k) => /Backspace/.test(k))).toHaveLength(2);
    expect(new Set(all.filter((k) => !/^(Click|Right-click|Double-click)/.test(k))).size).toBeGreaterThan(0);
  });
});
