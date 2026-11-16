// UX audit 8 #9 follow-up: folding and unfolding a toast group swaps the
// rendered nodes under the pointer and the focus. The node that leaves never
// gets its mouseleave / blur, so its holds must be lifted by the Toaster
// itself, or the toasts it covered never time out; and focus that fell to
// <body> (where Delete removes the active dataset) goes to the stack root.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Toaster from "./Toaster";
import { TOAST_ACTION_TTL, TOAST_TTL, useToasts } from "../../store/toasts";

const GROUP = { key: "g", summary: (n: number) => `${n} files couldn't be read` };
const TTL = TOAST_ACTION_TTL * 2;
const fail = (name: string, count?: number) =>
  act(() => {
    useToasts.getState().push(`Couldn't read ${name}`, "danger", {
      actions: [{ label: "Details", keep: true, onClick: () => undefined }],
      ttlMs: TTL,
      group: { ...GROUP, ...(count ? { count } : {}) },
    });
  });
const elapse = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  useToasts.setState({ toasts: [] });
});
afterEach(() => vi.useRealTimers());

describe("Toaster group fold / unfold releases what the vanished node held", () => {
  it("a hovered, focused toast that folds away does not stay forever; focus goes to the stack", () => {
    const { container } = render(<Toaster />);
    fail("a.csv");
    const first = screen.getByText("Couldn't read a.csv").closest(".qzk-toast") as HTMLElement;
    fireEvent.mouseEnter(first);
    act(() => screen.getByRole("button", { name: "Details" }).focus());
    fail("b.csv");
    fail("c.csv");
    expect(screen.getByRole("alert")).toHaveTextContent("3 files couldn't be read");
    expect(document.body).not.toHaveFocus();
    expect(container.querySelector(".qzk-toaster")).toHaveFocus();
    elapse(TTL + TOAST_TTL + 1);
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it("a hovered group that unfolds (3 -> 2) does not keep its toasts forever", () => {
    render(<Toaster />);
    ["a.csv", "b.csv", "c.csv"].forEach((n) => fail(n));
    const group = screen.getByRole("alert");
    fireEvent.mouseEnter(group);
    elapse(TTL * 2);
    expect(useToasts.getState().toasts).toHaveLength(3); // held while hovered
    act(() => useToasts.getState().dismiss(useToasts.getState().toasts[0].id));
    expect(screen.getAllByRole("alert")).toHaveLength(2); // unfolded
    elapse(TOAST_TTL + 1);
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it("a group that grows while hovered holds its new member too, and releases all on leave", () => {
    render(<Toaster />);
    ["a.csv", "b.csv", "c.csv"].forEach((n) => fail(n));
    fireEvent.mouseEnter(screen.getByRole("alert"));
    fail("d.csv");
    elapse(TTL * 2);
    expect(useToasts.getState().toasts).toHaveLength(4);
    fireEvent.mouseLeave(screen.getByRole("alert"));
    elapse(TOAST_TTL + 1);
    expect(useToasts.getState().toasts).toHaveLength(0);
  });
});

describe("Toaster group count", () => {
  it("sums the files each toast stands for, not the toasts", () => {
    render(<Toaster />);
    fail("batch", 3);
    fail("a.csv");
    fail("b.csv");
    expect(screen.getByRole("alert")).toHaveTextContent("5 files couldn't be read");
  });

  it("keeps counting failures pushed out by the 4-toast cap", () => {
    render(<Toaster />);
    ["a", "b", "c", "d", "e", "f"].forEach((n) => fail(n));
    expect(useToasts.getState().toasts).toHaveLength(4);
    expect(screen.getByRole("alert")).toHaveTextContent("6 files couldn't be read");
  });
});
