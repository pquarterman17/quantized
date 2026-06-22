// Ported from fermiviewer frontend/src/lib/lifecycle.ts (shared platform code —
// keep in sync). Client-presence socket: holds /api/ws open so the backend can
// track live tabs (and, in --desktop mode, shut down when the last one closes).
// Reconnects with backoff so a dev backend restart doesn't strand the page.
// Connection state feeds the status bar's connected/offline segment.

import { create } from "zustand";

export const useConnection = create<{ connected: boolean }>(() => ({
  connected: false,
}));

export function connectLifecycle(): void {
  let delay = 500;

  const connect = () => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/api/ws`);
    ws.onopen = () => {
      delay = 500;
      useConnection.setState({ connected: true });
    };
    ws.onclose = () => {
      useConnection.setState({ connected: false });
      window.setTimeout(connect, delay);
      delay = Math.min(delay * 2, 8000);
    };
    ws.onerror = () => ws.close();
  };

  connect();
}
