import { useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";

import type { AnalysisResult } from "../../../lib/analysisResult";
import { enumerateFreezeOutputs, type FreezeOutput } from "../../../lib/analysisResultFreezeOutputs";
import { onLoadFailure, runLazy } from "../../../lib/runLazy";
import { useApp } from "../../../store/useApp";
import { Button } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import type { AnalysisResultBusy } from "./useAnalysisResultInlineTableActions";

const loadActions = () => runLazy("Loading analysis result actions…", () => import("../../../store/analysisResultActions"));
const loadFreeze = () => runLazy("Loading freeze actions…", () => import("../../../store/analysisResultFreeze"));

/** Freeze for the result workspace. One output keeps the one-click action; a
 *  result with several offers an explicit chooser (nothing preselected) and
 *  freezes the picked outputs in one undo step. */
export default function AnalysisResultFreeze({ result, busy, setBusy }: {
  result: AnalysisResult;
  busy: AnalysisResultBusy;
  setBusy: Dispatch<SetStateAction<AnalysisResultBusy>>;
}) {
  const datasets = useApp((state) => state.datasets);
  const outputs = useMemo(() => enumerateFreezeOutputs(result, datasets), [result, datasets]);
  const [open, setOpen] = useState(false);
  // key -> the data identity the user saw when ticking it; sent to the action,
  // which refuses if the result changed since (fail closed).
  const [picked, setPicked] = useState<Readonly<Record<string, object>>>({});
  const running = useRef(false);
  const multiple = outputs.length > 1;
  const single = outputs.length === 1 ? outputs[0] : null;
  const chosen = Object.entries(picked).map(([key, ref]) => ({ key, ref }));
  if (!outputs.length) {
    return <Button disabled title="Freeze isn't available for this result.">Freeze data</Button>;
  }

  const guarded = async (run: () => Promise<string[]>) => {
    if (busy || running.current) return;
    running.current = true;
    setBusy("freeze");
    try {
      const ids = await run();
      if (ids.length) { setOpen(false); setPicked({}); }
    } finally { running.current = false; setBusy(null); }
  };
  const freezeOne = (output: FreezeOutput) => guarded(async () => {
    // The existing linked-worksheet action, unchanged, for the classic case.
    if (output.key.startsWith("ds:") && result.outputs.length === 1) {
      const id = await loadActions().then((m) => m.freezeAnalysisResult(result.id), () => { onLoadFailure(); return null; });
      return id ? [id] : [];
    }
    return loadFreeze().then((m) => m.freezeAnalysisOutputs(result.id, [{ key: output.key, ref: output.ref }]), () => { onLoadFailure(); return []; });
  });
  const freezeSelected = () => guarded(() => loadFreeze().then(
    (m) => m.freezeAnalysisOutputs(result.id, chosen),
    () => { onLoadFailure(); return []; },
  ));

  if (single) {
    return <Button disabled={!single.freezable || busy !== null}
      title={single.freezable ? "Create an independent worksheet from the current output." : `Can't freeze: ${single.reason}.`}
      onClick={() => void freezeOne(single)}>{busy === "freeze" ? "Freezing…" : "Freeze data"}</Button>;
  }
  return <>
    <Button disabled={busy !== null} aria-expanded={open} title="Choose which outputs to freeze into independent worksheets."
      onClick={() => setOpen((value) => !value)}>Freeze…</Button>
    {open && multiple && <div className="qz-analysis-freeze" role="group" aria-label="Choose outputs to freeze">
      <ul>
        {outputs.map((output) => <li key={output.key}>
          <Checkbox checked={output.key in picked} disabled={!output.freezable || busy !== null}
            ariaLabel={output.label}
            onChange={(on) => setPicked((now) => {
              const { [output.key]: _dropped, ...rest } = now;
              return on ? { ...rest, [output.key]: output.ref } : rest;
            })}>
            {output.label} <span className="qz-analysis-caption">{output.kind} · {output.rows} × {output.cols}{output.reason ? ` · ${output.reason}` : ""}</span>
          </Checkbox>
        </li>)}
      </ul>
      <Button variant="primary" disabled={!chosen.length || busy !== null} onClick={() => void freezeSelected()}>
        {busy === "freeze" ? "Freezing…" : `Freeze selected (${chosen.length})`}
      </Button>
      <Button disabled={busy !== null} onClick={() => { setOpen(false); setPicked({}); }}>Cancel</Button>
    </div>}
  </>;
}
