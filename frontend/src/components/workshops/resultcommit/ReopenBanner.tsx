// The banner a tool shows while it edits a committed result (lane RO): which
// result it was opened from, why it differs from the recorded computation (a
// missing or changed source), and the explicit Replace / Add as new choice for
// the next commit. Replace is the default (the user opened THIS result to edit
// it); it is disabled with the reason when the old output cannot be replaced.

import { useEffect, useMemo } from "react";

import { replaceBlockedReason } from "../../../lib/committedOutputReopen";
import { useToolReopen } from "../../../store/toolReopen";
import { useActiveDataset, useApp } from "../../../store/useApp";

export default function ReopenBanner({ tool }: { tool: string }) {
  const session = useToolReopen((s) => s.sessions[tool]);
  const setMode = useToolReopen((s) => s.setMode);
  const active = useActiveDataset();
  // Re-checked live: the output may be deleted or edited while the tool is open.
  const result = useApp((s) => (session ? s.analysisResults.find((item) => item.id === session.resultId) : undefined));
  const output = useApp((s) => (session ? s.datasets.find((dataset) => dataset.id === session.outputId) : undefined));
  const liveBlocked = useMemo(() => !session ? null
    : !result ? "The result was deleted, so the commit adds a new output."
    : replaceBlockedReason(result, output), [session, result, output]);
  // A replace that became impossible falls back to Add as new, visibly, rather
  // than leaving a commit that would refuse.
  const mode = session?.mode;
  useEffect(() => {
    if (liveBlocked && mode === "replace") setMode(tool, "new");
  }, [liveBlocked, mode, setMode, tool]);
  if (!session) return null;
  const blocked = session.replaceBlocked ?? liveBlocked ?? session.layoutBlocked;
  const onSource = !!session.sourceId && active?.id === session.sourceId;
  const name = `qz-reopen-mode-${tool}`;
  return (
    <div className="qz-reopen-banner" role="region" aria-label="Editing a committed result" style={{ marginBottom: 10, padding: 8, border: "1px solid var(--border)", borderRadius: 6 }}>
      <div className="qzk-helptext">Opened from the result “{session.resultName}”{session.seed ? "; its settings are restored." : "."}</div>
      {session.notice && <div className="qzk-helptext" role="alert" style={{ marginTop: 4, color: "var(--warn)" }}>{session.notice}</div>}
      {!onSource ? (
        <div className="qzk-helptext" style={{ marginTop: 4 }}>The active worksheet is not this result’s source, so a commit adds a new output.</div>
      ) : (
        <div role="radiogroup" aria-label="On commit" style={{ marginTop: 6, display: "flex", gap: 14, flexWrap: "wrap" }}>
          <label className="qzk-helptext" title={blocked ?? undefined}>
            <input type="radio" name={name} checked={session.mode === "replace" && !blocked} disabled={!!blocked} onChange={() => setMode(tool, "replace")} />
            {" "}Replace “{session.outputName ?? "the output"}”
          </label>
          <label className="qzk-helptext">
            <input type="radio" name={name} checked={session.mode === "new" || !!blocked} onChange={() => setMode(tool, "new")} />
            {" "}Add as a new output
          </label>
        </div>
      )}
      {onSource && blocked && <div className="qzk-helptext" style={{ marginTop: 4 }}>{blocked}</div>}
    </div>
  );
}
