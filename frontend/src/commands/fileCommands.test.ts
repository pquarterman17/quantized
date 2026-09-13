// e2e/specs/quick-figure-lifecycle.spec.ts drives the REAL File menu with an
// EXACT-text locator on the Save-As command's label to trigger a real
// browser download — the realest available path for a project save/reload
// round trip (see that spec's own header). A silent label rename here
// (exactly what happened: "Save workspace (.dwk)…" -> "Save workspace as
// (.dwk)…", when the quick-save sibling command that motivated the "as"
// distinction was later removed for bundle-size reasons, leaving the
// rename with no remaining purpose) leaves the e2e locator matching
// nothing: `.click()` never lands on a real menu item, and the spec's
// `page.waitForEvent("download")` times out 60s later with an error that
// points at the download wait, not the actual cause.
//
// `npx vitest run` never runs `e2e/specs/*` (a separate Playwright suite,
// `npm run e2e`), so nothing in the fast unit loop caught this. This pin
// reads the e2e spec's OWN locator string from source and cross-checks it
// against the live command registry, so the next rename fails in
// milliseconds here instead of a 60-second CI timeout with a misleading
// "no download fired" symptom.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildFileCommands, runLazy } from "./fileCommands";
import { runAction } from "../store/commands";
import { spatialComposition } from "../lib/composition";
import { defaultPageSetup } from "../lib/pagesetup";
import { usePendingOps } from "../store/pendingOps";
import { useToasts } from "../store/toasts";
import { useApp } from "../store/useApp";

// F1 (2026-09-13 adversarial review of d6e67fb7): "export-page" resolves its
// own params dialog IMMEDIATELY here (unlike a real one) — its pendingOp is
// registered AFTER the dialog resolves (F4: exportPageCommand.ts prompts
// before beginOp), so what needs to hang to keep the op observable is the
// underlying network request, exactly like the stalled `fetch` below covers
// for export-csv/hdf5/origin. Module-level (vitest hoists `vi.mock`): no
// other test in this file drives the "Export page…" command, so this is
// inert for all of them.
vi.mock("../components/overlays/ParamDialog", () => ({
  askParams: vi.fn().mockResolvedValue({ fmt: "pdf", dpi: 300 }),
}));

/** The exact string quick-figure-lifecycle.spec.ts passes to `getByText(...,
 *  { exact: true })` for the click that must trigger the project-save
 *  download — i.e. the literal text `page.waitForEvent("download")` is
 *  paired with in that spec's `Promise.all`. Read from source rather than
 *  hand-copied, so this pin can't itself drift from what the e2e spec
 *  actually asserts. */
function e2eSaveDownloadLocatorText(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const specPath = resolve(here, "../../e2e/specs/quick-figure-lifecycle.spec.ts");
  const src = readFileSync(specPath, "utf-8");
  const match =
    /page\.waitForEvent\("download"\),\s*\n\s*page\.getByText\("([^"]+)",\s*\{\s*exact:\s*true\s*\}\)\.click\(\)/.exec(
      src,
    );
  if (!match) {
    throw new Error(
      "could not find the download-triggering getByText(...).click() in " +
        "e2e/specs/quick-figure-lifecycle.spec.ts — did its shape change? update this pin's regex",
    );
  }
  return match[1];
}

describe("File menu — Save-As label matches the e2e download-trigger locator", () => {
  it("keeps commands.ts's save-workspace label in sync with the e2e spec's exact-text locator", () => {
    const expected = e2eSaveDownloadLocatorText();
    const cmd = buildFileCommands(useApp.getState).find((c) => c.id === "save-workspace");
    expect(cmd).toBeDefined();
    expect(cmd?.label).toBe(expected);
  });
});

vi.mock("./packProjectCommands", () => ({ runPackProject: vi.fn() }));

describe("File menu — Pack Project command", () => {
  it("has a description and an ellipsis-terminated label (every registered command needs a description)", () => {
    const cmd = buildFileCommands(useApp.getState).find((c) => c.id === "pack-project");
    expect(cmd).toBeDefined();
    expect(cmd?.description).toBeTruthy();
    expect(cmd?.label.endsWith("…")).toBe(true);
  });

  it("loads the lazy module and delegates to runPackProject when run", async () => {
    const cmd = buildFileCommands(useApp.getState).find((c) => c.id === "pack-project");
    if (!cmd) throw new Error("no pack-project command");
    // `Action.run` is typed `() => void` (store/commands.ts), but this
    // command's actual body returns the `import().then(...)` promise — cast
    // to await it rather than racing the dynamic import.
    await (cmd.run() as unknown as Promise<void>);
    const { runPackProject } = await import("./packProjectCommands");
    expect(runPackProject).toHaveBeenCalledOnce();
  });
});

// PRIMARY_SOFTWARE_AUDIT_PLAN P3.4 (safe cancel for long export operations):
// export-csv/export-hdf5/export-origin route through lib/exportActive.ts,
// which now registers its own cancellable pendingOps entry (label + Cancel
// callback). Their `run()` bodies MUST be `void`-prefixed (like
// export-figure's own dynamic import already was) so store/commands.ts's
// `runAction` chokepoint does not ALSO wrap the returned promise in a SECOND,
// generic (non-cancellable) op under the action's own label — that bug shape
// is exactly what going through the real `runAction` entry point here (not
// calling `cmd.run()` directly) catches.
describe("File menu — export commands register exactly one pending op (no double-registration)", () => {
  beforeEach(() => {
    usePendingOps.setState({ ops: [] });
    useApp.setState({
      datasets: [
        { id: "d1", name: "scan.dat", data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} } },
      ],
      activeId: "d1",
    });
    // A stalled fetch (never settling on its own) so the op stays registered
    // long enough to observe -- without this, the real export request
    // rejects near-instantly (no backend in this test environment) entirely
    // via microtasks, and vi.waitFor's macrotask-based poll never gets a
    // chance to run before begin+end have both already happened.
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(["export-csv", "export-hdf5", "export-origin"])(
    "%s via runAction registers exactly one pendingOps entry, with a cancel callback",
    async (id) => {
      const cmd = buildFileCommands(useApp.getState).find((c) => c.id === id);
      if (!cmd) throw new Error(`no ${id} command`);
      runAction(cmd);
      // Wait for the CANCELLABLE op specifically, not just "any op" — a
      // transient, cancel-less "Loading export…" op (F5's runLazy, wrapping
      // the dynamic import itself) exists briefly first and ends before the
      // real one begins (sequential, never concurrent with it), so polling
      // for "any op" can catch that one instead and see a `cancel` of
      // `undefined`.
      await vi.waitFor(() => expect(usePendingOps.getState().ops.some((o) => o.cancel)).toBe(true));
      // Exactly one -- a second, generic entry from runAction's own
      // (non-cancellable) wrap would mean run() was not void-prefixed.
      expect(usePendingOps.getState().ops).toHaveLength(1);
      expect(typeof usePendingOps.getState().ops[0].cancel).toBe("function");
      // Clean up: cancel so the stalled fetch's fallout doesn't leak into
      // the next test as an unresolved op/promise.
      usePendingOps.getState().ops[0].cancel!();
    },
  );
});

// F1 (2026-09-13 adversarial review of d6e67fb7): "export-page" is
// `void`-prefixed (fileCommands.ts, same reasoning as the block above) but
// was missing from that `it.each` list — dropping the `void` there left
// 104/104 green, since nothing exercised it via the real `runAction`
// chokepoint. It needs its own fixture (a satisfied `canExportSpatialPage`
// composition/pageSetup, and a hung `askParams` — mocked at the top of this
// file) rather than joining the generic list above.
describe("File menu — export-page command registers exactly one pending op (no double-registration)", () => {
  beforeEach(() => {
    usePendingOps.setState({ ops: [] });
    useApp.setState({
      datasets: [
        { id: "d1", name: "book", data: { time: [0, 1], values: [[1], [2]], labels: ["A"], units: [""], metadata: {} } },
      ],
      activeId: "d1",
      composition: spatialComposition([
        {
          datasetId: "d1",
          xKey: null,
          yKeys: [0],
          xLim: [0, 1],
          yLim: [1, 2],
          xLog: false,
          yLog: false,
          row: 0,
          col: 0,
          pageRect: { left: 0.1, top: 0.2, width: 0.7, height: 0.6 },
        },
      ]),
      pageSetup: defaultPageSetup(),
    });
    // Stalled fetch: exportFigurePage (lib/api/figurePage.ts) eventually
    // calls it — same reasoning as the block above.
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("export-page via runAction registers exactly one pendingOps entry, with a cancel callback", async () => {
    const cmd = buildFileCommands(useApp.getState).find((c) => c.id === "export-page");
    if (!cmd) throw new Error("no export-page command");
    runAction(cmd);
    // See the it.each block above: wait for the CANCELLABLE op, not "any op"
    // — runLazy's transient "Loading export…" op has no cancel and ends
    // before the real one begins.
    await vi.waitFor(() => expect(usePendingOps.getState().ops.some((o) => o.cancel)).toBe(true));
    // Exactly one -- a second, generic entry from runAction's own
    // (non-cancellable) wrap would mean run() was not void-prefixed.
    expect(usePendingOps.getState().ops).toHaveLength(1);
    expect(typeof usePendingOps.getState().ops[0].cancel).toBe("function");
    usePendingOps.getState().ops[0].cancel!();
  });
});

// F5 (2026-09-13 adversarial review of d6e67fb7): every export command body
// above is a bare `void import(...).then((m) => m.runX(...))` with no
// `.catch` — a failed chunk load was a silent no-op PLUS an unhandled
// rejection. `runLazy` is the shared fix; pinned directly here rather than
// through a real dynamic-import failure (fragile to simulate reliably
// across bundlers/test runners) since it is the one thing every one of
// those call sites actually delegates to.
describe("runLazy (F5: dynamic-import failures toast instead of vanishing)", () => {
  beforeEach(() => {
    usePendingOps.setState({ ops: [] });
    useToasts.setState({ toasts: [] });
  });

  it("toasts a load failure and leaves no dangling pendingOp", async () => {
    const err = new Error("network error");
    await expect(runLazy("Loading export…", () => Promise.reject(err))).rejects.toBe(err);
    expect(usePendingOps.getState().ops).toHaveLength(0);
    expect(useToasts.getState().toasts.map((t) => t.msg)).toEqual([
      "Loading export failed to load: network error",
    ]);
  });

  it("registers and clears a pendingOp for the click-to-chunk-loaded window on success", async () => {
    let resolveLoad!: (v: string) => void;
    const p = runLazy("Loading export…", () => new Promise<string>((r) => (resolveLoad = r)));
    await vi.waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(1));
    expect(usePendingOps.getState().ops[0].label).toBe("Loading export…");
    resolveLoad("module");
    expect(await p).toBe("module");
    expect(usePendingOps.getState().ops).toHaveLength(0);
    expect(useToasts.getState().toasts).toEqual([]); // no failure toast on success
  });
});
