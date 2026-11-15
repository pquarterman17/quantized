// gap-4 G14: "Copy figure" through the native Windows clipboard (pywebview
// bridge mocked; the Python half is mock-tested in
// tests/test_desktop_bridge_clipboard.py). Split from copyFigureCommand.test.ts
// to keep both under the module ceiling; `fakeGet` is the same minimal store.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderFigureBlob } from "./api/figures";
import { postBlob } from "./api/http";
import { clipboardImageSupported, clipboardSvgSupported } from "./clipboard";
import { runCopyFigureCommand, runCopyFigureSvgCommand } from "./copyFigureCommand";
import { COPY_SVG_MAX_POINTS } from "./copySvgBudget";
import { primeNativeClipboard } from "./desktopClipboard";
import { copyOfficeGraphicFormats } from "./officeClipboard";
import { registerStatStageExporter, type StatStageExporter } from "./statStageBridge";
import type { DataStruct, Dataset } from "./types";
import { usePendingOps } from "../store/pendingOps";
import { useToasts } from "../store/toasts";

vi.mock("./api/figures", () => ({
  renderFigureBlob: vi.fn(),
}));
vi.mock("./api/http", async (orig) => ({
  ...(await orig<typeof import("./api/http")>()),
  postBlob: vi.fn(),
}));
vi.mock("./clipboard", () => ({
  clipboardImageSupported: vi.fn(() => true),
  clipboardSvgSupported: vi.fn(() => true),
  copySvgAsync: vi.fn(async () => true),
}));
vi.mock("./officeClipboard", () => ({
  copyOfficeGraphicFormats: vi.fn(async (): Promise<string[] | null> => ["image/png", "text/html"]),
  copyOfficeGraphicAsync: vi.fn(async () => true),
}));

const data: DataStruct = {
  time: [1, 2, 3],
  values: [
    [10, 5],
    [20, 6],
    [30, 7],
  ],
  labels: ["M", "N"],
  units: ["emu", "emu"],
  metadata: {},
};
const ds: Dataset = { id: "d1", name: "scan.dat", data };

const setStatus = vi.fn();

/** Minimal store snapshot — only the fields buildFigureSpec + the command read.
 *  F2.5b: `focusedWindowId`/`windowsForSave` default to "nothing focused", so
 *  every pre-F2.5b test below still exercises the legacy live-view builder
 *  unchanged (buildStageFigureSpec's fallback path) — only the new "F2.5b"
 *  describe block below overrides them to route through a document. */
function fakeGet(over: Record<string, unknown> = {}) {
  const state = {
    datasets: [ds],
    activeId: "d1",
    resolveDataset: async () => ds,
    setStatus,
    plotTitle: "",
    xAxisLabel: "",
    yAxisLabel: "",
    yKeys: [0, 1],
    xKey: null,
    seriesOrder: [],
    hiddenChannels: [] as number[],
    seriesLabels: {} as Record<number, string>,
    seriesStyles: {},
    xScale: "linear",
    yScale: "linear",
    // Real store default shape — axisFmtParam reads .mode, so null throws.
    xFmt: { mode: "auto", digits: 2 },
    yFmt: { mode: "auto", digits: 2 },
    y2Fmt: null,
    y2Scale: null,
    xStep: null,
    yStep: null,
    y2Keys: [] as number[],
    y2Label: "",
    y2Lim: null,
    xLim: null,
    yLim: null,
    showGrid: false,
    showAxisBox: false,
    showLegend: false,
    legendPos: "ne",
    legendXY: null,
    legendFrameXY: null,
    legendTitle: "",
    annotations: [],
    shapes: [],
    refLines: [],
    regionShades: [],
    axisLabelStyles: {},
    axisLabelOffsets: {},
    pageSetup: null,
    copyFigureTransparent: false,
    focusedWindowId: null as string | null,
    windowsForSave: () => [] as { id: string; kind: string; document?: unknown }[],
    ...over,
  };
  return (() => state) as never;
}


function lastToast(): { msg: string; kind: string } | undefined {
  return useToasts.getState().toasts.at(-1);
}

const g = globalThis as { pywebview?: unknown };
let calls: [string, string][] = [];
let probes = 0;

/** Install a mocked bridge. `prime` runs the startup probe, as App.tsx does. */
async function installBridge(
  probe: Record<string, unknown> | (() => Promise<Record<string, unknown>>),
  result: Record<string, unknown> | Error,
  prime = true,
) {
  calls = [];
  probes = 0;
  g.pywebview = {
    api: {
      clipboard_probe: async () => {
        probes += 1;
        return typeof probe === "function" ? probe() : probe;
      },
      copy_figure_clipboard: async (png: string, svg: string) => {
        calls.push([png, svg]);
        if (result instanceof Error) throw result;
        return result;
      },
    },
  };
  if (prime) await primeNativeClipboard();
}

const PNG_BYTES = "PNG";
const SVG_BYTES = "<svg/>";

beforeEach(() => {
  vi.clearAllMocks();
  usePendingOps.setState({ ops: [] });
  useToasts.setState({ toasts: [] });
  vi.mocked(clipboardImageSupported).mockReturnValue(true);
  vi.mocked(clipboardSvgSupported).mockReturnValue(true);
  vi.mocked(copyOfficeGraphicFormats).mockResolvedValue(["image/png", "text/html"]);
  vi.mocked(renderFigureBlob).mockImplementation(async (spec) =>
    spec.fmt === "svg" ? new Blob([SVG_BYTES], { type: "image/svg+xml" }) : new Blob([PNG_BYTES], { type: "image/png" }),
  );
});

afterEach(async () => {
  delete g.pywebview;
  await primeNativeClipboard(); // back to "no native path"
});

describe("native path", () => {
  it("hands the export renderer's PNG and text-as-paths SVG to the bridge, not the browser clipboard", async () => {
    await installBridge({ available: true }, { ok: true, formats: ["svg", "png", "dib"] });
    await runCopyFigureCommand(fakeGet());
    expect(copyOfficeGraphicFormats).not.toHaveBeenCalled();
    const specs = vi.mocked(renderFigureBlob).mock.calls.map((c) => c[0]);
    expect(specs.map((s) => s.fmt)).toEqual(["png", "svg"]);
    expect(specs[0].dpi).toBe(300);
    expect(specs[1].svg_text_as_paths).toBe(true);
    expect(calls).toEqual([[btoa(PNG_BYTES), btoa(SVG_BYTES)]]);
    expect(lastToast()).toMatchObject({ msg: "copied scan as vector (SVG) + PNG", kind: "ok" });
  });

  it("works even where the embedded browser cannot take SVG or images at all", async () => {
    vi.mocked(clipboardImageSupported).mockReturnValue(false);
    vi.mocked(clipboardSvgSupported).mockReturnValue(false);
    await installBridge({ available: true }, { ok: true, formats: ["svg", "png", "dib"] });
    await runCopyFigureSvgCommand(fakeGet());
    expect(calls).toHaveLength(1);
    expect(lastToast()?.msg).toBe("copied scan as vector (SVG) + PNG");
  });

  it("Copy figure over the point budget: PNG only, and the message says not vector", async () => {
    await installBridge({ available: true }, { ok: true, formats: ["png", "dib"] });
    await runCopyFigureCommand(bigGet());
    expect(vi.mocked(renderFigureBlob).mock.calls.map((c) => c[0].fmt)).toEqual(["png"]);
    expect(calls[0][1]).toBe("");
    expect(lastToast()?.msg).toBe("copied scan as a 300-DPI PNG (not vector)");
  });

  it("a bridge refusal fails closed with the bridge's reason", async () => {
    await installBridge({ available: true }, { ok: false, error: "clipboard write failed: busy" });
    await runCopyFigureCommand(fakeGet());
    expect(setStatus).toHaveBeenCalledWith("copy failed: clipboard write failed: busy");
    expect(lastToast()).toMatchObject({ kind: "danger" });
  });

  it("a bridge that throws fails closed too", async () => {
    await installBridge({ available: true }, new Error("js_api call failed"));
    await runCopyFigureCommand(fakeGet());
    expect(setStatus).toHaveBeenCalledWith("copy failed: js_api call failed");
  });
});

// M2: an explicit vector request gets vector or an honest failure — never a
// silent PNG, which the browser vector copy would not have produced either.
describe("native Copy figure (vector) never degrades to PNG", () => {
  it("renders the SVG even over the point budget", async () => {
    await installBridge({ available: true }, { ok: true, formats: ["svg", "png", "dib"] });
    await runCopyFigureSvgCommand(bigGet());
    expect(vi.mocked(renderFigureBlob).mock.calls.map((c) => c[0].fmt)).toEqual(["png", "svg"]);
    expect(calls[0][1]).toBe(btoa(SVG_BYTES));
    expect(lastToast()?.msg).toBe("copied scan as vector (SVG) + PNG");
  });

  it("stat mode sends the stat renderer's own text-as-paths SVG", async () => {
    await installBridge({ available: true }, { ok: true, formats: ["svg", "png", "dib"] });
    const bodies: Record<string, unknown>[] = [];
    vi.mocked(postBlob).mockImplementation(async (_path, body) => {
      bodies.push(body as Record<string, unknown>);
      return (body as { fmt?: string }).fmt === "svg" ? new Blob([SVG_BYTES]) : new Blob([PNG_BYTES]);
    });
    const exporter: StatStageExporter = async (fmt, out) => {
      await out?.deliver?.({ route: "statplot", spec: { fmt } as never }, out.signal);
      return true;
    };
    const unregister = registerStatStageExporter(exporter);
    try {
      await runCopyFigureSvgCommand(fakeGet({ statMode: true, polarMode: false }));
    } finally {
      unregister();
    }
    expect(renderFigureBlob).not.toHaveBeenCalled();
    expect(bodies.map((b) => [b.fmt, b.svg_text_as_paths])).toEqual([
      ["png", undefined],
      ["svg", true],
    ]);
    expect(calls).toEqual([[btoa(PNG_BYTES), btoa(SVG_BYTES)]]);
    expect(lastToast()?.msg).toBe("copied scan as vector (SVG) + PNG");
  });

  it("a failed SVG render fails the vector copy instead of copying the PNG", async () => {
    await installBridge({ available: true }, { ok: true, formats: ["png", "dib"] });
    vi.mocked(renderFigureBlob).mockImplementation(async (spec) => {
      if (spec.fmt === "svg") throw new Error("renderer 500");
      return new Blob([PNG_BYTES]);
    });
    await runCopyFigureSvgCommand(fakeGet());
    expect(calls).toEqual([]);
    expect(setStatus).toHaveBeenCalledWith("copy failed: vector render failed: renderer 500");
  });
});

// M1: the copy path is chosen from the startup probe, synchronously in the
// click; no bridge round-trip may sit in front of the browser clipboard write.
describe("path choice is synchronous (startup-cached probe)", () => {
  it("an unavailable bridge: the click never calls the probe and uses the browser clipboard", async () => {
    await installBridge({ available: false, reason: "Windows-only" }, { ok: true });
    expect(probes).toBe(1); // the startup probe
    await runCopyFigureCommand(fakeGet());
    await runCopyFigureSvgCommand(fakeGet());
    expect(probes).toBe(1); // none in either click
    expect(calls).toEqual([]);
    expect(copyOfficeGraphicFormats).toHaveBeenCalledTimes(1);
  });

  it("a probe that never settles cannot hold the browser write hostage", async () => {
    await installBridge(() => new Promise(() => {}), { ok: true }, false);
    void primeNativeClipboard(); // startup probe still pending
    const done = runCopyFigureCommand(fakeGet()).then(() => "copied");
    const timeout = new Promise((r) => setTimeout(() => r("blocked"), 200));
    expect(await Promise.race([done, timeout])).toBe("copied");
    expect(copyOfficeGraphicFormats).toHaveBeenCalledTimes(1);
  });

  it("the browser write starts in the click's own task once the dataset resolves", async () => {
    // Order pin: between the click and the browser clipboard write there is
    // no bridge call at all, so nothing native can delay it.
    const order: string[] = [];
    await installBridge(async () => {
      order.push("probe");
      return { available: false };
    }, { ok: true });
    order.length = 0;
    vi.mocked(copyOfficeGraphicFormats).mockImplementation(async () => {
      order.push("browser write");
      return ["image/png", "text/html"];
    });
    await runCopyFigureCommand(fakeGet());
    expect(order).toEqual(["browser write"]);
  });
});

function bigGet() {
  const n = COPY_SVG_MAX_POINTS;
  const big: DataStruct = {
    ...data,
    time: Array.from({ length: n }, (_, i) => i),
    values: Array.from({ length: n }, () => [1, 2]),
  };
  const bigDs: Dataset = { ...ds, data: big };
  return fakeGet({ datasets: [bigDs], resolveDataset: async () => bigDs });
}
