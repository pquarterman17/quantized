// P3.4 slice 3 — off-main-thread workspace parse. jsdom has no real `Worker`
// (verified: `typeof Worker` is `"undefined"` in this suite's environment),
// so every test in this file that doesn't stub one exercises the
// synchronous fallback branch of `parseWorkspaceFile`. The "worker path"
// tests stub `globalThis.Worker` with a fake that runs the exact same
// `parseWorkspaceBlob` core the real `workspaceParse.worker.ts` calls, just
// via an in-memory async round trip instead of postMessage across a real
// thread — enough to prove `parseWorkspaceFile`'s worker-branch wiring
// (message shape, error unwrapping, viewport threading) matches the
// fallback branch's behavior line for line.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { currentViewport, parseWorkspaceFile, type ViewportSize } from "./parseWorkspaceFile";
import { parseWorkspaceBlob, type WorkspaceParseResult } from "./workspaceParseCore";
import { parseWorkspace, serializeWorkspace, WORKSPACE_FORMAT } from "./workspace";
import type { Dataset } from "./types";

function makeDataset(id: string): Dataset {
  return {
    id,
    name: `${id}.dat`,
    data: {
      time: [0, 1, 2],
      values: [[10, 100], [20, 200], [30, 300]],
      labels: ["A", "B"],
      units: ["emu", "Oe"],
      metadata: { source: "test" },
    },
  };
}

/** A `File`-like object exposing only what `parseWorkspaceFile`/
 *  `parseWorkspaceBlob` actually use (`.text()`) — same duck-typing the
 *  existing `openWorkspaceConfirm.test.ts` fixture uses for the real
 *  `<input type=file>` callback. */
function fakeFile(text: string): File {
  return { text: () => Promise.resolve(text) } as unknown as File;
}

const VIEWPORT: ViewportSize = { width: 1200, height: 800 };

/** Simulates a module Worker by running the SAME `parseWorkspaceBlob` core
 *  the real `workspaceParse.worker.ts` imports, replying asynchronously
 *  through `onmessage` — exercises `parseWorkspaceFile`'s worker-branch
 *  orchestration (postMessage in, onmessage out, terminate on completion)
 *  without a real OS thread, which jsdom cannot provide. Every constructed
 *  instance is tracked on `FakeWorker.instances` (a static registry, not a
 *  `this`-alias) so a test can inspect the specific instance
 *  `parseWorkspaceFile` created. */
class FakeWorker {
  static instances: FakeWorker[] = [];

  onmessage: ((e: MessageEvent<WorkspaceParseResult>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  terminate = vi.fn();

  constructor(_url: URL, _opts?: { type?: string }) {
    FakeWorker.instances.push(this);
  }

  postMessage(data: { file: Blob; viewport: ViewportSize }): void {
    // Arrow callbacks close over the method's own `this` lexically — no
    // alias needed (and `no-this-alias` would flag one if there were).
    void parseWorkspaceBlob(data.file, data.viewport).then((result) => {
      queueMicrotask(() => {
        this.onmessage?.({ data: result } as MessageEvent<WorkspaceParseResult>);
      });
    });
  }
}

beforeEach(() => {
  FakeWorker.instances = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const WS = serializeWorkspace({ datasets: [makeDataset("a"), makeDataset("b")] });

describe("parseWorkspaceFile — fallback path (no Worker)", () => {
  it("matches parseWorkspace called directly", async () => {
    expect(typeof Worker).toBe("undefined"); // sanity: this IS the fallback branch
    const result = await parseWorkspaceFile(fakeFile(WS), VIEWPORT);
    expect(result).toEqual(parseWorkspace(WS, VIEWPORT));
  });

  it("rejects with the same message parseWorkspace throws on bad JSON", async () => {
    await expect(parseWorkspaceFile(fakeFile("not json {{{"), VIEWPORT)).rejects.toThrow(
      /bad JSON/,
    );
  });

  it("rejects with the same message parseWorkspace throws on the wrong format", async () => {
    const bad = JSON.stringify({ format: "something-else", version: 1, datasets: [] });
    await expect(parseWorkspaceFile(fakeFile(bad), VIEWPORT)).rejects.toThrow(
      "not a quantized workspace (.dwk) file",
    );
  });
});

describe("parseWorkspaceFile — worker path (Worker available)", () => {
  function useFakeWorker() {
    vi.stubGlobal("Worker", FakeWorker as unknown as typeof Worker);
  }

  it("produces a result deep-equal to the fallback path for the same fixture", async () => {
    const fallback = parseWorkspace(WS, VIEWPORT);
    useFakeWorker();
    const viaWorker = await parseWorkspaceFile(fakeFile(WS), VIEWPORT);
    expect(viaWorker).toEqual(fallback);
  });

  it("rejects with the same message the fallback path rejects with (bad JSON)", async () => {
    useFakeWorker();
    await expect(parseWorkspaceFile(fakeFile("not json {{{"), VIEWPORT)).rejects.toThrow(
      /bad JSON/,
    );
  });

  it("rejects with the same message the fallback path rejects with (wrong format)", async () => {
    useFakeWorker();
    const bad = JSON.stringify({ format: "something-else", version: 1, datasets: [] });
    await expect(parseWorkspaceFile(fakeFile(bad), VIEWPORT)).rejects.toThrow(
      "not a quantized workspace (.dwk) file",
    );
  });

  it("terminates the worker after a successful parse", async () => {
    useFakeWorker();
    await parseWorkspaceFile(fakeFile(WS), VIEWPORT);
    expect(FakeWorker.instances.at(-1)?.terminate).toHaveBeenCalledTimes(1);
  });

  it("terminates the worker after a failed parse", async () => {
    useFakeWorker();
    await expect(parseWorkspaceFile(fakeFile("not json {{{"), VIEWPORT)).rejects.toThrow();
    expect(FakeWorker.instances.at(-1)?.terminate).toHaveBeenCalledTimes(1);
  });
});

describe("parseWorkspaceFile — viewport threading (worker can't read window.inner*)", () => {
  const toolWindowLayout = { w1: { x: 5000, y: 5000, width: 300, height: 200, collapsed: false } };
  const small: ViewportSize = { width: 800, height: 600 };

  it("fallback path clamps toolWindowLayout to the EXPLICIT viewport passed in, not window.inner*", async () => {
    const ws = serializeWorkspace({ datasets: [makeDataset("a")], toolWindowLayout });
    const result = await parseWorkspaceFile(fakeFile(ws), small);
    const layout = result.toolWindowLayout.w1;
    expect(layout.x + layout.width).toBeLessThanOrEqual(small.width);
    expect(layout.y).toBeLessThanOrEqual(small.height);
  });

  it("worker path clamps identically given the same explicit viewport", async () => {
    vi.stubGlobal("Worker", FakeWorker as unknown as typeof Worker);
    const ws = serializeWorkspace({ datasets: [makeDataset("a")], toolWindowLayout });
    const viaFallback = parseWorkspace(ws, small);
    const viaWorker = await parseWorkspaceFile(fakeFile(ws), small);
    expect(viaWorker.toolWindowLayout).toEqual(viaFallback.toolWindowLayout);
  });
});

describe("currentViewport", () => {
  it("reads window.innerWidth/innerHeight (what parseWorkspace defaults to on the main thread)", () => {
    expect(currentViewport()).toEqual({ width: window.innerWidth, height: window.innerHeight });
  });
});

// A trivial sanity check on the WORKSPACE_FORMAT fixture itself, so a future
// edit to `makeDataset`/`serializeWorkspace` that breaks the fixture fails
// loudly here instead of as a confusing failure in the tests above.
describe("fixture sanity", () => {
  it("WS round-trips through parseWorkspace with 2 datasets", () => {
    expect(parseWorkspace(WS, VIEWPORT).datasets.map((d) => d.id)).toEqual(["a", "b"]);
    expect(WORKSPACE_FORMAT).toBe("quantized-workspace");
  });
});
