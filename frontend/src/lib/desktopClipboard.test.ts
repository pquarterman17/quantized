// gap-4 G14: the native "Copy figure" bridge wire. pywebview is mocked — CI
// never touches a real Windows clipboard (the Python half is mock-tested in
// tests/test_desktop_bridge_clipboard.py).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { copyFigureNative, describeCopiedFormats, nativeClipboardReady, primeNativeClipboard } from "./desktopClipboard";

const g = globalThis as { pywebview?: unknown };

function install(api: Record<string, unknown>) {
  g.pywebview = { api };
}

afterEach(async () => {
  delete g.pywebview;
  await primeNativeClipboard();
});

describe("startup probe cache (primeNativeClipboard / nativeClipboardReady)", () => {
  it("is false in a browser (no shell), with no probe at all", async () => {
    expect(await primeNativeClipboard()).toBe(false);
    expect(nativeClipboardReady()).toBe(false);
  });

  it("is false for a shell without the clipboard methods", async () => {
    install({ probe: async () => ({}) });
    expect(await primeNativeClipboard()).toBe(false);
    expect(nativeClipboardReady()).toBe(false);
  });

  it("caches the bridge's own answer; reading it never calls the bridge", async () => {
    let probes = 0;
    const probe = async () => {
      probes += 1;
      return { available: true };
    };
    install({ clipboard_probe: probe, copy_figure_clipboard: async () => ({}) });
    expect(await primeNativeClipboard()).toBe(true);
    expect([nativeClipboardReady(), nativeClipboardReady()]).toEqual([true, true]);
    expect(probes).toBe(1);
    install({ clipboard_probe: async () => ({ available: false }), copy_figure_clipboard: async () => ({}) });
    expect(await primeNativeClipboard()).toBe(false);
    expect(nativeClipboardReady()).toBe(false);
  });

  it("a probe that throws means no native path, not a crash", async () => {
    install({
      clipboard_probe: async () => {
        throw new Error("bridge gone");
      },
      copy_figure_clipboard: async () => ({}),
    });
    expect(await primeNativeClipboard()).toBe(false);
  });

  it("a cached true is dropped if the bridge disappears", async () => {
    install({ clipboard_probe: async () => ({ available: true }), copy_figure_clipboard: async () => ({}) });
    await primeNativeClipboard();
    delete g.pywebview;
    expect(nativeClipboardReady()).toBe(false);
  });

  it("App primes it once at startup in the desktop shell", () => {
    const app = readFileSync(resolve(__dirname, "../App.tsx"), "utf8");
    expect(app).toMatch(/import\("\.\/lib\/desktopClipboard"\)\.then\(\(m\) => m\.primeNativeClipboard\(\)/);
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

describe("copyFigureNative — requireSvg (explicit vector request)", () => {
  it("a failed SVG render fails the copy and never touches the clipboard", async () => {
    const calls: unknown[] = [];
    install({ copy_figure_clipboard: async (...a: unknown[]) => (calls.push(a), { ok: true, formats: ["png"] }) });
    await expect(
      copyFigureNative(Promise.resolve(new Blob(["P"])), Promise.reject(new Error("500")), undefined, { requireSvg: true }),
    ).rejects.toThrow("vector render failed: 500");
    await expect(copyFigureNative(Promise.resolve(new Blob(["P"])), null, undefined, { requireSvg: true })).rejects.toThrow(
      "vector render failed",
    );
    expect(calls).toEqual([]);
  });

  it("a bridge that wrote no SVG fails a vector request", async () => {
    install({ copy_figure_clipboard: async () => ({ ok: true, formats: ["png", "dib"] }) });
    await expect(
      copyFigureNative(Promise.resolve(new Blob(["P"])), Promise.resolve(new Blob(["<svg/>"])), undefined, { requireSvg: true }),
    ).rejects.toThrow("did not take the vector format");
  });
});

describe("describeCopiedFormats", () => {
  it("claims vector only for an SVG", () => {
    expect(describeCopiedFormats(["svg", "png", "dib"])).toBe("as vector (SVG) + PNG");
    expect(describeCopiedFormats(["png", "dib"])).toBe("as a 300-DPI PNG (not vector)");
    expect(describeCopiedFormats(["png", "text/html"])).toBe("as a 300-DPI PNG (not vector)");
    expect(describeCopiedFormats([])).toBe("");
    // Browser MIME names describe the same way.
    expect(describeCopiedFormats(["image/png", "text/html", "image/svg+xml"])).toBe("as vector (SVG) + PNG");
    expect(describeCopiedFormats(["image/svg+xml"])).toBe("as vector (SVG only)");
  });
});
