// The welcome screen's "Restore last session" card (owner decision
// 2026-11-26). Shown inside the empty stage while the previous session's
// autosave is HELD (lib/lateRestore.ts `holdForWelcome`): the launch did not
// load it, nothing was deleted, and the status bar still says it is waiting.
// Restore replaces the (empty) workspace with it; Discard asks first.

import { onLoadFailure, runLazy } from "../../lib/runLazy";
import { useHeldRestore } from "../../store/heldRestore";

/** "3 datasets: a.dat, b.dat, c.dat, …" */
function summary(n: number, names: readonly string[]): string {
  const more = n > names.length ? ", …" : "";
  return `${n} dataset${n === 1 ? "" : "s"}: ${names.join(", ")}${more}`;
}

const act = (pick: "replaceRecovered" | "discardRecovered") => (): void =>
  void runLazy("Loading restore…", () => import("../../lib/lateRestore")).then((m) => void m[pick](), onLoadFailure);

export default function RestoreSessionCard() {
  const held = useHeldRestore((s) => s.held);
  // After an Append only Replace or Discard remain, and the workspace is not empty then.
  if (!held || held.appended) return null;
  const when = new Date(held.at).toLocaleString();
  return (
    <section className="qzk-restore-card" aria-label="Restore last session">
      <h3>{held.crashed ? "Quantized closed unexpectedly" : "Your last session is saved"}</h3>
      <p>
        {summary(held.datasetCount, held.names)} · {when}
      </p>
      <div className="qzk-empty-actions">
        <button className="qz-btn qz-primary" type="button" onClick={act("replaceRecovered")}>
          Restore last session ({held.names[0] ?? "untitled"}, {when})
        </button>
        <button className="qz-btn" type="button" onClick={act("discardRecovered")} title="Stop keeping the saved session (asks first)">
          Discard…
        </button>
      </div>
      <p className="qzk-empty-hint">
        <span>Nothing was deleted: it stays saved until you restore or discard it.</span>
      </p>
    </section>
  );
}
