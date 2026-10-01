import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Toaster from "./Toaster";
import { useToasts } from "../../store/toasts";

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
    expect(region).toBeEmptyDOMElement();
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
