// Status bar: backend connection dot + terse status copy + dataset count.

import { StatusDot } from "../primitives";
import { useApp } from "../../store/useApp";

export default function StatusBar() {
  const status = useApp((s) => s.status);
  const connected = useApp((s) => s.status === "backend ready");
  const count = useApp((s) => s.datasets.length);

  return (
    <footer className="qzk-statusbar">
      <span className="qzk-conn">
        <StatusDot tone={connected ? "ok" : "warn"} />
        {status}
      </span>
      <span className="qzk-spacer" style={{ flex: 1 }} />
      <span>
        {count} dataset{count === 1 ? "" : "s"}
      </span>
    </footer>
  );
}
