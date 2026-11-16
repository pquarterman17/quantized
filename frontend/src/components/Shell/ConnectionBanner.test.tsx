// UX audit 8 #9: a lost server is a persistent banner with a Reload, not an
// amber dot under a status line that still says "imported 1 file".
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetConnectionSeenForTests } from "../../lib/connectionSeen";
import { useConnection } from "../../lib/lifecycle";
import ConnectionBanner, { GRACE_MS } from "./ConnectionBanner";

const elapse = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const setConnected = (connected: boolean) => act(() => useConnection.setState({ connected }));

beforeEach(() => {
  vi.useFakeTimers();
  useConnection.setState({ connected: false, stale: null });
  resetConnectionSeenForTests();
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
    expect(screen.queryByRole("alert")).toBeNull(); // a dev backend reload never flashes it
    elapse(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Lost connection to the qz server");
    setConnected(true);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Reload reloads the page; a stale session shows it at once", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    render(<ConnectionBanner />);
    act(() => useConnection.setState({ stale: "qz was relaunched — reload this page to reconnect" }));
    // The stale session's own words, not "lost connection": the server is up.
    expect(screen.getByRole("alert")).toHaveTextContent("qz was relaunched — reload this page to reconnect");
    expect(screen.getByRole("alert")).not.toHaveTextContent("Lost connection");
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});

describe("ConnectionBanner and the reconnect backoff", () => {
  it("does not flash for a reload that reconnects on the 7.5 s retry", () => {
    render(<ConnectionBanner />);
    setConnected(true);
    setConnected(false);
    elapse(7500);
    setConnected(true);
    elapse(GRACE_MS);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
