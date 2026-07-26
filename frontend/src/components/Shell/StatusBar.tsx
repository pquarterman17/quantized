// Status bar: backend connection dot + status copy + pending-op indicator +
// autosave health + active dataset + count.

import { useEffect, useState } from "react";

import { StatusDot } from "../primitives";
import { useConnection } from "../../lib/lifecycle";
import { useAutosaveStatus } from "../../store/autosaveStatus";
import { usePendingOps, type PendingOp } from "../../store/pendingOps";
import { useActiveDataset, useApp } from "../../store/useApp";

/** Clock time of the last successful autosave, or "" when there isn't one. */
function savedAtLabel(savedAt: number | null): string {
  if (savedAt == null) return "";
  return new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// P3.4 slice 2 (2026-07-26 audit gap #2): an op younger than this is likely
// to finish before a user could even register seeing it — showing it
// immediately would make every fast command flicker a busy dot. 250 ms
// matches the plan's own age-gate.
const PENDING_OP_MIN_AGE_MS = 250;
// How often to re-check ages while at least one op is still under the gate —
// only needs to be finer than the gate itself, not per-frame.
const PENDING_OP_POLL_MS = 100;

/** `usePendingOps().ops` filtered to ones old enough to show. beginOp/endOp
 *  already trigger a re-render at start/end; the interval here only covers
 *  the silent stretch in between, where an op crosses the age threshold
 *  without any store change of its own — it runs only while ops exist. */
function useVisiblePendingOps(): PendingOp[] {
  const ops = usePendingOps((s) => s.ops);
  const [, tick] = useState(0);
  useEffect(() => {
    if (ops.length === 0) return;
    const t = setInterval(() => tick((n) => n + 1), PENDING_OP_POLL_MS);
    return () => clearInterval(t);
  }, [ops]);
  return ops.filter((o) => Date.now() - o.startedAt >= PENDING_OP_MIN_AGE_MS);
}

export default function StatusBar() {
  const status = useApp((s) => s.status);
  const connected = useConnection((s) => s.connected);
  const count = useApp((s) => s.datasets.length);
  const active = useActiveDataset();
  const health = useAutosaveStatus((s) => s.health);
  const visibleOps = useVisiblePendingOps();

  return (
    <footer className="qzk-statusbar">
      <span className="qzk-conn">
        <StatusDot tone={connected ? "ok" : "warn"} />
        {status}
      </span>
      {/* P3.4 slice 2: the in-flight signal the 2026-07-26 audit's #2 gap
          named ("every command-palette export runs untracked") — an async
          command now shows here for as long as it runs, past the age-gate,
          instead of firing silently until its completion/failure toast. */}
      {visibleOps.length > 0 && (
        <span className="qzk-pending" title={visibleOps.map((o) => o.label).join(", ")}>
          <StatusDot tone="accent" />
          {visibleOps[0].label}
          {visibleOps.length > 1 && ` (+${visibleOps.length - 1} more)`}
          {/* P3.4 slice 1: only the op(s) that opted in (import batches) carry
              a `cancel` — everything else renders exactly as slice 2 left it.
              Only the FIRST op gets the control, matching the "+N more"
              collapse right above it. */}
          {visibleOps[0].cancel && (
            <button
              type="button"
              className="qzk-pending-cancel"
              title="Cancel"
              aria-label="Cancel"
              onClick={visibleOps[0].cancel}
            >
              ✕
            </button>
          )}
        </span>
      )}
      <span className="qzk-spacer" style={{ flex: 1 }} />
      {/* MAIN #32: autosave health. A FAILING save stays visible until the next
          success — the pre-#32 warning was a status line that scrolled away,
          which is how a user ends up trusting an autosave that stopped working.
          A healthy save shows only a quiet timestamp. This precedence is
          unaffected by the pending-ops indicator above — it renders
          unconditionally and never displaces this block. */}
      {health.error ? (
        <span
          role="alert"
          style={{ color: "var(--danger, #d33)" }}
          title={`Autosave is failing: ${health.error}. Use File ▸ Save workspace to save manually.`}
        >
          ⚠ autosave failing
        </span>
      ) : (
        health.savedAt != null && (
          <span
            style={{ color: "var(--text-faint)" }}
            title={`Last autosave ${new Date(health.savedAt).toLocaleString()} · ${health.count} recovery point${health.count === 1 ? "" : "s"}`}
          >
            saved {savedAtLabel(health.savedAt)}
          </span>
        )
      )}
      {active && (
        <span style={{ color: "var(--text-dim)" }} title={active.name}>
          {active.name} · {active.data.time.length} pts · {active.data.labels.length} ch
        </span>
      )}
      <span>
        {count} dataset{count === 1 ? "" : "s"}
      </span>
    </footer>
  );
}
