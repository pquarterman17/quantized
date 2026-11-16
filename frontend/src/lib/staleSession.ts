// Stale-session probe for the presence socket (lib/lifecycle.ts) — a lazy
// chunk, loaded on the first socket close (bundle headroom: nothing here runs
// while the connection is healthy).
//
// A relaunched `qz` mints a new API token, and every request from a page
// opened on the old one is refused (401; the socket handshake 403). A page
// cannot read a handshake's status, so after a close this asks an
// authenticated endpoint: a 401 means this page's session is over — retrying
// cannot fix that, reloading can — so it stops, publishes the reload hint on
// `useConnection.stale` (the status bar shows it) and toasts it once. Anything
// else (the server is down, or it answers normally) retries as before.

import { toast } from "../store/toasts";
import { useConnection } from "./lifecycle";

export const STALE_SESSION_HINT = "qz was relaunched — reload this page to reconnect";

export async function probeSession(retry: () => void): Promise<void> {
  let status: number;
  try {
    status = (await fetch("/api/jobs", { credentials: "same-origin" })).status;
  } catch {
    return retry();
  }
  if (status !== 401) return retry();
  useConnection.setState({ stale: STALE_SESSION_HINT });
  toast(STALE_SESSION_HINT, "danger", { ttlMs: 60_000 });
}
