import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Toaster from "./Toaster";
import { useToasts } from "../../store/toasts";

describe("Toaster", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToasts.setState({ toasts: [] });
  });
  afterEach(() => vi.useRealTimers());

  it("renders nothing when the queue is empty", () => {
    const { container } = render(<Toaster />);
    expect(container.querySelector(".qzk-toaster")).toBeNull();
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
