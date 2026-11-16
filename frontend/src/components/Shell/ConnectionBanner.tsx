// A persistent banner while the qz server is gone (UX audit 8 #9). The status
// dot turning amber was the only sign: the status line still read "imported
// 1 file", and the next tool opened into a failure card. The client-presence
// socket (lib/lifecycle.ts) is the health check -- it closes the moment the
// server stops -- so the banner shows once a socket that WAS connected stays
// closed for `GRACE_MS` (a dev backend reload reconnects inside that), or the
// session went stale (a relaunched qz refuses this page's token: only a
// reload helps). A page that never connected (the offline demo, tests) shows
// nothing: the status line already says "offline — demo mode".

import { useEffect, useRef, useState } from "react";

import { useConnection } from "../../lib/lifecycle";

/** How long a lost socket may stay closed before the banner shows. */
export const GRACE_MS = 2500;

export default function ConnectionBanner() {
  const connected = useConnection((s) => s.connected);
  const stale = useConnection((s) => s.stale);
  const wasConnected = useRef(connected);
  const [lost, setLost] = useState(false);
  useEffect(() => {
    if (connected) {
      wasConnected.current = true;
      setLost(false);
      return;
    }
    if (!wasConnected.current) return;
    const timer = window.setTimeout(() => setLost(true), GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [connected]);
  if (!lost && !stale) return null;
  return (
    // `data-live-region` (R12, lib/modalInert.ts): still reachable with a dialog open.
    <div className="qzk-conn-banner" role="alert" data-live-region="">
      <span>Lost connection to the qz server</span>
      <button type="button" className="qz-btn" onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  );
}
