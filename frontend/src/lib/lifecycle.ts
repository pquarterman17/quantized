// Ported from fermiviewer frontend/src/lib/lifecycle.ts (shared platform code —
// keep in sync). Client-presence socket: holds /api/ws open so the backend can
// track live tabs (and, in --desktop mode, shut down when the last one closes).
// Reconnects with backoff so a dev backend restart doesn't strand the page.
// Connection state feeds the status bar's connected/offline segment.
//
// quantized divergence (soak test): after a close, the lazy `./staleSession`
// probe decides between retrying and stopping with a reload hint (`stale`)
// — a relaunched `qz` refuses this page's old token forever.

import { create } from "zustand";

export const useConnection = create<{ connected: boolean; stale: string | null }>(() => ({
  connected: false,
  stale: null,
}));

export function connectLifecycle(): void {
  let delay = 500;

  const retry = () => {
    window.setTimeout(connect, delay);
    delay = Math.min(delay * 2, 8000);
  };

  const connect = () => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/api/ws`);
    ws.onopen = () => {
      delay = 500;
      useConnection.setState({ connected: true });
    };
    ws.onclose = () => {
      useConnection.setState({ connected: false });
      import("./staleSession").then((m) => m.probeSession(retry), retry);
    };
    ws.onerror = () => ws.close();
  };

  connect();
}
