// Whether the client-presence socket (lib/lifecycle.ts) has EVER been open on
// this page load. "Not connected" means two different things: a page that
// never had a server (the offline demo, tests) and one that lost it. Only the
// second earns "server unreachable" on a failed tool card or the lost-server
// banner. Kept out of lib/lifecycle.ts, which is shared verbatim with
// fermiviewer.

import { useConnection } from "./lifecycle";

let seen = useConnection.getState().connected;
useConnection.subscribe((s) => {
  if (s.connected) seen = true;
});

export const everConnected = (): boolean => seen;

/** Test seam: forget the history (module state outlives a store reset). */
export function resetConnectionSeenForTests(): void {
  seen = useConnection.getState().connected;
}
