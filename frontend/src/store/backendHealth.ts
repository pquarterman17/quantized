// P3.4 — the backend identity the diagnostics bundle reports, cached from the
// app's OWN startup handshake (`lib/api.ts`'s `health()`, called once by
// `App.tsx`'s mount effect) rather than probed again when the user clicks
// "Copy diagnostics".
//
// A separate, deliberately tiny module rather than a field on
// `store/diagnostics.ts`: that module (the collector + renderer) is
// dynamically imported only after the click (see `commands/uiCommands.ts`'s
// header for why — keeping it out of the eager bundle), so importing it from
// `App.tsx` to reach one field would drag the whole chunk into the eager
// graph for a startup effect that runs before the user can click anything.
// This module has no such cost: two primitives and two functions.
//
// Why cached rather than probed at click time (2026-09-14 review round):
// `lib/clipboard.ts` already documents the hazard this removes — awaiting a
// server round-trip before `navigator.clipboard.writeText` can drop the
// transient user-activation the Clipboard API requires (see that file's
// PNG-copy comment). A prior version of the diagnostics command awaited a
// fresh `/api/health` fetch (1.5 s timeout) on every click, sitting the same
// hazard directly in the click path — and precisely when the backend is slow
// or hung, which is exactly the situation the diagnostic bundle exists to
// report. What this removes, precisely (narrowed in the 2026-09-14 re-review,
// finding 3 — the previous wording overclaimed "nothing but synchronous
// module state"): the app's OWN `/api/health` round-trip, and only that one.
// `commands/uiCommands.ts`'s "Copy diagnostics" still does one `await` after
// reading this cache — `import("../store/diagnostics")`, the lazily-loaded
// renderer chunk, deliberately kept out of the eager bundle (see that
// module's header). `components/Shell/MenuBar.tsx` warms that chunk when the
// Help menu opens, so from the second click in a session onward the import
// resolves from the module cache instantly; the FIRST click of a session can
// still await a real network fetch for the chunk.

import type { DiagnosticsSnapshot } from "../lib/diagnostics";

/** The raw identity `App.tsx` hands to `recordBackendHealth` — no age. Age is
 *  derived at READ time from `recordedAt`, not stored at record time, so it
 *  stays accurate no matter how long the report sits open before "Copy
 *  diagnostics" is clicked (P3.4 review round, finding 2 — the previous
 *  version cached this identity and rendered it as if it were still live,
 *  which could both under- and over-report a dead backend as "fine"). */
export interface BackendIdentity {
  reachable: boolean;
  app: string | null;
  version: string | null;
}

/** What the diagnostics bundle actually reads: the identity plus how long ago
 *  it was recorded. Exactly `DiagnosticsSnapshot["backend"]` — the renderer's
 *  contract, not duplicated here. */
export type BackendInfo = DiagnosticsSnapshot["backend"];

/** What the bundle reports before the startup handshake has answered, or
 *  after it failed. Indistinguishable on purpose — from the report's reader
 *  both are the same fact: "this SPA could not name a server". Frozen: this
 *  is handed out by reference (`App.tsx` passes it straight to
 *  `recordBackendHealth`), and a consumer that wrote to it would poison the
 *  shared constant for the rest of the session. */
export const BACKEND_UNREACHABLE: BackendIdentity = Object.freeze({
  reachable: false,
  app: null,
  version: null,
});

let lastRecorded: { info: BackendIdentity; recordedAt: number } | null = null;

/** Called once by `App.tsx`'s startup effect after `lib/api.ts`'s `health()`
 *  settles — success or failure — so a later diagnostics read has a
 *  same-origin answer without awaiting anything itself. Stamps the moment
 *  with `Date.now()`; the identity itself carries no timestamp. */
export function recordBackendHealth(info: BackendIdentity): void {
  lastRecorded = { info, recordedAt: Date.now() };
}

/** The most recently recorded identity plus its age, or `BACKEND_UNREACHABLE`
 *  with a null age if the startup probe has not answered yet (or never ran —
 *  e.g. a test that never mounts `App`). Synchronous: the collector must not
 *  await this. Age is computed HERE, against the current clock, not cached
 *  from record time — see the header above. */
export function getBackendHealth(): BackendInfo {
  if (lastRecorded === null) return { ...BACKEND_UNREACHABLE, ageSec: null };
  const ageSec = Math.max(0, Math.round((Date.now() - lastRecorded.recordedAt) / 1000));
  return { ...lastRecorded.info, ageSec };
}

/** Test seam — mirrors `store/toasts.ts`'s `resetNotificationCountsForTests`. */
export function resetBackendHealthForTests(): void {
  lastRecorded = null;
}
