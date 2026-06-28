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
});
