// P3.4 — "copyable diagnostic bundle excludes raw/private data by default",
// exercised at the layer the user actually reaches it: Help ▸ Copy diagnostics.
//
// `lib/diagnostics.test.ts` proves the renderer cannot emit secrets it is
// handed, and `store/diagnostics.test.ts` proves the collector does not hand
// it any. Neither one proves the MENU is wired to those modules — a command
// that quietly copied `JSON.stringify(useApp.getState())` would leave both of
// them green. This clicks the real menu item, with a workspace full of exactly
// the material that must never leave the machine, and inspects the bytes that
// reached the clipboard.

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MenuBar from "./MenuBar";
import { buildAppActions } from "../../appCommands";
import type { DataStruct, Dataset } from "../../lib/types";
import { resetBackendHealthForTests } from "../../store/backendHealth";
import { useApp } from "../../store/useApp";

vi.mock("../../lib/clipboard", () => ({ copyText: vi.fn() }));

const { copyText } = await import("../../lib/clipboard");

const SECRET_NAME = "UNPUBLISHED-LaSrMnO3-batch7";
const SECRET_LABEL = "Moment_collabCompound";
const SECRET_TEXT_CELL = "operator-Q-embargoed-code";
const SECRET_VALUE = 1234.56789;
const SECRET_DIR = "/home/paige/Projects/embargoed";
const SECRET_PATH = `${SECRET_DIR}/run7.dat`;

const data: DataStruct = {
  time: [1, 2, 3],
  values: [[SECRET_VALUE, SECRET_TEXT_CELL], [2, "b"], [3, "c"]] as unknown as number[][],
  labels: [SECRET_LABEL, "condition"],
  units: ["emu", ""],
  metadata: { sourcePath: SECRET_PATH },
};

/** The text the clipboard was handed, or "" if it was never called. */
function copied(): string {
  const calls = vi.mocked(copyText).mock.calls;
  return calls.length ? String(calls[calls.length - 1][0]) : "";
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(copyText).mockResolvedValue(true);
  // P3.4 review round (2026-09-14): the command no longer probes /api/health
  // itself — it reads store/backendHealth.ts's cached value synchronously,
  // and this test never mounts App.tsx (only MenuBar), so that cache stays
  // at its default "unreachable or not yet answered" throughout. No fetch
  // stub is needed; none of these assertions depend on the backend field.
  // Reset explicitly (re-review nit 9) rather than relying on no test in
  // this file ever calling recordBackendHealth: a module-level `let` is
  // process state, not per-test state, and a later test added here that DID
  // record something would otherwise leak into every test that runs after
  // it in the same file.
  resetBackendHealthForTests();
  useApp.setState({
    datasets: [{ id: "d1", name: SECRET_NAME, data, sourcePath: SECRET_PATH } as Dataset],
    activeId: "d1",
    folders: [],
    workbooks: [],
    status: "",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function clickCopyDiagnostics(): Promise<void> {
  render(<MenuBar actions={buildAppActions(useApp.getState)} onOpenPalette={vi.fn()} />);
  fireEvent.click(screen.getByText("Help"));
  fireEvent.click(screen.getByText("Copy diagnostics"));
  // Wait on the STATE the user observes (the status line the command sets when
  // it finishes), never on the mock having been called — architecture.test.ts's
  // weak-wait ratchet fails the build for the latter.
  await vi.waitFor(() => expect(useApp.getState().status).not.toBe(""));
}

describe("Help ▸ Copy diagnostics", () => {
  it("copies a bundle and confirms it", async () => {
    await clickCopyDiagnostics();
    expect(copied()).toContain("# Quantized diagnostics");
    expect(useApp.getState().status).toMatch(/copied/i);
  });

  it("carries none of the open workspace's names, values or paths", async () => {
    await clickCopyDiagnostics();
    const text = copied();
    expect(text, "dataset name").not.toContain(SECRET_NAME);
    expect(text, "column label").not.toContain(SECRET_LABEL);
    expect(text, "numeric cell").not.toContain(String(SECRET_VALUE));
    expect(text, "text cell").not.toContain(SECRET_TEXT_CELL);
    expect(text, "the directory part of the source path").not.toContain(SECRET_DIR);
    expect(text, "the file basename").not.toContain("run7.dat");
    expect(text, "no absolute POSIX path of any kind").not.toMatch(/\/(?:home|Users)\//);
  });

  it("still describes that workspace, so the exclusions above mean something", async () => {
    // Without this, a command that copied the empty string would pass every
    // assertion in the test above it.
    await clickCopyDiagnostics();
    const text = copied();
    expect(text).toContain("3 rows × 2 columns");
    expect(text).toMatch(/datasets\s+1/);
  });

  it("removes the app's own /api/health round-trip from the click path (P3.4 review round F3, narrowed in the re-review)", async () => {
    // A `fetch` that never resolves stands in for a hung/slow backend — the
    // same shape App.tsx's own startup `health()` probe would take if the
    // server never answered. Before this fix, the command awaited a fresh
    // `/api/health` probe (up to 1.5 s) on every click; that awaited fetch
    // sat directly between the click and `navigator.clipboard.writeText`,
    // which can drop the transient user-activation the Clipboard API
    // requires (see store/backendHealth.ts's header). The command now reads
    // a cached value synchronously and never calls `fetch` at all — that is
    // the property this test proves. (What it does NOT prove, per the
    // re-review: the click path's one remaining `await`, the lazily-imported
    // `store/diagnostics.ts` renderer chunk, still runs here — vitest
    // resolves a dynamic import from the in-process module graph instantly,
    // unlike a real network-served chunk on a slow connection. MenuBar's
    // `warmDiagnosticsChunk` starts that fetch when the Help menu opens, so
    // in production only the FIRST "Copy diagnostics" click of a session can
    // still be waiting on it — a hazard one order of magnitude rarer than
    // the per-click `/api/health` probe this test guards against, and not a
    // regression this test is positioned to catch.)
    const hungFetch = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal("fetch", hungFetch);
    await clickCopyDiagnostics();
    // Direct, unconditional assertion (re-review nit 10) rather than only
    // inferring "no network call" from `waitFor` timing out at its default —
    // that would prove "less than ~1 s elapsed", not "fetch was never
    // called". A bare `.not.toHaveBeenCalled()` outside `waitFor` is exempt
    // from the weak-wait ratchet (CLAUDE.md's Test determinism notes).
    expect(hungFetch).not.toHaveBeenCalled();
    const text = copied();
    expect(text).toContain("# Quantized diagnostics");
    expect(text).toMatch(/backend\s+unreachable or not yet answered/);
  });
});
