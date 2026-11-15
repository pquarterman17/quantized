// Ported from fermiviewer frontend/src/lib/lifecycle.ts (shared platform code —
// keep in sync). Client-presence socket: holds /api/ws open so the backend can
// track live tabs (and, in --desktop mode, shut down when the last one closes).
// Reconnects with backoff so a dev backend restart doesn't strand the page.
// Connection state feeds the status bar's connected/offline segment.
//
// quantized divergence (soak test): a relaunched `qz` mints a new API token,
// and every request from a page opened on the old one is refused (401; the
// socket handshake 403). A page cannot read a handshake's status, so after a
// close it asks an authenticated endpoint: a 401 means this page's session is
// over — retrying cannot fix that, reloading can — so it stops, flags `stale`
// and says to reload. Anything else (the server is down) keeps retrying.

import { create } from "zustand";

import { toast } from "../store/toasts";

export const useConnection = create<{ connected: boolean; stale: boolean }>(() => ({
  connected: false,
  stale: false,
}));

export const STALE_SESSION_HINT = "qz was relaunched — reload this page to reconnect";

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
      fetch("/api/jobs", { credentials: "same-origin" }).then((r) => {
        if (r.status !== 401) return retry();
        useConnection.setState({ stale: true });
        toast(STALE_SESSION_HINT, "danger", { ttlMs: 60_000 });
      }, retry);
    };
    ws.onerror = () => ws.close();
  };

  connect();
}
