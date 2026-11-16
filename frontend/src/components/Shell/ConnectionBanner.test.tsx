// UX audit 8 #9: a lost server is a persistent banner with a Reload, not an
// amber dot under a status line that still says "imported 1 file".
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useConnection } from "../../lib/lifecycle";
import ConnectionBanner, { GRACE_MS } from "./ConnectionBanner";

const elapse = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const setConnected = (connected: boolean) => act(() => useConnection.setState({ connected }));

beforeEach(() => {
  vi.useFakeTimers();
  useConnection.setState({ connected: false, stale: null });
});
afterEach(() => vi.useRealTimers());

describe("ConnectionBanner", () => {
  it("shows nothing on a page that never connected (offline demo)", () => {
    render(<ConnectionBanner />);
    elapse(GRACE_MS * 4);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows once a connected socket stays closed past the grace period, and hides on reconnect", () => {
    render(<ConnectionBanner />);
    setConnected(true);
    setConnected(false);
    elapse(GRACE_MS - 1);
    expect(screen.queryByRole("alert")).toBeNull(); // a quick backend reload never flashes it
    elapse(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Lost connection to the qz server");
    setConnected(true);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Reload reloads the page; a stale session shows it at once", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    render(<ConnectionBanner />);
    act(() => useConnection.setState({ stale: "qz was relaunched" }));
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
