// gap-4 G14: the native "Copy figure" bridge wire. pywebview is mocked — CI
// never touches a real Windows clipboard (the Python half is mock-tested in
// tests/test_desktop_bridge_clipboard.py).

import { afterEach, describe, expect, it } from "vitest";

import { copyFigureNative, describeCopiedFormats, desktopClipboardReady } from "./desktopClipboard";

const g = globalThis as { pywebview?: unknown };

function install(api: Record<string, unknown>) {
  g.pywebview = { api };
}

afterEach(() => {
  delete g.pywebview;
});

describe("desktopClipboardReady", () => {
  it("is a synchronous false in a browser (no shell)", () => {
    expect(desktopClipboardReady()).toBe(false);
  });

  it("is a synchronous false for a shell without the clipboard methods", () => {
    install({ probe: async () => ({}) });
    expect(desktopClipboardReady()).toBe(false);
  });

  it("follows the bridge's own probe", async () => {
    install({ clipboard_probe: async () => ({ available: true }), copy_figure_clipboard: async () => ({}) });
    expect(await desktopClipboardReady()).toBe(true);
    install({ clipboard_probe: async () => ({ available: false }), copy_figure_clipboard: async () => ({}) });
    expect(await desktopClipboardReady()).toBe(false);
  });

  it("a probe that throws means no native path, not a crash", async () => {
    install({
      clipboard_probe: async () => {
        throw new Error("bridge gone");
      },
      copy_figure_clipboard: async () => ({}),
    });
    expect(await desktopClipboardReady()).toBe(false);
  });
});

describe("copyFigureNative", () => {
  function bridge(result: Record<string, unknown> = { ok: true, formats: ["svg", "png", "dib"] }) {
    const calls: [string, string][] = [];
    install({
      copy_figure_clipboard: async (png: string, svg: string) => {
        calls.push([png, svg]);
        return result;
      },
    });
    return calls;
  }

  it("sends binary-safe base64 of large renders", async () => {
    const calls = bridge();
    const bytes = new Uint8Array(0x8000 * 2 + 7).map((_, i) => i % 256);
    const formats = await copyFigureNative(Promise.resolve(new Blob([bytes])), Promise.resolve(new Blob(["<svg/>"])));
    expect(formats).toEqual(["svg", "png", "dib"]);
    const decoded = Uint8Array.from(atob(calls[0][0]), (c) => c.charCodeAt(0));
    expect(decoded).toEqual(bytes);
    expect(atob(calls[0][1])).toBe("<svg/>");
  });

  it("a failed SVG render still copies the PNG, and the bridge is told there is no SVG", async () => {
    const calls = bridge({ ok: true, formats: ["png", "dib"] });
    const formats = await copyFigureNative(Promise.resolve(new Blob(["P"])), Promise.reject(new Error("500")));
    expect(calls[0][1]).toBe("");
    expect(describeCopiedFormats(formats)).toBe("as a 300-DPI PNG (not vector)");
  });

  it("a failed PNG render fails the copy without touching the clipboard", async () => {
    const calls = bridge();
    await expect(copyFigureNative(Promise.resolve(null), null)).rejects.toThrow("render produced no PNG");
    expect(calls).toEqual([]);
  });

  it("a cancel before the write never reaches the clipboard", async () => {
    const calls = bridge();
    const ctl = new AbortController();
    ctl.abort();
    await expect(copyFigureNative(Promise.resolve(new Blob(["P"])), null, ctl.signal)).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it("a refusal throws the bridge's own reason", async () => {
    bridge({ ok: false, error: "set QZ_WIN_CLIPBOARD=1 to enable the native vector clipboard" });
    await expect(copyFigureNative(Promise.resolve(new Blob(["P"])), null)).rejects.toThrow("QZ_WIN_CLIPBOARD=1");
  });

  it("a malformed reply is a failure, not a success", async () => {
    bridge({});
    await expect(copyFigureNative(Promise.resolve(new Blob(["P"])), null)).rejects.toThrow("clipboard write refused");
  });
});

describe("describeCopiedFormats", () => {
  it("claims vector only for an SVG", () => {
    expect(describeCopiedFormats(["svg", "png", "dib"])).toBe("as vector (SVG) + PNG");
    expect(describeCopiedFormats(["png", "dib"])).toBe("as a 300-DPI PNG (not vector)");
    expect(describeCopiedFormats(["png", "text/html"])).toBe("as a 300-DPI PNG (not vector)");
    expect(describeCopiedFormats([])).toBe("");
  });
});
