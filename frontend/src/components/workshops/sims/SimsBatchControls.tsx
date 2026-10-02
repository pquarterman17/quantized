import { Button } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import type { SimsState } from "./useSims";

const faint = { color: "var(--text-faint)" } as const;

export default function SimsBatchControls({ state: r }: { state: SimsState }) {
  const progress = r.batchProgress;
  const created = r.batchResults?.filter((x) => x.status === "created") ?? [];
  const failed = r.batchResults?.filter((x) => x.status === "failed") ?? [];
  const stopped = r.batchResults?.filter((x) => x.status === "stopped") ?? [];
  return (
    <div style={{ marginTop: 10 }}>
      <Checkbox checked={r.batchMode} disabled={r.busy} onChange={r.setBatchMode}>
        Apply these settings to several loaded profiles
      </Checkbox>
      {r.batchMode && (
        <div style={{ paddingLeft: 20, marginTop: 5 }}>
          <div role="group" aria-label="Profiles to process" style={{ display: "grid", gap: 3, maxHeight: 110, overflowY: "auto" }}>
            {r.batchCandidates.map((d) => (
              <div key={d.id}>
                <Checkbox
                  checked={r.batchIds.includes(d.id)}
                  disabled={r.busy || d.problem !== null}
                  onChange={(on) => r.toggleBatchId(d.id, on)}
                >
                  {d.name}
                </Checkbox>
                {d.problem && (
                  <div className="qzk-ds-meta" style={{ ...faint, paddingLeft: 20 }}>
                    not compatible: {d.problem}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="qzk-ds-meta" style={{ ...faint, marginTop: 4 }}>
            Preview uses the Profile above. Every profile is checked first, and any warnings on the others are shown for review before anything is created. Each output is new; originals stay unchanged.
          </div>
        </div>
      )}
      {progress && (
        <div className="qzk-ds-meta" aria-live="polite" style={{ marginTop: 6 }}>
          {progress.phase === "check" ? "Checking" : "Creating"} {progress.done}/{progress.total}{progress.current ? ` — ${progress.current}` : ""}
          <progress aria-label="SIMS batch progress" value={progress.done} max={progress.total} style={{ width: "100%" }} />
          <Button size="sm" onClick={r.stopBatch} style={{ marginTop: 4 }}>Stop after current</Button>
        </div>
      )}
      {r.batchResults && (
        <div className="qzk-ds-meta" aria-label="SIMS batch results" style={{ marginTop: 6 }}>
          {created.length} created{failed.length ? ` · ${failed.length} failed` : ""}{stopped.length ? ` · ${stopped.length} stopped` : ""}
          {created.filter((entry) => entry.value.warnings.length > 0).map((entry) => (
            <div key={entry.item.id}>
              {entry.item.name}: {entry.value.warnings.map((w) => w.text).join("; ")}
            </div>
          ))}
          {failed.map((entry) => (
            <div key={entry.item.id} style={{ color: "var(--danger)" }}>{entry.item.name}: {entry.reason}</div>
          ))}
        </div>
      )}
    </div>
  );
}
