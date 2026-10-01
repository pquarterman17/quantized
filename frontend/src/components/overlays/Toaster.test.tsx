import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Toaster from "./Toaster";
import { TOAST_ACTION_TTL, TOAST_TTL, useToasts } from "../../store/toasts";

describe("Toaster", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToasts.setState({ toasts: [] });
  });
  afterEach(() => vi.useRealTimers());

  it("keeps an EMPTY live region mounted, so the first toast is announced", () => {
    // Screen readers commonly skip a live region that enters the DOM together
    // with its first text (the StatusBar's region documents the same rule).
    const { container } = render(<Toaster />);
    const region = container.querySelector(".qzk-toaster");
    expect(region).toHaveAttribute("aria-live", "polite");
    // Empty of toasts; it holds only the (also empty) alert region.
    expect(region?.textContent).toBe("");
    act(() => {
      useToasts.getState().push("first");
    });
    expect(container.querySelector(".qzk-toaster")).toBe(region);
    expect(region).toHaveTextContent("first");
  });

  it("renders queued toasts with their kind class", () => {
    useToasts.getState().push("done", "ok");
    render(<Toaster />);
    const el = screen.getByText("done");
    expect(el).toHaveClass("qzk-toast");
    expect(el).toHaveClass("ok");
  });

  it("click dismisses a toast", () => {
    useToasts.getState().push("tap me");
    render(<Toaster />);
    fireEvent.click(screen.getByText("tap me"));
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it("renders an action button when the toast carries one", () => {
    const onClick = vi.fn();
    useToasts.getState().push("overlay?", "ok", { action: { label: "Overlay", onClick } });
    render(<Toaster />);
    expect(screen.getByRole("button", { name: "Overlay" })).toBeInTheDocument();
  });

  it("clicking the action fires its callback and dismisses the toast", () => {
    const onClick = vi.fn();
    useToasts.getState().push("overlay?", "ok", { action: { label: "Overlay", onClick } });
    render(<Toaster />);
    fireEvent.click(screen.getByRole("button", { name: "Overlay" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it("a toast with no action renders no button", () => {
    useToasts.getState().push("plain");
    render(<Toaster />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

// WCAG 2.2.1: an action toast asks for a decision, so its timer must not run
// out under the pointer or the keyboard focus that is about to act on it.
describe("Toaster pauses an action toast while it is in use", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToasts.setState({ toasts: [] });
  });
  afterEach(() => vi.useRealTimers());

  const offer = () =>
    act(() => {
      useToasts.getState().push("overlay?", "ok", { action: { label: "Overlay", onClick: vi.fn() } });
    });
  const elapse = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });

  it("hover holds it past its timer; once the pointer leaves it lingers one short TTL more", () => {
    render(<Toaster />);
    offer();
    elapse(TOAST_ACTION_TTL - 1000);
    fireEvent.mouseEnter(screen.getByText("overlay?"));
    elapse(TOAST_ACTION_TTL * 3);
    expect(screen.getByText("overlay?")).toBeInTheDocument();
    fireEvent.mouseLeave(screen.getByText("overlay?"));
    elapse(TOAST_TTL - 1);
    expect(screen.getByText("overlay?")).toBeInTheDocument();
    elapse(1);
    expect(screen.queryByText("overlay?")).toBeNull();
  });

  it("a hover that ends before the timer leaves the timer as it was", () => {
    render(<Toaster />);
    offer();
    fireEvent.mouseEnter(screen.getByText("overlay?"));
    fireEvent.mouseLeave(screen.getByText("overlay?"));
    // An unpaired leave (the toast appeared under the pointer) is not a hold.
    fireEvent.mouseLeave(screen.getByText("overlay?"));
    elapse(TOAST_ACTION_TTL);
    expect(screen.queryByText("overlay?")).toBeNull();
  });

  it("focus on its action holds it; focus leaving resumes the timer", () => {
    render(
      <>
        <button type="button">elsewhere</button>
        <Toaster />
      </>,
    );
    offer();
    act(() => {
      screen.getByRole("button", { name: "Overlay" }).focus();
    });
    elapse(TOAST_ACTION_TTL * 3);
    expect(screen.getByRole("button", { name: "Overlay" })).toBeInTheDocument();
    act(() => {
      screen.getByRole("button", { name: "elsewhere" }).focus();
    });
    elapse(TOAST_ACTION_TTL);
    expect(screen.queryByText("overlay?")).toBeNull();
  });

  it("stays held while either hover or focus remains", () => {
    render(<Toaster />);
    offer();
    act(() => {
      screen.getByRole("button", { name: "Overlay" }).focus();
    });
    fireEvent.mouseEnter(screen.getByText("overlay?"));
    fireEvent.mouseLeave(screen.getByText("overlay?"));
    elapse(TOAST_ACTION_TTL * 3);
    expect(screen.getByText("overlay?")).toBeInTheDocument();
  });
});

describe("Toaster announces danger assertively", () => {
  beforeEach(() => useToasts.setState({ toasts: [] }));

  it("keeps an EMPTY assertive region mounted inside the polite one", () => {
    const { container } = render(<Toaster />);
    const polite = container.querySelector(".qzk-toaster");
    const assertive = container.querySelector('[aria-live="assertive"]');
    expect(assertive).toBeEmptyDOMElement();
    expect(polite).toContainElement(assertive as HTMLElement);
    act(() => {
      useToasts.getState().push("save failed", "danger");
    });
    expect(screen.getByRole("alert")).toHaveTextContent("save failed");
    expect(assertive).toContainElement(screen.getByRole("alert"));
  });

  it("makes only a danger toast an alert; the rest stay in the polite region", () => {
    useToasts.getState().push("saved", "ok");
    useToasts.getState().push("note", "info");
    useToasts.getState().push("save failed", "danger");
    render(<Toaster />);
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual(["save failed"]);
    expect(screen.getByRole("alert").parentElement).toHaveAttribute("aria-live", "assertive");
    for (const msg of ["saved", "note"]) {
      expect(screen.getByText(msg).closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
    }
  });
});
