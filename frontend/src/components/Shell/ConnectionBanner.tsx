// A persistent banner while the qz server is gone (UX audit 8 #9). The status
// dot turning amber was the only sign: the status line still read "imported
// 1 file", and the next tool opened into a failure card. The client-presence
// socket (lib/lifecycle.ts) is the health check -- it closes the moment the
// server stops. The banner shows once a socket that WAS connected
// (lib/connectionSeen.ts) stays closed for `GRACE_MS`, or at once when the
// session went stale (a relaunched qz refuses this page's token: only a
// reload helps, and the banner then says so). A page that never connected
// (the offline demo, tests) shows nothing: the status line already says
// "offline — demo mode".

import { useEffect, useState } from "react";

import { everConnected } from "../../lib/connectionSeen";
import { useConnection } from "../../lib/lifecycle";

/** How long a lost socket may stay closed before the banner shows. Measured
 *  against lifecycle.ts's reconnect backoff (500 ms, doubling): after a close
 *  the retries land at about 0.5, 1.5, 3.5 and 7.5 s, so a dev `uvicorn`
 *  reload (a few seconds) is back by the 3.5 s or 7.5 s attempt and never
 *  flashes the banner; a server that is really gone has missed four. */
export const GRACE_MS = 8000;

export default function ConnectionBanner() {
  const connected = useConnection((s) => s.connected);
  const stale = useConnection((s) => s.stale);
  const [lost, setLost] = useState(false);
  useEffect(() => {
    setLost(false);
    if (connected || !everConnected()) return;
    const timer = window.setTimeout(() => setLost(true), GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [connected]);
  if (!lost && !stale) return null;
  return (
    // `data-live-region` (R12, lib/modalInert.ts): still reachable with a dialog open.
    <div className="qzk-conn-banner" role="alert" data-live-region="">
      <span>{stale ?? "Lost connection to the qz server"}</span>
      <button type="button" className="qz-btn" onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  );
}
