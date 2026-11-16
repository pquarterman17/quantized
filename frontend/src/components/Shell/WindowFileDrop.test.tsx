// UX-D: a file dropped ANYWHERE in the window is imported exactly once (and
// never lets the browser navigate to it); the overlay shows while a file is
// dragged over and cannot stick; foreign link drags are cancelled too.

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import WindowFileDrop from "./WindowFileDrop";
import { importDroppedFiles } from "../../lib/fileDrop";
import { useApp } from "../../store/useApp";

interface Init { files?: File[]; types?: string[]; x?: number; y?: number; related?: EventTarget | null }
function drag(type: string, target: EventTarget, init: Init = {}): Event {
  const files = init.files ?? [];
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(e, {
    dataTransfer: { value: { types: init.types ?? ["Files"], files, items: files.map(() => ({})), dropEffect: "none" } },
    clientX: { value: init.x ?? 50 },
    clientY: { value: init.y ?? 50 },
    relatedTarget: { value: init.related ?? null },
  });
  act(() => void target.dispatchEvent(e));
  return e;
}
const file = (n = "x.csv") => new File(["a,b\n1,2\n"], n);

let importFiles: Mock<(f: File[]) => Promise<void>>;
beforeEach(() => {
  importFiles = vi.fn(async (_f: File[]) => {});
  useApp.setState({ importFiles } as never);
});
afterEach(() => vi.useRealTimers());

describe("WindowFileDrop", () => {
  it("cancels the default and imports a file dropped on any element", () => {
    render(<WindowFileDrop />);
    const plot = document.body.appendChild(document.createElement("canvas"));
    const f = file();
    expect(drag("dragover", plot, { files: [f] }).defaultPrevented).toBe(true); // drop allowed
    const drop = drag("drop", plot, { files: [f] });
    expect(drop.defaultPrevented).toBe(true); // browser must not navigate
    expect(importFiles).toHaveBeenCalledWith([f]);
  });

  it("shows the overlay during the drag and hides it on leave", async () => {
    render(<WindowFileDrop />);
    drag("dragenter", document.body, { files: [file()] });
    expect(await screen.findByTestId("file-drop-overlay")).toHaveTextContent("Drop to import");
    drag("dragleave", document.body, { files: [file()] });
    expect(screen.queryByTestId("file-drop-overlay")).toBeNull();
  });

  it("imports a file dropped on a surface that cancels every drop (slot grid, quick-figure zone)", () => {
    render(<WindowFileDrop />);
    const zone = document.body.appendChild(document.createElement("div"));
    zone.addEventListener("drop", (e) => e.preventDefault()); // SlotGrid / QuickMappingPanel pattern
    const f = file("z.dat");
    drag("drop", zone, { files: [f] });
    expect(importFiles).toHaveBeenCalledWith([f]);
  });

  it("imports once when a closer handler (the Library) already imported the drop", () => {
    render(<WindowFileDrop />);
    const lib = document.body.appendChild(document.createElement("aside"));
    lib.addEventListener("drop", (e) => importDroppedFiles(e as never, importFiles));
    drag("drop", lib, { files: [file("a.dat")] });
    expect(importFiles).toHaveBeenCalledTimes(1);
  });

  it("ignores dataset / channel drags", () => {
    render(<WindowFileDrop />);
    const internal = drag("drop", document.body, { types: ["application/x-qz-dataset"] });
    expect(internal.defaultPrevented).toBe(false);
    expect(importFiles).not.toHaveBeenCalled();
  });

  it("does not leave the overlay stuck when the pointer leaves the window with the depth count high", async () => {
    render(<WindowFileDrop />);
    const a = document.body.appendChild(document.createElement("div"));
    drag("dragenter", a, { files: [file()] });
    drag("dragenter", a, { files: [file()] }); // nested enters; the element is then removed (no dragleave)
    expect(await screen.findByTestId("file-drop-overlay")).toBeInTheDocument();
    drag("dragleave", document.body, { files: [file()], x: 0, y: 0, related: null });
    expect(screen.queryByTestId("file-drop-overlay")).toBeNull();
  });

  it("hides a stale overlay when dragover stops arriving", async () => {
    vi.useFakeTimers();
    render(<WindowFileDrop />);
    drag("dragenter", document.body, { files: [file()] });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.queryByTestId("file-drop-overlay")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(screen.queryByTestId("file-drop-overlay")).toBeNull();
  });

  it("cancels a link dragged in from another page (no navigation) without importing", () => {
    render(<WindowFileDrop />);
    const link = drag("drop", document.body, { types: ["text/uri-list", "text/plain"] });
    expect(link.defaultPrevented).toBe(true);
    expect(importFiles).not.toHaveBeenCalled();
    // the app's own payloads that also carry a URL are left to their handlers
    expect(drag("drop", document.body, { types: ["text/uri-list", "application/x-qz-dataset"] }).defaultPrevented).toBe(false);
  });
});
