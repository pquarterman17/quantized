// Status bar: backend connection dot + status copy + autosave health + active
// dataset + count.

import { StatusDot } from "../primitives";
import { useConnection } from "../../lib/lifecycle";
import { useAutosaveStatus } from "../../store/autosaveStatus";
import { useActiveDataset, useApp } from "../../store/useApp";

/** Clock time of the last successful autosave, or "" when there isn't one. */
function savedAtLabel(savedAt: number | null): string {
  if (savedAt == null) return "";
  return new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function StatusBar() {
  const status = useApp((s) => s.status);
  const connected = useConnection((s) => s.connected);
  const count = useApp((s) => s.datasets.length);
  const active = useActiveDataset();
  const health = useAutosaveStatus((s) => s.health);

  return (
    <footer className="qzk-statusbar">
      <span className="qzk-conn">
        <StatusDot tone={connected ? "ok" : "warn"} />
        {status}
      </span>
      <span className="qzk-spacer" style={{ flex: 1 }} />
      {/* MAIN #32: autosave health. A FAILING save stays visible until the next
          success — the pre-#32 warning was a status line that scrolled away,
          which is how a user ends up trusting an autosave that stopped working.
          A healthy save shows only a quiet timestamp. */}
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
