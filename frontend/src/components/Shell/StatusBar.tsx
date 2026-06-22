// Status bar: backend connection dot + status copy + active dataset + count.

import { StatusDot } from "../primitives";
import { useConnection } from "../../lib/lifecycle";
import { useActiveDataset, useApp } from "../../store/useApp";

export default function StatusBar() {
  const status = useApp((s) => s.status);
  const connected = useConnection((s) => s.connected);
  const count = useApp((s) => s.datasets.length);
  const active = useActiveDataset();

  return (
    <footer className="qzk-statusbar">
      <span className="qzk-conn">
        <StatusDot tone={connected ? "ok" : "warn"} />
        {status}
      </span>
      <span className="qzk-spacer" style={{ flex: 1 }} />
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
