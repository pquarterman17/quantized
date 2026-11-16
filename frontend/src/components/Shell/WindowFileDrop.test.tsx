// UX-D: a file dropped ANYWHERE in the window is imported (and never lets the
// browser navigate to it); the overlay shows while a file is dragged over.

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import WindowFileDrop from "./WindowFileDrop";
import { useApp } from "../../store/useApp";

function drag(type: string, target: EventTarget, files: File[] = [], types: string[] = ["Files"]): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, "dataTransfer", { value: { types, files, items: files.map(() => ({})), dropEffect: "none" } });
  act(() => void target.dispatchEvent(e));
  return e;
}

let importFiles: ReturnType<typeof vi.fn>;
beforeEach(() => {
  importFiles = vi.fn(async () => {});
  useApp.setState({ importFiles } as never);
});
afterEach(() => vi.restoreAllMocks());

describe("WindowFileDrop", () => {
  it("cancels the default and imports a file dropped on any element", () => {
    render(<WindowFileDrop />);
    const plot = document.body.appendChild(document.createElement("canvas"));
    const f = new File(["a,b\n1,2\n"], "x.csv");
    expect(drag("dragover", plot, [f]).defaultPrevented).toBe(true); // drop allowed
    const drop = drag("drop", plot, [f]);
    expect(drop.defaultPrevented).toBe(true); // browser must not navigate
    expect(importFiles).toHaveBeenCalledWith([f]);
  });

  it("shows the overlay during the drag and hides it on leave", async () => {
    render(<WindowFileDrop />);
    drag("dragenter", document.body, [new File(["x"], "a.dat")]);
    expect(await screen.findByTestId("file-drop-overlay")).toHaveTextContent("Drop to import");
    drag("dragleave", document.body, [new File(["x"], "a.dat")]);
    expect(screen.queryByTestId("file-drop-overlay")).toBeNull();
  });

  it("ignores dataset/channel drags and a drop a closer handler already took", () => {
    render(<WindowFileDrop />);
    const internal = drag("drop", document.body, [], ["application/x-qz-dataset"]);
    expect(internal.defaultPrevented).toBe(false);
    const el = document.body.appendChild(document.createElement("div"));
    el.addEventListener("drop", (e) => e.preventDefault()); // e.g. the Library column
    drag("drop", el, [new File(["x"], "b.dat")]);
    expect(importFiles).not.toHaveBeenCalled();
  });
});
