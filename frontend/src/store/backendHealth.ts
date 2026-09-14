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
// report. Reading the startup probe's already-settled answer removes the
// network hop from the click path entirely: the clipboard write now depends
// on nothing but synchronous module state.

import type { DiagnosticsSnapshot } from "../lib/diagnostics";

export type BackendInfo = DiagnosticsSnapshot["backend"];

/** What the bundle reports before the startup handshake has answered, or
 *  after it failed. Indistinguishable on purpose — from the report's reader
 *  both are the same fact: "this SPA could not name a server". */
export const BACKEND_UNREACHABLE: BackendInfo = { reachable: false, app: null, version: null };

let lastBackendHealth: BackendInfo = BACKEND_UNREACHABLE;

/** Called once by `App.tsx`'s startup effect after `lib/api.ts`'s `health()`
 *  settles — success or failure — so a later diagnostics read has a
 *  same-origin answer without awaiting anything itself. */
export function recordBackendHealth(info: BackendInfo): void {
  lastBackendHealth = info;
}

/** The most recently recorded identity, or `BACKEND_UNREACHABLE` if the
 *  startup probe has not answered yet (or never ran — e.g. a test that never
 *  mounts `App`). Synchronous: the collector must not await this. */
export function getBackendHealth(): BackendInfo {
  return lastBackendHealth;
}

/** Test seam — mirrors `store/toasts.ts`'s `resetNotificationCountsForTests`. */
export function resetBackendHealthForTests(): void {
  lastBackendHealth = BACKEND_UNREACHABLE;
}
