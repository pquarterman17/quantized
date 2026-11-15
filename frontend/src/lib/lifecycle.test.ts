// Soak test item 7: after a `qz` relaunch (a new API token) the presence
// socket's handshake is refused with 403 forever, and the page retried every
// 8 s for as long as it stayed open, with nothing telling the user to reload.
// Now a close is followed by an authenticated probe: 401 → stop, flag the
// session stale and say to reload; a server that is simply down → keep retrying.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useToasts } from "../store/toasts";
import { connectLifecycle, STALE_SESSION_HINT, useConnection } from "./lifecycle";

class FakeSocket {
  static made: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.made.push(this);
  }
  close(): void {
    this.onclose?.();
  }
}

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => {
  FakeSocket.made = [];
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeSocket);
  useConnection.setState({ connected: false, stale: false });
  useToasts.setState({ toasts: [] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("connectLifecycle", () => {
  it("stops retrying and says to reload when the session token is stale (401)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 401 }));
    connectLifecycle();
    FakeSocket.made[0].onerror?.(); // the refused handshake
    await flushPromises();
    await vi.advanceTimersByTimeAsync(30_000); // several backoff periods
    expect(FakeSocket.made).toHaveLength(1);
    expect(useConnection.getState().stale).toBe(true);
    expect(useToasts.getState().toasts.at(-1)?.msg).toBe(STALE_SESSION_HINT);
  });

  it("keeps retrying while the server is down", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    connectLifecycle();
    FakeSocket.made[0].close();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(600);
    expect(FakeSocket.made).toHaveLength(2);
    expect(useConnection.getState().stale).toBe(false);
  });

  it("retries after an ordinary drop the server answers normally", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
    connectLifecycle();
    FakeSocket.made[0].close();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(600);
    expect(FakeSocket.made).toHaveLength(2);
  });
});
